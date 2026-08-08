const pool = require('../config/db');
const { verifyToken, signToken } = require('../utils/jwtUtils');
const COOKIE_OPTIONS = require('../utils/cookieOptions');

const REFRESH_THRESHOLD_SECONDS = 30 * 60;   
const MAX_SESSION_AGE_SECONDS = 12 * 60 * 60; 

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }

  try {
    const revoked = await pool.query('SELECT 1 FROM revoked_tokens WHERE jti = $1', [payload.jti]);
    if (revoked.rows.length > 0) {
      return res.status(401).json({ error: 'Token révoqué. Reconnectez-vous.' });
    }
  } catch (err) {
    console.error('Erreur vérification révocation :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }

  req.user = payload;

  
  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;

  if (remaining < REFRESH_THRESHOLD_SECONDS) {
    const sessionStart = payload.sessionStart || now;
    const sessionAge = now - sessionStart;

    if (sessionAge > MAX_SESSION_AGE_SECONDS) {
      return res.status(401).json({ error: 'Session expirée après 12h. Reconnectez-vous.' });
    }

    const newToken = signToken(
      {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        sessionStart,
      },
      { expiresIn: '2h' }
    );

    res.cookie('token', newToken, COOKIE_OPTIONS);

    try {
      await pool.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at)
         VALUES ($1, $2, to_timestamp($3))
         ON CONFLICT (jti) DO NOTHING`,
        [payload.jti, payload.sub, payload.exp]
      );
    } catch (err) {
      
      console.error(
        '[SECURITY] Échec de révocation du token lors du renouvellement — ancien jti reste valide jusqu\'à expiration :',
        { jti: payload.jti, userId: payload.sub, err }
      );
    }
  }

  next();
}

function requireRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.user || !rolesAutorises.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé pour ce rôle.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };