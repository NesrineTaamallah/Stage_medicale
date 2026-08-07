// Client HTTP vers le microservice Python d'extraction (FastAPI,
// extraction_service.py). Utilise le `fetch` global de Node (18+) — pas
// de dépendance HTTP supplémentaire nécessaire.
//
// URL configurable via EXTRACTION_SERVICE_URL dans .env (par défaut le
// microservice tourne en local sur le port 8003 — 8001 et 8002 sont déjà
// pris par les services Whisper et PaddleOCR, voir dossierUploadController.js).

const EXTRACTION_SERVICE_URL = process.env.EXTRACTION_SERVICE_URL || 'http://127.0.0.1:8003';

/**
 * Appelle POST /extraire/patient sur le microservice Python.
 * @param {string} texte - Texte transcrit (OCR ou ASR) à analyser.
 * @returns {Promise<object>} Les champs extraits, alignés sur les colonnes
 *   de coordonnee_patient (numero_dossier, nom_prenom, date_naissance,
 *   adresse, origine, telephone, cin, num_cnam, nom_prenom_pere,
 *   nom_prenom_mere, frere, soeur, autre_antecedent) — chaîne vide si rien
 *   trouvé pour un champ donné.
 * @throws {Error} si le microservice est injoignable ou renvoie une erreur.
 */
async function extraireDonneesPatient(texte) {
  let response;
  try {
    response = await fetch(`${EXTRACTION_SERVICE_URL}/extraire/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte }),
    });
  } catch (err) {
    // Service Python injoignable (pas démarré, mauvais port, réseau...)
    throw new Error(`Service d'extraction injoignable (${EXTRACTION_SERVICE_URL}) : ${err.message}`);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // réponse non-JSON, on garde statusText
    }
    throw new Error(`Erreur du service d'extraction (${response.status}) : ${detail}`);
  }

  return response.json();
}

module.exports = { extraireDonneesPatient };
