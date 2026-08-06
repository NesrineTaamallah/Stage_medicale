const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pool = require('../config/db');
const { logAccess } = require('../utils/accessLog');

const TYPES_DOCUMENT = ['visite', 'admission', 'prelevement_sang', 'eeg', 'emg', 'irm', 'autre'];
const TYPES_ENTREE = ['audio', 'scan'];

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const WHISPER_SCRIPT = path.join(__dirname, '..', 'scripts', 'whisper_transcribe.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Appelle whisper_transcribe.py en sous-processus sur le fichier audio et
 * renvoie le texte transcrit.
 */
function transcribeAudio(audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [WHISPER_SCRIPT, '--audio', audioPath, '--json']);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('whisper_transcribe.py stderr :', stderr);
        return reject(new Error('Échec de la transcription audio.'));
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop());
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed.text);
      } catch (e) {
        reject(new Error('Réponse de transcription illisible.'));
      }
    });
  });
}

/**
 * POST /api/dossiers/creer
 * multipart/form-data :
 *   numero_dossier, pathologie (SEP|EPR), date_diagnostic (YYYY-MM-DD),
 *   type_document, type_entree (audio|scan), fichier
 *
 * Étape 1 du pipeline uniquement : enregistre le document brut (avec son
 * numéro de dossier en clair, tel que saisi) et, si type_entree = audio,
 * lance la transcription WhisperX.
 *
 * Volontairement AUCUNE pseudonymisation ici, ni écriture dans la table
 * `patients` / les tables SEP/EPR : ce rattachement (génération du
 * pseudonyme + extraction d'entités depuis le texte transcrit ou l'OCR)
 * est fait par une étape ultérieure du pipeline, pas par ce endpoint.
 */
async function creerDossier(req, res) {
  const { numero_dossier, pathologie, date_diagnostic, type_document, type_entree } = req.body;
  const fichier = req.file;

  if (!numero_dossier || !pathologie || !date_diagnostic || !type_document || !type_entree) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }
  if (!['SEP', 'EPR'].includes(pathologie)) {
    return res.status(400).json({ error: 'Pathologie invalide.' });
  }
  if (!TYPES_DOCUMENT.includes(type_document)) {
    return res.status(400).json({ error: 'Type de document invalide.' });
  }
  if (!TYPES_ENTREE.includes(type_entree)) {
    return res.status(400).json({ error: "Type d'entrée invalide." });
  }
  if (!fichier) {
    return res.status(400).json({ error: 'Fichier manquant.' });
  }

  let texte_transcrit = null;
  let statut = 'en_attente';

  if (type_entree === 'audio') {
    try {
      texte_transcrit = await transcribeAudio(fichier.path);
      statut = 'transcrit';
    } catch (err) {
      console.error('Erreur transcription :', err);
      statut = 'erreur_transcription';
    }
  }
  // type_entree === 'scan' : l'OCR n'est volontairement pas branché ici —
  // le document reste 'en_attente' jusqu'à l'étape suivante du pipeline.

  try {
    const docResult = await pool.query(
      `INSERT INTO documents_bruts
         (numero_dossier, pathologie, date_diagnostic, type_document, type_entree,
          chemin_fichier, nom_fichier_original, texte_transcrit, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        numero_dossier, pathologie, date_diagnostic, type_document, type_entree,
        fichier.path, fichier.originalname, texte_transcrit, statut,
      ]
    );

    await logAccess({ userId: req.user.sub, action: 'dossier_document_creer', success: true, req });

    res.status(201).json({
      document_id: docResult.rows[0].id,
      numero_dossier,
      statut,
      texte_transcrit,
    });
  } catch (err) {
    console.error('Erreur creerDossier :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { creerDossier };
