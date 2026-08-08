const crypto = require('crypto');
require('dotenv').config();

const ALGORITHM = 'aes-256-gcm';
const KEY = process.env.TOTP_ENCRYPTION_KEY; 

if (!KEY || Buffer.from(KEY, 'hex').length !== 32) {
  throw new Error(
    'TOTP_ENCRYPTION_KEY manquant ou invalide dans le .env (doit être une clé hex de 32 octets, ex: openssl rand -hex 32).'
  );
}

const keyBuffer = Buffer.from(KEY, 'hex');


function encrypt(plainText) {
  const iv = crypto.randomBytes(12); // 96 bits recommandé pour GCM
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}


function decrypt(payload) {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };