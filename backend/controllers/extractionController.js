const pool = require('../config/db');
const { decrypt } = require('../utils/cryptoUtils');
const { extraireDonneesPatient } = require('../utils/extractionClient');
const { logAccess } = require('../utils/accessLog');

// Mêmes champs que coordonneePatientController.js (SENSITIVE_FIELDS) —
// dupliqué ici volontairement pour ne pas créer de dépendance circulaire
// entre les deux contrôleurs ; les deux listes doivent rester synchrones.
const CHAMPS_COORDONNEE = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

// Champs "simples" (une seule personne/valeur) : la valeur déjà en base
// est conservée si elle existe, sinon on prend la nouvelle extraction —
// on n'écrase JAMAIS une fiche déjà remplie par une nouvelle extraction
// potentiellement moins fiable (ex. audio mal transcrit).
const CHAMPS_SIMPLES = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
];

// Champs "multi-valeurs" (plusieurs frères/sœurs/antécédents possibles) :
// la nouvelle extraction est FUSIONNÉE avec l'existant plutôt que de le
// remplacer — c'est la partie "même si apparaît une nouvelle coordonnée
// après, on doit l'ajouter dans la même ligne" de la demande.
const CHAMPS_MULTI = ['frere', 'soeur', 'autre_antecedent'];

function _normaliser(valeur) {
  return (valeur || '').trim().toLowerCase();
}

/**
 * Fusionne les valeurs d'un champ multi (ex. "frere") venant de la fiche
 * existante et de la nouvelle extraction, en dédoublonnant (comparaison
 * insensible à la casse/espaces) et en conservant l'ordre d'apparition.
 */
function fusionnerChampMulti(existant, nouveau) {
  const items = [
    ...String(existant || '').split(',').map((s) => s.trim()).filter(Boolean),
    ...String(nouveau || '').split(',').map((s) => s.trim()).filter(Boolean),
  ];
  const vus = new Set();
  const dedupliques = [];
  for (const item of items) {
    const cle = _normaliser(item);
    if (!vus.has(cle)) {
      vus.add(cle);
      dedupliques.push(item);
    }
  }
  return dedupliques.join(', ');
}

/**
 * Fusionne les champs extraits avec la fiche coordonnee_patient déjà en
 * base pour ce pseudonyme (s'il y en a une). Résultat : une seule ligne
 * par patient, jamais écrasée — seulement complétée.
 */
function fusionnerAvecExistant(extraction, existant) {
  const fusion = {};
  for (const champ of CHAMPS_SIMPLES) {
    fusion[champ] = (existant && existant[champ]) ? existant[champ] : (extraction[champ] || '');
  }
  for (const champ of CHAMPS_MULTI) {
    fusion[champ] = fusionnerChampMulti(existant && existant[champ], extraction[champ]);
  }
  return fusion;
}

/**
 * Concatène le texte transcrit de tous les documents d'un pseudonyme, pour
 * fournir un seul bloc de texte à l'extracteur (un dossier peut avoir
 * plusieurs documents : visite, EEG, courrier...).
 */
async function _texteConcatenePourPseudonyme(pseudonyme) {
  const patientResult = await pool.query(
    `SELECT pseudonyme, registre FROM patients WHERE pseudonyme = $1`,
    [pseudonyme]
  );
  const patient = patientResult.rows[0];
  if (!patient) return null;

  const docsResult = await pool.query(
    `SELECT texte_transcrit FROM documents_bruts
      WHERE pathologie = $1 AND pseudonyme = $2 AND texte_transcrit IS NOT NULL
      ORDER BY created_at ASC`,
    [patient.registre, pseudonyme]
  );

  return docsResult.rows.map((r) => r.texte_transcrit).filter(Boolean).join('\n\n');
}

/**
 * Récupère et déchiffre la fiche coordonnee_patient existante (ou null).
 */
async function _coordonneeExistante(pseudonyme) {
  const result = await pool.query(`SELECT * FROM coordonnee_patient WHERE pseudonyme = $1`, [pseudonyme]);
  const row = result.rows[0];
  if (!row) return null;
  const decrypted = {};
  for (const champ of CHAMPS_COORDONNEE) {
    decrypted[champ] = row[champ] ? decrypt(row[champ]) : '';
  }
  return decrypted;
}

/**
 * POST /api/extraction/patient
 * body: { pseudonyme } — dossier déjà existant (concatène tous ses
 *       documents transcrits), OU { texte } — texte fourni directement
 *       (ex. juste après transcription, avant même que le dossier existe
 *       en base, cas "nouveau dossier" du wizard).
 *
 * Ne SAUVEGARDE rien : renvoie les champs extraits + fusionnés avec
 * l'existant (s'il y en a un), pour affichage structuré et modifiable
 * côté clinicien avant validation. La sauvegarde finale se fait via
 * POST /api/coordonnees (coordonneePatientController.js), déjà en
 * upsert une-ligne-par-pseudonyme.
 *
 * Point d'entrée commun aux deux boutons décrits par la cliniciennne :
 * "Extraire données patient" (wizard Ajouter, dossier neuf ou existant)
 * et "Extraire coordonnées" (fenêtre Entités Médicales, dossier dont la
 * transcription a déjà été validée sans que l'identité ait été saisie).
 */
async function extraireCoordonneesPatient(req, res) {
  const { pseudonyme, texte } = req.body;

  if (!pseudonyme && !texte) {
    return res.status(400).json({ error: "Fournir soit 'pseudonyme' (dossier existant), soit 'texte' directement." });
  }

  try {
    let texteAAnalyser = texte;
    let existant = null;

    if (pseudonyme) {
      texteAAnalyser = await _texteConcatenePourPseudonyme(pseudonyme);
      if (texteAAnalyser === null) {
        return res.status(404).json({ error: 'Dossier introuvable.' });
      }
      existant = await _coordonneeExistante(pseudonyme);
    }

    if (!texteAAnalyser || !texteAAnalyser.trim()) {
      return res.status(422).json({ error: 'Aucun texte transcrit disponible pour ce dossier — impossible d\'extraire.' });
    }

    const extraction = await extraireDonneesPatient(texteAAnalyser);
    const fusion = fusionnerAvecExistant(extraction, existant);

    await logAccess({
      userId: req.user?.sub,
      action: 'extraction_patient',
      success: true,
      req,
    });

    res.json({ pseudonyme: pseudonyme || null, ...fusion });
  } catch (err) {
    console.error('Erreur extraireCoordonneesPatient :', err);
    res.status(502).json({ error: err.message || "Échec de l'extraction." });
  }
}

module.exports = { extraireCoordonneesPatient };
