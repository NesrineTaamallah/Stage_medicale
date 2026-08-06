const pool = require('../config/db');
const { logAccess } = require('../utils/accessLog');

// Colonnes techniques à exclure du calcul de complétude (clé, FK, métadonnées,
// colonnes générées côté SQL — pas des données saisies par le clinicien).
const COMPLETUDE_EXCLUDE = new Set([
  'pseudonyme', 'id', 'created_at', 'registre',
  'delai_diagnostic_mois', // GENERATED ALWAYS AS (sep_identification_clinique)
]);

/**
 * Tables "singleton" (une ligne par patient) utilisées pour le calcul de
 * complétude — volontairement les tables répétées (visites, IRM, poussées...)
 * en sont exclues : leur nombre de lignes est légitimement variable d'un
 * patient à l'autre et ne reflète pas un dossier "incomplet".
 */
const COMPLETUDE_TABLES = {
  SEP: [
    'sep_identification_clinique', 'sep_antecedents',
    'sep_presentation_initiale', 'sep_evolution', 'sep_suivi',
  ],
  EPR: [
    'epr_identification_clinique', 'epr_antecedents',
    'epr_regression_developpementale', 'epr_pharmacoresistance', 'epr_suivi',
  ],
};

// Tables + colonne date utilisées pour déterminer la date de dernière visite
// (dernière donnée horodatée disponible, tous types d'examens/évènements
// confondus — le registre ne modélise pas de table "visites" générique).
const DATE_SOURCES = [
  ['sep_edss_visites', 'date_visite'],
  ['sep_poussees', 'date_poussee'],
  ['sep_irm', 'date_examen'],
  ['sep_biologie_lcr', 'date_prelevement'],
  ['sep_potentiels_evoques', 'date_examen'],
  ['sep_traitement_fond', 'date_debut'],
  ['sep_suivi', 'date_dernier_suivi'],
  ['epr_type_crise', 'date_observation'],
  ['epr_frequence_crises', 'date_rapport'],
  ['epr_examen', 'date_examen'],
  ['epr_eeg', 'date_eeg'],
  ['epr_imagerie', 'date_examen'],
  ['epr_bilan_prechirurgical', 'date_bilan'],
  ['epr_chirurgie', 'date_chirurgie'],
  ['epr_bilan_orthophonique', 'date_bilan'],
  ['epr_bilan_neuropsy', 'date_bilan'],
  ['epr_bilan_ergotherapique', 'date_bilan'],
];

// Convention du registre : une valeur manquante est soit un vrai NULL SQL,
// soit littéralement la chaîne 'NA' (utilisée dans plusieurs scripts
// d'analyse, ex. `WHERE age_debut_crises_mois != 'NA'`) — les deux doivent
// compter comme "non renseigné" pour la complétude.
function isMissingValue(val) {
  if (val === null || val === undefined || val === '') return true;
  if (typeof val === 'string' && val.trim().toUpperCase() === 'NA') return true;
  return false;
}

/**
 * % de champs renseignés (non NULL / non 'NA') sur l'ensemble des tables
 * singleton du registre, pour un pseudonyme donné.
 *
 * `columnsByTable` fournit, pour chaque table, la liste complète de ses
 * colonnes (hors exclusions) — utile quand la ligne n'existe pas encore
 * pour ce patient : dans ce cas on compte quand même toutes ses colonnes
 * comme "non renseignées" au lieu de les ignorer, sinon un dossier dont
 * aucune table n'est créée obtient artificiellement 100% (division par 0
 * -> 0, ou pire, un total réduit qui gonfle le taux des tables restantes).
 */
