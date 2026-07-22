const bcrypt = require('bcrypt');
const crypto = require('crypto');
require('dotenv').config();

const SALT_ROUNDS = 12;
const PEPPER = process.env.PASSWORD_PEPPER;

if (!PEPPER || PEPPER.length < 32) {
  throw new Error(
    'PASSWORD_PEPPER manquant ou trop court dans le .env (minimum 32 caractères).'
  );
}

function generateTempPassword() {
  return crypto
    .randomBytes(12)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .slice(0, 14);
}

function applyPepper(plainPassword) {
  return crypto
    .createHmac('sha256', PEPPER)
    .update(plainPassword)
    .digest('hex');
}

async function hashPassword(plainPassword) {
  const peppered = applyPepper(plainPassword);
  return bcrypt.hash(peppered, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, storedHash) {
  const peppered = applyPepper(plainPassword);
  return bcrypt.compare(peppered, storedHash);
}

module.exports = {
  generateTempPassword,
  hashPassword,
  verifyPassword,
};
