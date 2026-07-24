const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

/**
 * Signe un token JWT en ajoutant systématiquement un jti (identifiant unique).
 * Garantit que deux tokens ne sont jamais identiques, même émis à la même
 * seconde pour le même utilisateur, et permet la révocation ciblée.
 * Algorithme forcé explicitement (défense en profondeur).
 */
function signToken(payload, options) {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_SECRET, {
    ...options,
    algorithm: 'HS256',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Extrait le jti d'un token qu'on vient tout juste de signer nous-mêmes
 * (pas besoin de re-vérifier la signature ici, jwt.decode suffit et évite
 * une opération crypto redondante). Utilisé pour journaliser le session_id
 * au moment où un nouveau token est émis (login, validation TOTP).
 */
function getJti(token) {
  const decoded = jwt.decode(token);
  return decoded?.jti ?? null;
}

module.exports = { signToken, verifyToken, getJti };