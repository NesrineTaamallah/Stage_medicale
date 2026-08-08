const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Agent } = require('undici');
const pool = require('../config/db');
const { logAccess } = require('../utils/accessLog');
const { genererPseudonyme } = require('../utils/pseudonymUtils');
const { decrypt } = require('../utils/cryptoUtils');

const TYPES_DOCUMENT = ['visite', 'admission', 'prelevement_sang', 'eeg', 'emg', 'irm', 'autre'];
const TYPES_ENTREE = ['audio', 'scan'];

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const WHISPER_SCRIPT = path.join(__dirname, '..', 'scripts', 'whisper_transcribe.py');
const PADDLEOCR_SCRIPT = path.join(__dirname, '..', 'scripts', 'paddleocr_transcribe.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const PADDLEOCR_PYTHON_BIN = process.env.PADDLEOCR_PYTHON_BIN || PYTHON_BIN;


const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://127.0.0.1:8001';
const PADDLEOCR_SERVICE_URL = process.env.PADDLEOCR_SERVICE_URL || 'http://127.0.0.1:8002';

// undici (moteur de fetch() natif de Node) applique par défaut un timeout
// de ~5 min en attente des headers de réponse (UND_ERR_HEADERS_TIMEOUT).
// L'inférence PaddleOCR-VL en CPU pur peut dépasser ce délai sur certains
// documents (page dense, upscaling important...) — sans ce dispatcher
// dédié, Node abandonnait la requête AVANT que le service ait fini de
// répondre, et basculait à tort sur le mode spawn (pourtant plus lent).
// Aligné sur OCR_TIMEOUT_SECONDS = 1800 (30 min) côté paddleocr_service.py,
// avec 2 min de marge pour laisser le serveur répondre avant que Node
// n'abandonne (mesuré en pratique : ~22-23 min par image sur ce CPU).
const LONG_INFERENCE_DISPATCHER = new Agent({
  headersTimeout: 32 * 60 * 1000, // 32 min
  bodyTimeout: 32 * 60 * 1000,
  connectTimeout: 32 * 60 * 1000,
  keepAliveTimeout: 32 * 60 * 1000,
});

fs.mkdirSync(UPLOAD_DIR, { recursive: true });


async function transcribeAudioViaService(audioPath) {
  const absolutePath = path.resolve(audioPath);
  const res = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_path: absolutePath }),
    dispatcher: LONG_INFERENCE_DISPATCHER,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.detail || `Service de transcription : erreur HTTP ${res.status}`);
  }
  if (!data || typeof data.text !== 'string') {
    throw new Error('Réponse du service de transcription illisible.');
  }
  return { text: data.text, words: Array.isArray(data.words) ? data.words : [] };
}


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
        resolve({ text: parsed.text, words: Array.isArray(parsed.words) ? parsed.words : [] });
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
    dispatcher: LONG_INFERENCE_DISPATCHER,
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
    // Log complet de la cause réelle avant de basculer sur spawn() : le
    // message générique masquait le vrai type d'erreur (ECONNREFUSED,
    // timeout, DNS, proxy...) — sans ça, impossible de savoir pourquoi
    // fetch() échoue alors que le service répond bien à curl.
    console.warn('[paddleocr] Erreur fetch réelle :', err);
    if (err.cause) console.warn('[paddleocr] err.cause :', err.cause);

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
 * GET /api/dossiers/verifier?pathologie=SEP|EPR&numero_dossier=...
 *
 * Vérifie, dès la saisie du numéro de dossier à l'étape 0 du wizard, si ce
 * numéro (pour cette pathologie) correspond déjà à un patient existant. Le
 * pseudonyme étant déterministe (HMAC sur registre + numéro de dossier), on
 * peut le recalculer et regarder s'il existe déjà dans `patients`, sans
 * jamais stocker le numéro de dossier en clair côté patients.
 *
 * Renvoie { existe: false } si aucun patient, ou { existe: true, pseudonyme,
 * pathologie, numero_dossier, date_diagnostic, date_inclusion } sinon —
 * c'est cette réponse qui alimente l'alerte "patient déjà existant" et le
 * bouton "Voir le dossier" côté wizard.
 */
