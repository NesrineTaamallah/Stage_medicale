const pool = require('../config/db');
const { verifyToken, signToken } = require('../utils/jwtUtils');
const COOKIE_OPTIONS = require('../utils/cookieOptions');

const REFRESH_THRESHOLD_SECONDS = 30 * 60;   // renouvelle si moins de 30 min restantes
const MAX_SESSION_AGE_SECONDS = 12 * 60 * 60; // limite absolue : 12h, même en activité continue

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

  // --- Renouvellement glissant de la session ---
  // Si le token approche de l'expiration mais que l'utilisateur est actif
  // (il vient de faire une requête authentifiée), on lui repose un token frais.
  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;

  if (remaining < REFRESH_THRESHOLD_SECONDS) {
    const sessionStart = payload.sessionStart || now;
    const sessionAge = now - sessionStart;

    if (sessionAge > MAX_SESSION_AGE_SECONDS) {
      // Sécurité : même actif en continu, on force une reconnexion après 12h.
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

    // Révoque l'ancien jti pour qu'il ne reste pas utilisable en parallèle
    try {
      await pool.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at)
         VALUES ($1, $2, to_timestamp($3))
         ON CONFLICT (jti) DO NOTHING`,
        [payload.jti, payload.sub, payload.exp]
      );
    } catch (err) {
      // ALERTE SÉCURITÉ : l'ancien token n'a pas pu être révoqué. Il reste donc
      // valide jusqu'à sa propre expiration naturelle (jusqu'à 2h), au lieu
      // d'être coupé immédiatement au moment du renouvellement. Choix
      // pragmatique assumé (on ne bloque pas l'utilisateur pour une panne DB
      // transitoire), mais ce cas doit être surveillé/alerté en prod — ce
      // n'est pas une simple erreur applicative.
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