const crypto = require('crypto');
require('dotenv').config();


const PEPPER = process.env.PSEUDONYM_PEPPER || process.env.TOTP_ENCRYPTION_KEY;

if (!PEPPER) {
  throw new Error(
    'PSEUDONYM_PEPPER (ou TOTP_ENCRYPTION_KEY) manquant dans le .env : requis pour générer les pseudonymes.'
  );
}


function genererPseudonyme(registre, numeroDossier) {
  if (!registre || !numeroDossier) {
    throw new Error('registre et numeroDossier requis pour générer le pseudonyme.');
  }
  const hmac = crypto
    .createHmac('sha256', PEPPER)
    .update(`${registre}:${String(numeroDossier).trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();

  return `${registre}_${hmac}`;
}

module.exports = { genererPseudonyme };