async function verifierDossier(req, res) {
  const { pathologie, numero_dossier } = req.query;

  if (!pathologie || !numero_dossier) {
    return res.status(400).json({ error: 'pathologie et numero_dossier requis.' });
  }
  if (!['SEP', 'EPR'].includes(pathologie)) {
    return res.status(400).json({ error: 'Pathologie invalide.' });
  }

  try {
    const numeroNormalise = String(numero_dossier).trim().toUpperCase();

    // 1) Source principale : `documents_bruts`, où le numero_dossier est
    // stocké en clair dès l'upload initial (creerDossier), avant même toute
    // pseudonymisation ou saisie d'identité civile. C'est la source la plus
    // fiable et la moins coûteuse (comparaison SQL directe, indexée) — et
    // surtout la seule qui couvre les dossiers dont `coordonnee_patient`
    // n'a pas encore été rempli (identité pas encore saisie/extraite), qui
    // passaient auparavant sous le radar du check de doublon.
    const docResult = await pool.query(
      `SELECT numero_dossier FROM documents_bruts
        WHERE pathologie = $1 AND UPPER(TRIM(numero_dossier)) = $2
        LIMIT 1`,
      [pathologie, numeroNormalise]
    );

    let pseudonyme = null;
    if (docResult.rows[0]) {
      pseudonyme = genererPseudonyme(pathologie, docResult.rows[0].numero_dossier);
    } else {
      // 2) Repli : pseudonymes legacy attribués à la main (ex. SEP_MJ_001),
      // dont le seul lien vers le numero_dossier passe par
      // coordonnee_patient (chiffré avec IV aléatoire, donc pas
      // recherchable directement en SQL — on déchiffre chaque ligne pour
      // comparer). Coûteux si la table grossit beaucoup, mais un registre
      // clinique reste de taille modeste ; à revoir avec un index
      // déterministe si ça devient un problème de perf.
      const coordResult = await pool.query(
        `SELECT pseudonyme, numero_dossier FROM coordonnee_patient WHERE numero_dossier IS NOT NULL`
      );
      const match = coordResult.rows.find((r) => {
        try {
          return decrypt(r.numero_dossier).trim().toUpperCase() === numeroNormalise;
        } catch {
          return false;
        }
      });
      if (match) pseudonyme = match.pseudonyme;
    }

    if (!pseudonyme) {
      return res.json({ existe: false });
    }

    const patientResult = await pool.query(
      `SELECT pseudonyme, registre, date_inclusion FROM patients WHERE pseudonyme = $1`,
      [pseudonyme]
    );
    const patient = patientResult.rows[0];
    // On ne signale le doublon que si la pathologie du patient trouvé
    // correspond bien à celle demandée dans le wizard.
    if (!patient || patient.registre !== pathologie) {
      return res.json({ existe: false });
    }

    const identificationTable = pathologie === 'SEP'
      ? 'sep_identification_clinique'
      : 'epr_identification_clinique';
    const identResult = await pool.query(
      `SELECT date_diagnostic FROM ${identificationTable} WHERE pseudonyme = $1`,
      [patient.pseudonyme]
    );

    res.json({
      existe: true,
      pseudonyme: patient.pseudonyme,
      pathologie: patient.registre,
      numero_dossier: numero_dossier.trim(),
      date_diagnostic: identResult.rows[0]?.date_diagnostic || null,
      date_inclusion: patient.date_inclusion,
    });
  } catch (err) {
    console.error('Erreur verifierDossier :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
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
  const {
    numero_dossier, pathologie, date_diagnostic, date_inclusion, type_document, type_entree,
    // Fourni uniquement par le wizard en mode "ajout de document à un
    // dossier existant" (existingPatient) : le pseudonyme réel du patient
    // déjà connu côté client, à utiliser TEL QUEL au lieu de le recalculer
    // par hash — indispensable pour les pseudonymes "legacy" attribués à la
    // main (ex. SEP_MJ_001), qui ne sont pas dérivables depuis numero_dossier.
    pseudonyme_existant,
  } = req.body;
  const fichier = req.file;

  if (!numero_dossier || !pathologie || !date_diagnostic || !date_inclusion || !type_document || !type_entree) {
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

  // Si un pseudonyme existant est annoncé, on vérifie qu'il correspond bien
  // à un patient réel de la bonne pathologie avant de lui faire confiance
  // (le champ vient du client) — sinon on retombe sur le calcul par hash,
  // comme pour une création normale.
  let pseudonyme = null;
  if (pseudonyme_existant) {
    const check = await pool.query(
      `SELECT pseudonyme FROM patients WHERE pseudonyme = $1 AND registre = $2`,
      [pseudonyme_existant, pathologie]
    );
    if (check.rows[0]) {
      pseudonyme = check.rows[0].pseudonyme;
    }
  }
  if (!pseudonyme) {
    // Pseudonymisation par défaut : déterministe (HMAC sur registre + numéro
    // de dossier), donc calculable dès l'upload sans attendre l'extraction
    // d'entités — cas d'une création de dossier normale (pas d'ajout à un
    // patient déjà existant).
    pseudonyme = genererPseudonyme(pathologie, numero_dossier);
  }

  let texte_transcrit = null;
  let mots_confiance = null; // JSONB : confiance par mot (Whisper uniquement, pour coloration frontend)
  let statut = 'en_attente';

  if (type_entree === 'audio') {
    try {
      const transcription = await transcribeAudio(fichier.path);
      texte_transcrit = transcription.text;
      mots_confiance = transcription.words;
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
          chemin_fichier, nom_fichier_original, texte_transcrit, mots_confiance, statut, pseudonyme)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        numero_dossier, pathologie, date_diagnostic, type_document, type_entree,
        fichier.path, fichier.originalname, texte_transcrit,
        mots_confiance ? JSON.stringify(mots_confiance) : null,
        statut, pseudonyme,
      ]
    );

    // On crée une ligne "stub" dans `patients` pour que le dossier apparaisse
    // tout de suite dans la liste côté clinicien — les colonnes d'identité
    // (nom, prénom, ...) restent vides tant que `coordonnee_patient` n'a pas
    // été renseignée par l'étape d'extraction ultérieure. Un seul et même
    // patient (même pseudonyme) peut recevoir plusieurs documents au fil du
    // temps : ON CONFLICT DO NOTHING garantit qu'il reste toujours une seule
    // ligne dans `patients`, quel que soit le nombre de documents ajoutés —
    // y compris quand `pseudonyme` est un pseudonyme "legacy" déjà existant.
    await pool.query(
      `INSERT INTO patients (pseudonyme, registre, date_inclusion)
       VALUES ($1, $2, $3)
       ON CONFLICT (pseudonyme) DO NOTHING`,
      [pseudonyme, pathologie, date_inclusion]
    );

    // Idem côté table "entité patient" du registre concerné (identification
    // clinique SEP ou EPR) : on ne renseigne ici QUE la date de diagnostic,
    // saisie manuellement par le clinicien à cette étape. Tous les autres
    // champs (sexe, gouvernorat, âges calculés, antécédents, évolution...)
    // restent NULL tant qu'ils n'auront pas été remplis par une future étape
    // d'extraction automatique d'entités médicales à partir du texte brut.
    const identificationTable = pathologie === 'SEP'
      ? 'sep_identification_clinique'
      : 'epr_identification_clinique';
    await pool.query(
      `INSERT INTO ${identificationTable} (pseudonyme, date_diagnostic)
       VALUES ($1, $2)
       ON CONFLICT (pseudonyme) DO NOTHING`,
      [pseudonyme, date_diagnostic]
    );

    await logAccess({ userId: req.user.sub, action: 'dossier_document_creer', success: true, req });

    res.status(201).json({
      document_id: docResult.rows[0].id,
      numero_dossier,
      pseudonyme,
      statut,
      texte_transcrit,
      mots_confiance,
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
 *
 * À la validation, le texte définitif est également répercuté dans
 * `patients.detaille` (colonne texte libre du pseudonyme concerné) : c'est
 * là qu'atterrit le résultat de l'extraction, quel que soit le type
 * d'entrée (audio transcrit ou document scanné). Un même patient pouvant
 * recevoir plusieurs documents au fil du temps, chaque nouveau texte validé
 * est ajouté à la suite du contenu déjà présent (jamais écrasé), séparé par
 * un bandeau indiquant le type de document et la date.
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
       RETURNING id, numero_dossier, pathologie, pseudonyme, type_document, texte_transcrit, statut`,
      [texte_transcrit, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    const doc = result.rows[0];
    // Priorité à la colonne `pseudonyme` (fixée à la création par
    // creerDossier) ; repli par hash uniquement pour les documents créés
    // avant l'ajout de cette colonne.
    const pseudonyme = doc.pseudonyme || genererPseudonyme(doc.pathologie, doc.numero_dossier);

    // Chaque bloc ajouté à `patients.detaille` porte un marqueur "doc#<id>"
    // dans son en-tête, pour pouvoir le RETROUVER et le REMPLACER lors d'une
    // correction ultérieure du même document (bouton "Corriger" côté
    // Patients), au lieu de toujours ajouter un nouveau bloc à la suite —
    // ce qui dupliquait le texte à chaque relecture/correction. Ce PATCH
    // n'était appelé auparavant qu'une seule fois (juste après création,
    // dans le wizard), donc le bug ne se voyait pas ; il est maintenant
    // rappelable depuis la modale "Documents associés".
    const marqueur = `doc#${doc.id}`;
    const entete = `--- ${doc.type_document || 'document'} · ${marqueur} · ${new Date().toLocaleDateString('fr-FR')} ---`;
    const nouveauBloc = `${entete}\n${texte_transcrit}`;

    const patientResult = await pool.query(`SELECT detaille FROM patients WHERE pseudonyme = $1`, [pseudonyme]);
    const detailleActuel = patientResult.rows[0]?.detaille || '';
    const blocs = detailleActuel ? detailleActuel.split('\n\n') : [];
    const indexExistant = blocs.findIndex((b) => b.startsWith('---') && b.split('\n')[0].includes(marqueur));

    let nouveauDetaille;
    if (!texte_transcrit.trim()) {
      // Texte vidé volontairement : on retire le bloc s'il existait déjà,
      // on n'ajoute rien de nouveau.
      nouveauDetaille = indexExistant >= 0
        ? blocs.filter((_, i) => i !== indexExistant).join('\n\n')
        : detailleActuel;
    } else if (indexExistant >= 0) {
      blocs[indexExistant] = nouveauBloc;
      nouveauDetaille = blocs.join('\n\n');
    } else {
      nouveauDetaille = detailleActuel ? `${detailleActuel}\n\n${nouveauBloc}` : nouveauBloc;
    }

    await pool.query(`UPDATE patients SET detaille = $1 WHERE pseudonyme = $2`, [nouveauDetaille, pseudonyme]);

    await logAccess({ userId: req.user.sub, action: 'dossier_document_corriger', success: true, req });

    res.json({ ...doc, pseudonyme });
  } catch (err) {
    console.error('Erreur corrigerTexteTranscrit :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * GET /api/dossiers/:pseudonyme/documents
 *
 * Liste les documents bruts (audio transcrit / scan) rattachés à un
 * pseudonyme. `documents_bruts` ne connaît que le numero_dossier en clair
 * (voir schema_documents.sql) : on retrouve les lignes correspondantes en
 * recalculant le pseudonyme de chaque document (même fonction déterministe
 * qu'à l'upload) et en le comparant à celui demandé, plutôt que de stocker
 * le numéro de dossier en clair côté `patients`.
 *
 * Renvoie aussi `numero_dossier` au niveau racine (nécessaire pour rouvrir
 * le wizard "Ajouter un document") : pris sur le premier document trouvé
 * ci-dessus si possible, sinon déchiffré depuis `coordonnee_patient` — seule
 * source restante pour les pseudonymes "legacy" attribués à la main (ex.
 * SEP_MJ_001), qui ne sont pas dérivés par hash du numero_dossier et n'ont
 * donc jamais de ligne `documents_bruts` correspondante tant qu'aucun
 * document n'a encore été uploadé via ce pipeline pour eux.
 */
async function getDocumentsByPseudonyme(req, res) {
  const { pseudonyme } = req.params;

  try {
    const patientResult = await pool.query(
      `SELECT pseudonyme, registre FROM patients WHERE pseudonyme = $1`,
      [pseudonyme]
    );
    const patient = patientResult.rows[0];
    if (!patient) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }

    const docsResult = await pool.query(
      `SELECT id, numero_dossier, pseudonyme, type_document, type_entree, nom_fichier_original,
              texte_transcrit, mots_confiance, statut, created_at
         FROM documents_bruts
        WHERE pathologie = $1
        ORDER BY created_at DESC`,
      [patient.registre]
    );

    const documents = docsResult.rows
      // Priorité à la colonne `pseudonyme` (fixée à la création, fiable
      // pour tous les cas y compris legacy) ; repli par hash uniquement
      // pour les lignes créées avant l'ajout de cette colonne.
      .filter((d) => (d.pseudonyme
        ? d.pseudonyme === pseudonyme
        : genererPseudonyme(patient.registre, d.numero_dossier) === pseudonyme))
      .map((d) => ({
        id: d.id,
        numero_dossier: d.numero_dossier,
        type_document: d.type_document,
        type_entree: d.type_entree,
        nom_fichier_original: d.nom_fichier_original,
        texte_transcrit: d.texte_transcrit,
        // Confiance par mot (Whisper uniquement) : liste [{word,start,end,score,confidence}]
        // utilisée par le frontend pour colorer les mots peu fiables (rouge/jaune).
        mots_confiance: d.mots_confiance,
        statut: d.statut,
        created_at: d.created_at,
      }));

    let numero_dossier = documents[0]?.numero_dossier || null;
    if (!numero_dossier) {
      const coordResult = await pool.query(
        `SELECT numero_dossier FROM coordonnee_patient WHERE pseudonyme = $1`,
        [pseudonyme]
      );
      const chiffre = coordResult.rows[0]?.numero_dossier;
      if (chiffre) {
        try {
          numero_dossier = decrypt(chiffre).trim();
        } catch (e) {
          console.error('Erreur déchiffrement numero_dossier (coordonnee_patient) :', e);
        }
      }
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_documents_bruts_view', success: true, req });

    res.json({ pseudonyme, numero_dossier, documents });
  } catch (err) {
    console.error('Erreur getDocumentsByPseudonyme :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * GET /api/dossiers/:pseudonyme/documents-non-extraits
 * Sous-ensemble de getDocumentsByPseudonyme ci-dessus : uniquement les
 * documents qui ont un texte transcrit ET n'ont pas encore servi à extraire
 * les coordonnées du patient (coordonnees_extraites = false). Alimente le
 * panneau "Extraire" de la fenêtre Entités Médicales : un patient peut avoir
 * 3-4 documents (visite, EEG, courrier...), chacun traité séparément plutôt
 * qu'un seul bloc de texte concaténé.
 */
async function getDocumentsNonExtraits(req, res) {
  const { pseudonyme } = req.params;

  try {
    const patientResult = await pool.query(
      `SELECT pseudonyme, registre FROM patients WHERE pseudonyme = $1`,
      [pseudonyme]
    );
    const patient = patientResult.rows[0];
    if (!patient) {
      return res.status(404).json({ error: 'Dossier introuvable.' });
    }

    const docsResult = await pool.query(
      `SELECT id, numero_dossier, pseudonyme, type_document, type_entree, nom_fichier_original,
              texte_transcrit, mots_confiance, statut, created_at
         FROM documents_bruts
        WHERE pathologie = $1
          AND texte_transcrit IS NOT NULL
          AND TRIM(texte_transcrit) <> ''
          AND coordonnees_extraites = false
        ORDER BY created_at ASC`,
      [patient.registre]
    );

    const documents = docsResult.rows
      .filter((d) => (d.pseudonyme
        ? d.pseudonyme === pseudonyme
        : genererPseudonyme(patient.registre, d.numero_dossier) === pseudonyme))
      .map((d) => ({
        id: d.id,
        type_document: d.type_document,
        type_entree: d.type_entree,
        nom_fichier_original: d.nom_fichier_original,
        // Texte brut affiché tel quel dans le panneau "Extraire" (comme
        // dans "Documents associés") — pas seulement le lien du fichier
        // audio/scan, pour que le clinicien puisse relire avant d'extraire.
        texte_transcrit: d.texte_transcrit,
        mots_confiance: d.mots_confiance,
        statut: d.statut,
        created_at: d.created_at,
      }));

    res.json({ pseudonyme, documents });
  } catch (err) {
    console.error('Erreur getDocumentsNonExtraits :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * GET /api/dossiers/documents/:id/fichier
 * Télécharge le fichier original (audio ou scan) d'un document brut.
 * Pas de re-vérification de pseudonyme ici : l'accès est déjà restreint au
 * rôle clinicien par le middleware de route, comme pour les autres endpoints
 * de ce contrôleur.
 */
async function telechargerFichier(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT chemin_fichier, nom_fichier_original FROM documents_bruts WHERE id = $1`,
      [id]
    );
    const doc = result.rows[0];
    if (!doc || !fs.existsSync(doc.chemin_fichier)) {
      return res.status(404).json({ error: 'Fichier introuvable.' });
    }

    await logAccess({ userId: req.user.sub, action: 'dossier_document_telecharger', success: true, req });

    res.download(doc.chemin_fichier, doc.nom_fichier_original || path.basename(doc.chemin_fichier));
  } catch (err) {
    console.error('Erreur telechargerFichier :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = {
  verifierDossier,
  creerDossier,
  corrigerTexteTranscrit,
  getDocumentsByPseudonyme,
  getDocumentsNonExtraits,
  telechargerFichier,
};