const pool = require('../config/db');
const { signToken, verifyToken, getJti } = require('../utils/jwtUtils');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');
const COOKIE_OPTIONS = require('../utils/cookieOptions');
const { logAccess } = require('../utils/accessLog');
const { sendAccountLockedAlertEmail } = require('../utils/mailer');
require('dotenv').config();

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Hash bcrypt valide (mot de passe arbitraire) utilisé uniquement pour
// normaliser le temps de réponse quand l'email n'existe pas -> empêche
// un attaquant de distinguer "email inconnu" de "mauvais mot de passe"
// en mesurant le temps de réponse (timing attack / énumération d'emails).
const DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstuuOa1zQZKzHZOL8CDPGPn4RY0Nx6Cy9K';

/**
 * Alerte tous les admins actifs par email quand un compte vient d'être
 * verrouillé (5 échecs de connexion). Volontairement fire-and-forget côté
 * appelant : un échec d'envoi ne doit jamais faire échouer la réponse de login.
 */
async function notifyAdminsAccountLocked(lockedUser) {
  const admins = await pool.query(
    `SELECT email FROM users WHERE role = 'admin' AND is_active = true`
  );
  for (const admin of admins.rows) {
    try {
      await sendAccountLockedAlertEmail(admin.email, lockedUser.email, lockedUser.role);
    } catch (emailErr) {
      console.error('Échec alerte verrouillage à', admin.email, '-', emailErr.message);
    }
  }
}

async function login(req, res) {
  const { email, password } = req.body; // déjà normalisé (lowercase) par le middleware validate

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      await verifyPassword(password, DUMMY_HASH); // normalise le temps de réponse
      await logAccess({ action: `LOGIN_ATTEMPT:${email}`, success: false, req });
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    // Bloque les comptes désactivés par un admin (suspension via onglet Utilisateurs).
    // Placé après la vérification d'existence (pour ne pas révéler l'existence du
    // compte à un attaquant) mais avant la vérification du mot de passe (pas la peine
    // de faire perdre du temps/tentatives à un compte déjà désactivé).
    if (user.is_active === false) {
      await logAccess({ userId: user.id, action: 'LOGIN_ATTEMPT_DISABLED_ACCOUNT', success: false, req });
      return res.status(403).json({ error: 'Ce compte a été désactivé. Contactez un administrateur.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      await logAccess({ userId: user.id, action: 'LOGIN_ATTEMPT_WHILE_LOCKED', success: false, req });
      return res.status(423).json({
        error: `Compte temporairement verrouillé suite à trop d'échecs. Réessayez dans ${minutesLeft} min.`,
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const shouldLock = attempts >= MAX_ATTEMPTS;

      await pool.query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [
          shouldLock ? 0 : attempts,
          shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
          user.id,
        ]
      );

      await logAccess({
        userId: user.id,
        action: shouldLock ? 'LOGIN_ATTEMPT_LOCKED' : 'LOGIN_ATTEMPT',
        success: false,
        req,
      });

      if (shouldLock) {
        // Fire-and-forget : n'attend pas l'envoi pour répondre à l'utilisateur verrouillé.
        notifyAdminsAccountLocked(user).catch((e) =>
          console.error('Échec notification admins (compte verrouillé) -', e.message)
        );
        return res.status(423).json({ error: `Trop d'échecs. Compte verrouillé pendant 15 minutes.` });
      }
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    if (user.failed_login_attempts > 0 || user.locked_until) {
      await pool.query(
        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
        [user.id]
      );
    }

    if (user.must_change_password) {
      const tempToken = signToken(
        { sub: user.id, email: user.email, role: user.role, scope: 'change_password_only' },
        { expiresIn: '15m' }
      );
      return res.json({ mustChangePassword: true, tempToken });
    }

    if (user.is_2fa_enabled) {
      const totpToken = signToken(
        { sub: user.id, email: user.email, role: user.role, scope: 'totp_pending' },
        { expiresIn: '10m' }
      );

      await logAccess({
        userId: user.id,
        action: 'LOGIN_PASSWORD_OK_AWAITING_TOTP',
        success: true,
        req,
        sessionId: getJti(totpToken),
      });

      return res.json({ requiresTotp: true, totpToken, role: user.role });
    }

    const now = Math.floor(Date.now() / 1000);
    const token = signToken(
      { sub: user.id, email: user.email, role: user.role, sessionStart: now },
      { expiresIn: '2h' }
    );

    res.cookie('token', token, COOKIE_OPTIONS);

    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    await logAccess({
      userId: user.id,
      action: 'LOGIN_PASSWORD_OK',
      success: true,
      req,
      sessionId: getJti(token),
    });

    return res.json({
      message: 'Connexion réussie.',
      user: { sub: user.id, email: user.email, role: user.role },
      requiresTotp: false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

async function changePassword(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token manquant.' });

  let payload;
  try {
    payload = verifyToken(authHeader.split(' ')[1]);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }

  if (payload.scope !== 'change_password_only') {
    return res.status(403).json({ error: 'Ce token ne permet pas cette action.' });
  }

  const { newPassword } = req.body; // déjà validé (longueur + complexité) par le middleware validate

  try {
    const newHash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
      [newHash, payload.sub]
    );

    await logAccess({ userId: payload.sub, action: 'PASSWORD_CHANGED', success: true, req, sessionId: payload.jti });

    return res.json({ message: 'Mot de passe mis à jour. Vous pouvez maintenant vous connecter.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

function me(req, res) {
  return res.json({ user: { sub: req.user.sub, email: req.user.email, role: req.user.role } });
}

async function logout(req, res) {
  try {
    await pool.query(
      `INSERT INTO revoked_tokens (jti, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3))
       ON CONFLICT (jti) DO NOTHING`,
      [req.user.jti, req.user.sub, req.user.exp]
    );

    await logAccess({ userId: req.user.sub, action: 'LOGOUT', success: true, req });

    res.clearCookie('token', { ...COOKIE_OPTIONS, maxAge: undefined });
    return res.json({ message: 'Déconnexion réussie.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { login, changePassword, logout, me };