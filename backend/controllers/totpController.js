const pool = require('../config/db');
const { signToken, verifyToken } = require('../utils/jwtUtils');
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
      await pool.query(
        `INSERT INTO access_logs (user_id, action, success) VALUES ($1, $2, false)`,
        [user.id, 'TOTP_ATTEMPT']
      );
      return res.status(401).json({ error: 'Code TOTP invalide.' });
    }

    const now = Math.floor(Date.now() / 1000);
    const finalToken = signToken(
      { sub: user.id, email: user.email, role: user.role, sessionStart: now },
      { expiresIn: '2h' }
    );

    res.cookie('token', finalToken, COOKIE_OPTIONS);

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success) VALUES ($1, $2, true)`,
      [user.id, 'TOTP_OK']
    );

    return res.json({
      message: 'Authentification complète.',
      user: { sub: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { setupTotp, confirmTotp, validateTotp };