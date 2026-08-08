const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();


function signToken(payload, options) {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_SECRET, {
    ...options,
    algorithm: 'HS256',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}


function getJti(token) {
  const decoded = jwt.decode(token);
  return decoded?.jti ?? null;
}

module.exports = { signToken, verifyToken, getJti };