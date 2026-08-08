const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', 
  sameSite: 'strict', 
  maxAge: 2 * 60 * 60 * 1000, 
  path: '/',
};

module.exports = COOKIE_OPTIONS;