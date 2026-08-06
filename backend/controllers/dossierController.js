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

/** % de champs renseignés (non NULL) sur l'ensemble des tables singleton du registre, pour un pseudonyme donné. */
function computeCompletude(rowsByTable, tables) {
  let filled = 0;
  let total = 0;
  for (const t of tables) {
    const row = rowsByTable[t];
    if (!row) continue; // table pas encore créée pour ce patient -> aucun champ compté
    for (const [col, val] of Object.entries(row)) {
      if (COMPLETUDE_EXCLUDE.has(col)) continue;
      total += 1;
      if (val !== null && val !== undefined && val !== '') filled += 1;
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
    const tableResults = await Promise.all(
      allTables.map((t) => pool.query(`SELECT * FROM ${t}`))
    );
    const rowsByTableByPseudo = {}; // { pseudonyme: { table: row } }
    allTables.forEach((table, i) => {
      for (const row of tableResults[i].rows) {
        rowsByTableByPseudo[row.pseudonyme] = rowsByTableByPseudo[row.pseudonyme] || {};
        rowsByTableByPseudo[row.pseudonyme][table] = row;
      }
    });

    const rows = patientsResult.rows.map((p) => ({
      ...p,
      derniere_visite: derniereVisiteByPseudo.get(p.pseudonyme) || null,
      completude: computeCompletude(
        rowsByTableByPseudo[p.pseudonyme] || {},
        COMPLETUDE_TABLES[p.registre] || []
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

module.exports = { listDossiers, getDossierDetail };