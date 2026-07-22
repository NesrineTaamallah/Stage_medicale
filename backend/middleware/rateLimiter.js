const rateLimit = require('express-rate-limit');

// 5 tentatives / 15 min par IP sur le login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // ne compte pas les connexions réussies
});

// 5 tentatives / 10 min par IP sur la validation TOTP (code à 6 chiffres = bruteforçable)
const totpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives. Réessayez dans 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

module.exports = { loginLimiter, totpLimiter };