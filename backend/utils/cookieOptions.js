const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // true en HTTPS (prod), false en localhost (dev)
  sameSite: 'strict', // protège contre le CSRF cross-site
  maxAge: 2 * 60 * 60 * 1000, // 2h, aligné sur expiresIn du JWT
  path: '/',
};

module.exports = COOKIE_OPTIONS;