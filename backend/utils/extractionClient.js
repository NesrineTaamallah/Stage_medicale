

const EXTRACTION_SERVICE_URL = process.env.EXTRACTION_SERVICE_URL || 'http://127.0.0.1:8003';


async function extraireDonneesPatient(texte) {
  let response;
  try {
    response = await fetch(`${EXTRACTION_SERVICE_URL}/extraire/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte }),
    });
  } catch (err) {
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