function computeCompletude(rowsByTable, tables, columnsByTable) {
  let filled = 0;
  let total = 0;
  for (const t of tables) {
    const row = rowsByTable[t];
    const cols = (columnsByTable && columnsByTable[t]) || (row ? Object.keys(row) : []);
    for (const col of cols) {
      if (COMPLETUDE_EXCLUDE.has(col)) continue;
      total += 1;
      const val = row ? row[col] : undefined;
      if (row && !isMissingValue(val)) filled += 1;
    }
  }
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

/**
 * GET /api/dossiers
 * Liste légère des dossiers (pas de données identifiantes ici — celles-ci
 * restent dans coordonnee_patient / le flux de la partie "Patients"), avec
 * en plus la date de dernière visite et un indicateur de complétude du
 * dossier, utiles pour prioriser le suivi clinique d'un coup d'œil.
 */
async function listDossiers(req, res) {
  try {
    const patientsResult = await pool.query(
      `SELECT pseudonyme, registre, date_inclusion, age, created_at
       FROM patients
       ORDER BY date_inclusion DESC NULLS LAST, created_at DESC`
    );

    const dateUnion = DATE_SOURCES
      .map(([table, col]) => `SELECT pseudonyme, ${col} AS d FROM ${table}`)
      .join(' UNION ALL ');
    const dateResult = await pool.query(
      `SELECT pseudonyme, MAX(d) AS derniere_visite FROM (${dateUnion}) x WHERE d IS NOT NULL GROUP BY pseudonyme`
    );
    const derniereVisiteByPseudo = new Map(dateResult.rows.map((r) => [r.pseudonyme, r.derniere_visite]));

    // Une requête par table singleton (SEP + EPR confondues), indexée par pseudonyme.
    const allTables = [...COMPLETUDE_TABLES.SEP, ...COMPLETUDE_TABLES.EPR];
    const [tableResults, columnResult] = await Promise.all([
      Promise.all(allTables.map((t) => pool.query(`SELECT * FROM ${t}`))),
      pool.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_name = ANY($1::text[])`,
        [allTables]
      ),
    ]);
    const rowsByTableByPseudo = {}; // { pseudonyme: { table: row } }
    allTables.forEach((table, i) => {
      for (const row of tableResults[i].rows) {
        rowsByTableByPseudo[row.pseudonyme] = rowsByTableByPseudo[row.pseudonyme] || {};
        rowsByTableByPseudo[row.pseudonyme][table] = row;
      }
    });
    const columnsByTable = {}; // { table: [col, ...] } — toutes colonnes, y compris pour les lignes absentes
    for (const { table_name, column_name } of columnResult.rows) {
      columnsByTable[table_name] = columnsByTable[table_name] || [];
      columnsByTable[table_name].push(column_name);
    }

    const rows = patientsResult.rows.map((p) => ({
      ...p,
      derniere_visite: derniereVisiteByPseudo.get(p.pseudonyme) || null,
      completude: computeCompletude(
        rowsByTableByPseudo[p.pseudonyme] || {},
        COMPLETUDE_TABLES[p.registre] || [],
        columnsByTable
      ),
    }));

    res.json(rows);
  } catch (err) {
    console.error('Erreur listDossiers :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * GET /api/dossiers/:pseudonyme
 * Renvoie les entités médicales extraites (NER), regroupées par section,
 * telles qu'injectées dans le schéma relationnel — voir schema_registre.sql.
 * Le regroupement diffère selon le registre (SEP vs EPR).
 */
async function getDossierDetail(req, res) {
  const { pseudonyme } = req.params;

  try {
    const patientResult = await pool.query(
      `SELECT pseudonyme, registre, date_inclusion, age FROM patients WHERE pseudonyme = $1`,
      [pseudonyme]
    );
    const patient = patientResult.rows[0];
    if (!patient) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }

    const entites = patient.registre === 'SEP'
      ? await buildEntitesSEP(pseudonyme)
      : await buildEntitesEPR(pseudonyme);

    await logAccess({ userId: req.user.sub, action: 'dossier_view', success: true, req });

    res.json({
      identification: { ...patient, ...entites.identification },
      antecedents: entites.antecedents,
      evolutionClinique: entites.evolutionClinique,
      imagerie: entites.imagerie,
      traitements: entites.traitements,
      suivi: entites.suivi,
    });
  } catch (err) {
    console.error('Erreur getDossierDetail :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

async function buildEntitesSEP(pseudonyme) {
  const p = [pseudonyme];
  const [
    identification, antecedents, presentation, evolution,
    edssVisites, poussees, irm, biologieLcr, potentielsEvoques,
    traitementFond, suivi,
  ] = await Promise.all([
    pool.query('SELECT * FROM sep_identification_clinique WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM sep_antecedents WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM sep_presentation_initiale WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM sep_evolution WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM sep_edss_visites WHERE pseudonyme = $1 ORDER BY date_visite', p),
    pool.query('SELECT * FROM sep_poussees WHERE pseudonyme = $1 ORDER BY date_poussee', p),
    pool.query('SELECT * FROM sep_irm WHERE pseudonyme = $1 ORDER BY date_examen', p),
    pool.query('SELECT * FROM sep_biologie_lcr WHERE pseudonyme = $1 ORDER BY date_prelevement', p),
    pool.query('SELECT * FROM sep_potentiels_evoques WHERE pseudonyme = $1 ORDER BY date_examen', p),
    pool.query('SELECT * FROM sep_traitement_fond WHERE pseudonyme = $1 ORDER BY date_debut', p),
    pool.query('SELECT * FROM sep_suivi WHERE pseudonyme = $1', p),
  ]);

  return {
    identification: identification.rows[0] || {},
    antecedents: antecedents.rows[0] || {},
    evolutionClinique: {
      presentationInitiale: presentation.rows[0] || null,
      evolution: evolution.rows[0] || null,
      edssVisites: edssVisites.rows,
      poussees: poussees.rows,
    },
    imagerie: {
      irm: irm.rows,
      biologieLcr: biologieLcr.rows,
      potentielsEvoques: potentielsEvoques.rows,
    },
    traitements: { traitementFond: traitementFond.rows },
    suivi: suivi.rows[0] || {},
  };
}

async function buildEntitesEPR(pseudonyme) {
  const p = [pseudonyme];
  const [
    identification, antecedents, typeCrise, frequenceCrises, regression,
    examen, etiologie, eeg, imagerie, genetique,
    listeAe, alternatives, bilanPrechir, chirurgie,
    bilanOrtho, bilanNeuropsy, bilanErgo, suivi,
  ] = await Promise.all([
    pool.query('SELECT * FROM epr_identification_clinique WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_antecedents WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_type_crise WHERE pseudonyme = $1 ORDER BY date_observation', p),
    pool.query('SELECT * FROM epr_frequence_crises WHERE pseudonyme = $1 ORDER BY date_rapport', p),
    pool.query('SELECT * FROM epr_regression_developpementale WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_examen WHERE pseudonyme = $1 ORDER BY date_examen', p),
    pool.query('SELECT * FROM epr_etiologie WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_eeg WHERE pseudonyme = $1 ORDER BY date_eeg', p),
    pool.query('SELECT * FROM epr_imagerie WHERE pseudonyme = $1 ORDER BY date_examen', p),
    pool.query('SELECT * FROM epr_genetique WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_liste_ae WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_alternatives_therapeutiques WHERE pseudonyme = $1 ORDER BY date_debut', p),
    pool.query('SELECT * FROM epr_bilan_prechirurgical WHERE pseudonyme = $1 ORDER BY date_bilan', p),
    pool.query('SELECT * FROM epr_chirurgie WHERE pseudonyme = $1', p),
    pool.query('SELECT * FROM epr_bilan_orthophonique WHERE pseudonyme = $1 ORDER BY date_bilan', p),
    pool.query('SELECT * FROM epr_bilan_neuropsy WHERE pseudonyme = $1 ORDER BY date_bilan', p),
    pool.query('SELECT * FROM epr_bilan_ergotherapique WHERE pseudonyme = $1 ORDER BY date_bilan', p),
    pool.query('SELECT * FROM epr_suivi WHERE pseudonyme = $1', p),
  ]);

  return {
    identification: identification.rows[0] || {},
    antecedents: antecedents.rows[0] || {},
    evolutionClinique: {
      typeCrise: typeCrise.rows,
      frequenceCrises: frequenceCrises.rows,
      regressionDeveloppementale: regression.rows[0] || null,
      etiologie: etiologie.rows,
      examen: examen.rows,
    },
    imagerie: { eeg: eeg.rows, imagerie: imagerie.rows, genetique: genetique.rows },
    traitements: {
      listeAe: listeAe.rows,
      alternatives: alternatives.rows,
      bilanPrechirurgical: bilanPrechir.rows,
      chirurgie: chirurgie.rows,
    },
    suivi: {
      ...(suivi.rows[0] || {}),
      bilanOrthophonique: bilanOrtho.rows,
      bilanNeuropsy: bilanNeuropsy.rows,
      bilanErgotherapique: bilanErgo.rows,
    },
  };
}

// Whitelist des tables modifiables depuis le dossier détaillé, désormais
// TOUTES les catégories cliniques (Identification, Antécédents, Présentation,
// Poussées, Handicap, Imagerie, Biologie, Potentiels évoqués, Traitement,
// Suivi — SEP comme EPR), et plus seulement Identification.
//
// - SINGLETON_TABLES : une ligne par patient (clé primaire = pseudonyme) ->
//   upsert par pseudonyme, comme avant.
// - REPEATED_TABLES : plusieurs lignes possibles par patient (visites,
//   poussées, IRM, EEG...) -> il faut cibler la ligne exacte par son `id`
//   (colonne SERIAL PRIMARY KEY), sans quoi on ne pourrait pas savoir
//   laquelle des N lignes modifier.
const SINGLETON_TABLES = new Set([
  'patients',
  'sep_identification_clinique', 'sep_presentation_initiale', 'sep_evolution',
  'sep_antecedents', 'sep_suivi',
  'epr_identification_clinique', 'epr_antecedents',
  'epr_regression_developpementale', 'epr_pharmacoresistance', 'epr_suivi',
]);

const REPEATED_TABLES = new Set([
  'sep_edss_visites', 'sep_poussees', 'sep_irm', 'sep_biologie_lcr',
  'sep_potentiels_evoques', 'sep_traitement_fond',
  'epr_type_crise', 'epr_frequence_crises', 'epr_examen', 'epr_etiologie',
  'epr_eeg', 'epr_imagerie', 'epr_genetique', 'epr_liste_ae',
  'epr_bilan_prechirurgical', 'epr_chirurgie', 'epr_alternatives_therapeutiques',
  'epr_bilan_orthophonique', 'epr_bilan_neuropsy', 'epr_bilan_ergotherapique',
]);

const ALLOWED_TABLES = new Set([...SINGLETON_TABLES, ...REPEATED_TABLES]);

// Colonnes techniques jamais modifiables depuis ce endpoint, quelle que soit
// la table : clé primaire, clé étrangère patient, métadonnées.
const EXCLUDED_COLUMNS = new Set(['id', 'pseudonyme', 'created_at', 'registre']);

/**
 * Colonnes réellement éditables d'une table : toutes ses colonnes SQL, moins
 * les colonnes techniques ci-dessus et les colonnes générées côté SQL
 * (GENERATED ALWAYS AS ... STORED, ex. delai_diagnostic_mois) — PostgreSQL
 * refuse de toute façon un UPDATE dessus. Interrogé dynamiquement sur
 * information_schema plutôt qu'une whitelist codée en dur par colonne : reste
 * synchronisé avec schema_registre.sql sans double maintenance, tout en
 * bloquant strictement toute table/colonne hors de ce périmètre.
 */
async function getColonnesEditables(table) {
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND (is_generated IS NULL OR is_generated = 'NEVER')`,
    [table]
  );
  return new Set(
    result.rows.map((r) => r.column_name).filter((c) => !EXCLUDED_COLUMNS.has(c))
  );
}

/**
 * PATCH /api/dossiers/:pseudonyme/champ
 * body : { table, colonne, valeur, id? }
 *
 * `id` (clé SERIAL de la ligne) est requis pour les tables "répétées"
 * (REPEATED_TABLES) où un patient peut avoir plusieurs lignes (visites,
 * poussées, examens...) — sans lui on ne pourrait pas savoir laquelle
 * modifier. Il est ignoré pour les tables "singleton".
 *
 * Endpoint générique mais volontairement restreint par whitelist de tables
 * + vérification dynamique des colonnes réelles : impossible de cibler une
 * table ou une colonne hors du schéma clinique, même en forgeant la requête.
 * Une seule colonne modifiée par appel (édition champ par champ avec
 * confirmation côté frontend) — pas de mise à jour en masse pouvant écraser
 * des données par erreur.
 */
async function updateChampDossier(req, res) {
  const { pseudonyme } = req.params;
  const { table, colonne, valeur, id } = req.body;

  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Table inconnue ou non modifiable.' });
  }

  try {
    const colonnesEditables = await getColonnesEditables(table);
    if (!colonnesEditables.has(colonne)) {
      return res.status(400).json({ error: 'Champ inconnu ou non modifiable.' });
    }

    const patientResult = await pool.query('SELECT pseudonyme, registre FROM patients WHERE pseudonyme = $1', [pseudonyme]);
    const patient = patientResult.rows[0];
    if (!patient) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }
    // Les tables sep_* / epr_* sont réservées au registre correspondant :
    // on évite qu'un appel malformé écrive dans epr_identification_clinique
    // pour un patient SEP (ou l'inverse), ce qui créerait une ligne fantôme.
    if (table.startsWith('sep_') && patient.registre !== 'SEP') {
      return res.status(400).json({ error: 'Ce champ ne correspond pas au registre de ce dossier.' });
    }
    if (table.startsWith('epr_') && patient.registre !== 'EPR') {
      return res.status(400).json({ error: 'Ce champ ne correspond pas au registre de ce dossier.' });
    }

    // La valeur vide est normalisée en NULL SQL plutôt qu'en chaîne vide,
    // conformément à la convention NULL/'NA' déjà utilisée ailleurs dans
    // le registre pour représenter une donnée manquante.
    const valeurNormalisee = valeur === '' || valeur === undefined ? null : valeur;

    // `table` et `colonne` sont vérifiés ci-dessus contre le schéma réel
    // (pas interpolés directement depuis req.body sans vérification) :
    // l'usage de template string ici est donc sûr, seules les valeurs
    // variables passent en paramètres liés.
    let query;
    let params;
    if (table === 'patients') {
      query = `UPDATE patients SET ${colonne} = $1 WHERE pseudonyme = $2 RETURNING ${colonne}`;
      params = [valeurNormalisee, pseudonyme];
    } else if (SINGLETON_TABLES.has(table)) {
      query = `INSERT INTO ${table} (pseudonyme, ${colonne}) VALUES ($2, $1)
           ON CONFLICT (pseudonyme) DO UPDATE SET ${colonne} = EXCLUDED.${colonne}
           RETURNING ${colonne}`;
      params = [valeurNormalisee, pseudonyme];
    } else {
      // Table répétée : il faut la ligne exacte (id), sinon on ne sait pas
      // laquelle des N lignes du patient modifier.
      if (!id) {
        return res.status(400).json({ error: 'Identifiant de ligne manquant pour ce champ.' });
      }
      query = `UPDATE ${table} SET ${colonne} = $1 WHERE id = $2 AND pseudonyme = $3 RETURNING ${colonne}`;
      params = [valeurNormalisee, id, pseudonyme];
    }

    const result = await pool.query(query, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ligne introuvable pour ce dossier.' });
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_edit_champ', success: true, req });

    res.json({ colonne, valeur: result.rows[0]?.[colonne] ?? null });
  } catch (err) {
    console.error('Erreur updateChampDossier :', err);
    res.status(500).json({ error: "Échec de l'enregistrement." });
  }
}

module.exports = { listDossiers, getDossierDetail, updateChampDossier };