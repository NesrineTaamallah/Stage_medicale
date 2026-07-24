const pool = require('../config/db');
const { signToken, verifyToken, getJti } = require('../utils/jwtUtils');
const { logAccess } = require('../utils/accessLog');
const {
  generateTotpSecret,
  getOtpauthUrl,
  generateQrCodeDataUrl,
  verifyTotpToken,
} = require('../utils/totpUtils');
const { encrypt, decrypt } = require('../utils/cryptoUtils');
const COOKIE_OPTIONS = require('../utils/cookieOptions');
require('dotenv').config();

async function setupTotp(req, res) {
  const userId = req.user.sub;
  const email = req.user.email;

  try {
    const secret = generateTotpSecret();
    const otpauthUrl = getOtpauthUrl(email, secret);
    const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUrl);

    await pool.query(`UPDATE users SET totp_secret = $1 WHERE id = $2`, [encrypt(secret), userId]);

    return res.json({
      message: 'Scannez ce QR code avec Google Authenticator ou Authy, puis confirmez avec un code.',
      qrCodeDataUrl,
      manualEntryKey: secret,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

async function confirmTotp(req, res) {
  const userId = req.user.sub;
  const { code } = req.body; // le middleware validate() ne conserve que les clés du schéma (totpCodeSchema -> "code")

  try {
    const result = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || !user.totp_secret) {
      return res.status(400).json({ error: "Aucun secret TOTP en attente. Lancez /2fa/setup d'abord." });
    }

    const decryptedSecret = decrypt(user.totp_secret);
    const valid = await verifyTotpToken(code, decryptedSecret);
    if (!valid) {
      return res.status(400).json({ error: 'Code invalide.' });
    }

    await pool.query(`UPDATE users SET is_2fa_enabled = true WHERE id = $1`, [userId]);

    return res.json({ message: '2FA activé avec succès.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

async function validateTotp(req, res) {
  const { totpToken, code } = req.body;

  let payload;
  try {
    payload = verifyToken(totpToken);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }

  if (payload.scope !== 'totp_pending') {
    return res.status(403).json({ error: 'Ce token ne permet pas cette action.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = result.rows[0];

    if (!user || !user.totp_secret) {
      return res.status(400).json({ error: '2FA non configuré pour cet utilisateur.' });
    }

    const decryptedSecret = decrypt(user.totp_secret);
    const valid = await verifyTotpToken(code, decryptedSecret);
    if (!valid) {
      await logAccess({ userId: user.id, action: 'TOTP_ATTEMPT', success: false, req });
      return res.status(401).json({ error: 'Code TOTP invalide.' });
    }

    const now = Math.floor(Date.now() / 1000);
    const finalToken = signToken(
      { sub: user.id, email: user.email, role: user.role, sessionStart: now },
      { expiresIn: '2h' }
    );

    res.cookie('token', finalToken, COOKIE_OPTIONS);

    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    await logAccess({
      userId: user.id,
      action: 'TOTP_OK',
      success: true,
      req,
      sessionId: getJti(finalToken),
    });

    return res.json({
      message: 'Authentification complète.',
      user: { sub: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * POST /2fa/self-reset-admin
 * Recours d'urgence : un admin qui a perdu son app d'authentification (donc
 * incapable de fournir un code TOTP) peut réinitialiser SA PROPRE 2FA depuis
 * cette route, en repartant directement de son totpToken (qui prouve déjà
 * qu'il a fourni le bon mot de passe lors du /login, il y a moins de 10 min).
 *
 * Réservé au rôle admin : si un admin ne peut plus se connecter, c'est
 * potentiellement toute la plateforme qui devient inaccessible (plus personne
 * pour gérer les comptes). Les autres rôles (clinicien, chercheur) continuent
 * de devoir passer par un admin actif — un compte non-admin bloqué n'a pas
 * cet effet de blocage global.
 *
 * Ceci reste un contournement volontaire de la 2FA, donc :
 *   - le token doit être valide et non expiré (scope totp_pending, 10 min),
 *   - l'action est journalisée explicitement (SELF_RESET_2FA_ADMIN) pour audit,
 *   - l'admin devra reconfigurer un nouveau QR code dès sa prochaine connexion
 *     (is_2fa_enabled repasse à false), il ne récupère PAS de session ici.
 */
async function selfResetAdminTotp(req, res) {
  const { totpToken } = req.body;

  let payload;
  try {
    payload = verifyToken(totpToken);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré. Reconnectez-vous avec votre email et mot de passe.' });
  }

  if (payload.scope !== 'totp_pending') {
    return res.status(403).json({ error: 'Ce token ne permet pas cette action.' });
  }

  if (payload.role !== 'admin') {
    return res.status(403).json({
      error: "Cette réinitialisation directe est réservée aux comptes admin. Contactez un administrateur pour réinitialiser votre 2FA.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_2fa_enabled = false, totp_secret = NULL WHERE id = $1 RETURNING id, email`,
      [payload.sub]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    await logAccess({ userId: payload.sub, action: 'SELF_RESET_2FA_ADMIN', success: true, req, sessionId: payload.jti });

    return res.json({
      message: '2FA réinitialisée. Reconnectez-vous avec votre email et mot de passe pour configurer un nouveau QR code.',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { setupTotp, confirmTotp, validateTotp, selfResetAdminTotp };