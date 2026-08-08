const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { logAccess } = require('../utils/accessLog');


const TABLES_AVEC_FICHIER = new Set([
  'sep_edss_visites', 'sep_irm', 'sep_biologie_lcr', 'sep_potentiels_evoques',
  'epr_examen', 'epr_eeg', 'epr_imagerie', 'epr_genetique',
  'epr_bilan_prechirurgical', 'epr_chirurgie',
  'epr_bilan_orthophonique', 'epr_bilan_neuropsy', 'epr_bilan_ergotherapique',
]);

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const ENTITE_UPLOAD_DIR = path.join(UPLOAD_DIR, 'entites');
fs.mkdirSync(ENTITE_UPLOAD_DIR, { recursive: true });

function checkTable(table) {
  return TABLES_AVEC_FICHIER.has(table);
}


async function uploaderFichierEntite(req, res) {
  const { pseudonyme } = req.params;
  const { table, id } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }
  if (!checkTable(table)) {
    return res.status(400).json({ error: 'Table inconnue ou non concernée par les documents.' });
  }
  if (!id) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Identifiant de ligne manquant.' });
  }

  try {
    const patientResult = await pool.query('SELECT pseudonyme, registre FROM patients WHERE pseudonyme = $1', [pseudonyme]);
    const patient = patientResult.rows[0];
    if (!patient) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }
    if (table.startsWith('sep_') && patient.registre !== 'SEP') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Ce champ ne correspond pas au registre de ce dossier.' });
    }
    if (table.startsWith('epr_') && patient.registre !== 'EPR') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Ce champ ne correspond pas au registre de ce dossier.' });
    }

    const ancien = await pool.query(
      `SELECT chemin_fichier FROM ${table} WHERE id = $1 AND pseudonyme = $2`,
      [id, pseudonyme]
    );
    if (ancien.rowCount === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Ligne introuvable pour ce dossier.' });
    }

    const cheminRelatif = path.relative(UPLOAD_DIR, req.file.path);

    const result = await pool.query(
      `UPDATE ${table}
          SET chemin_fichier = $1, nom_fichier_original = $2
        WHERE id = $3 AND pseudonyme = $4
      RETURNING chemin_fichier, nom_fichier_original`,
      [cheminRelatif, req.file.originalname, id, pseudonyme]
    );

    const ancienChemin = ancien.rows[0]?.chemin_fichier;
    if (ancienChemin) {
      const ancienAbsolu = path.join(UPLOAD_DIR, ancienChemin);
      fs.unlink(ancienAbsolu, () => {}); 
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_entite_fichier_upload', success: true, req });

    res.json({
      chemin_fichier: result.rows[0].chemin_fichier,
      nom_fichier_original: result.rows[0].nom_fichier_original,
    });
  } catch (err) {
    console.error('Erreur uploaderFichierEntite :', err);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Échec de l'enregistrement du document." });
  }
}


async function telechargerFichierEntite(req, res) {
  const { table, id } = req.params;

  if (!checkTable(table)) {
    return res.status(400).json({ error: 'Table inconnue.' });
  }

  try {
    const result = await pool.query(
      `SELECT chemin_fichier, nom_fichier_original FROM ${table} WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.chemin_fichier) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    const cheminAbsolu = path.join(UPLOAD_DIR, row.chemin_fichier);
    if (!fs.existsSync(cheminAbsolu)) {
      return res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_entite_fichier_telecharger', success: true, req });

    res.download(cheminAbsolu, row.nom_fichier_original || path.basename(cheminAbsolu));
  } catch (err) {
    console.error('Erreur telechargerFichierEntite :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { uploaderFichierEntite, telechargerFichierEntite };
