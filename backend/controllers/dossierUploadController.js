const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pool = require('../config/db');
const { logAccess } = require('../utils/accessLog');

const TYPES_DOCUMENT = ['visite', 'admission', 'prelevement_sang', 'eeg', 'emg', 'irm', 'autre'];
const TYPES_ENTREE = ['audio', 'scan'];

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const WHISPER_SCRIPT = path.join(__dirname, '..', 'scripts', 'whisper_transcribe.py');
const PADDLEOCR_SCRIPT = path.join(__dirname, '..', 'scripts', 'paddleocr_transcribe.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
// Binaire Python dédié à l'OCR si un venv séparé est utilisé (deps paddle
// différentes de celles de whisper) ; retombe sur PYTHON_BIN sinon.
const PADDLEOCR_PYTHON_BIN = process.env.PADDLEOCR_PYTHON_BIN || PYTHON_BIN;

// Services FastAPI persistants (modèle/pipeline chargé une seule fois au
// démarrage, au lieu d'être rechargé à chaque appel comme avec spawn()).
// Voir scripts/whisper_service.py et scripts/paddleocr_service.py.
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://127.0.0.1:8001';
const PADDLEOCR_SERVICE_URL = process.env.PADDLEOCR_SERVICE_URL || 'http://127.0.0.1:8002';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Appelle le service whisper_service.py (modèle déjà chargé) pour
 * transcrire le fichier audio. Nettement plus rapide que transcribeAudioSpawn
 * car il n'y a plus de rechargement du modèle à chaque requête.
 */
async function transcribeAudioViaService(audioPath) {
  const absolutePath = path.resolve(audioPath);
  const res = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_path: absolutePath }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || `Service de transcription : erreur HTTP ${res.status}`);
  }
  if (!data || typeof data.text !== 'string') {
    throw new Error('Réponse du service de transcription illisible.');
  }
  return data.text;
}

/**
 * Ancien mode : lance whisper_transcribe.py en sous-processus à chaque
 * appel (recharge le modèle à chaque fois, donc lent). Conservé comme
 * repli si le service HTTP n'est pas démarré, pour ne rien casser.
 */
function transcribeAudioSpawn(audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [WHISPER_SCRIPT, '--audio', audioPath, '--json'], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    proc.on('error', (err) => {
      reject(new Error(`Impossible de lancer Python (${PYTHON_BIN}) : ${err.message}`));
    });

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
 * Transcrit un fichier audio : essaie d'abord le service HTTP persistant
 * (rapide, modèle déjà en mémoire) ; si le service n'est pas joignable
 * (pas démarré, ou down), retombe sur le mode spawn (lent mais toujours
 * fonctionnel) pour ne jamais bloquer la création de dossier.
 */
async function transcribeAudio(audioPath) {
  try {
    return await transcribeAudioViaService(audioPath);
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      console.warn(
        `[whisper] Service HTTP injoignable sur ${WHISPER_SERVICE_URL} ` +
        `(pas démarré ?) — repli sur spawn() (plus lent). ` +
        `Démarrez le service avec : uvicorn whisper_service:app --port 8001`
      );
      return transcribeAudioSpawn(audioPath);
    }
    throw err;
  }
}

/**
 * Appelle le service paddleocr_service.py (pipeline déjà chargé) pour
 * l'OCR d'un document scanné (image ou PDF). Renvoie le markdown transcrit.
 */
async function ocrScanViaService(filePath) {
  const absolutePath = path.resolve(filePath);
  const res = await fetch(`${PADDLEOCR_SERVICE_URL}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_path: absolutePath }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || `Service OCR : erreur HTTP ${res.status}`);
  }
  if (!data || typeof data.markdown !== 'string') {
    throw new Error('Réponse du service OCR illisible.');
  }
  return data.markdown;
}

/**
 * Ancien mode : lance paddleocr_transcribe.py en sous-processus à chaque
 * appel (recharge le pipeline PaddleOCR-VL à chaque fois, donc lent).
 * Conservé comme repli si le service HTTP n'est pas démarré.
 */
function ocrScanSpawn(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PADDLEOCR_PYTHON_BIN, [PADDLEOCR_SCRIPT, '--input', filePath, '--json'], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    proc.on('error', (err) => {
      reject(new Error(`Impossible de lancer Python (${PADDLEOCR_PYTHON_BIN}) : ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('paddleocr_transcribe.py stderr :', stderr);
        return reject(new Error("Échec de l'OCR du document scanné."));
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop());
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed.markdown);
      } catch (e) {
        reject(new Error('Réponse OCR illisible.'));
      }
    });
  });
}

/**
 * Transcrit (OCR) un document scanné : essaie d'abord le service HTTP
 * persistant (rapide, pipeline déjà en mémoire) ; si injoignable, retombe
 * sur spawn() (lent mais toujours fonctionnel).
 */
async function ocrScan(filePath) {
  try {
    return await ocrScanViaService(filePath);
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      console.warn(
        `[paddleocr] Service HTTP injoignable sur ${PADDLEOCR_SERVICE_URL} ` +
        `(pas démarré ?) — repli sur spawn() (plus lent). ` +
        `Démarrez le service avec : uvicorn paddleocr_service:app --port 8002`
      );
      return ocrScanSpawn(filePath);
    }
    throw err;
  }
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
  } else if (type_entree === 'scan') {
    try {
      texte_transcrit = await ocrScan(fichier.path);
      statut = 'transcrit';
    } catch (err) {
      console.error('Erreur OCR :', err);
      statut = 'erreur_transcription';
    }
  }

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

/**
 * PATCH /api/dossiers/documents/:id/texte
 * body JSON : { texte_transcrit: string }
 *
 * Permet au clinicien de corriger le texte transcrit (audio ou OCR) avant
 * validation finale, directement depuis l'étape de confirmation du wizard.
 */
async function corrigerTexteTranscrit(req, res) {
  const { id } = req.params;
  const { texte_transcrit } = req.body;

  if (typeof texte_transcrit !== 'string') {
    return res.status(400).json({ error: 'texte_transcrit manquant ou invalide.' });
  }

  try {
    const result = await pool.query(
      `UPDATE documents_bruts
         SET texte_transcrit = $1, statut = 'valide'
       WHERE id = $2
       RETURNING id, numero_dossier, texte_transcrit, statut`,
      [texte_transcrit, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_document_corriger', success: true, req });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur corrigerTexteTranscrit :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { creerDossier, corrigerTexteTranscrit };
