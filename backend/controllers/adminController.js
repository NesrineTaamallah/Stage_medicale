const pool = require('../config/db');
const { generateTempPassword, hashPassword } = require('../utils/passwordUtils');
const { sendTempPasswordEmail } = require('../utils/mailer');

async function createUser(req, res) {
  const { email, role } = req.body; // déjà validé (email + rôle) par le middleware validate
  const adminId = req.user.sub;

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, must_change_password, created_by)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, email, role, created_at`,
      [email, passwordHash, role, adminId]
    );
    const newUser = result.rows[0];

    // Envoi de l'email isolé dans son propre try/catch : si ça échoue,
    // on annule la création du compte pour ne jamais laisser un utilisateur
    // "fantôme" (créé en base mais jamais informé de son mot de passe).
    try {
      await sendTempPasswordEmail(email, tempPassword, role);
    } catch (emailErr) {
      console.error('Échec envoi email pour', email, '-', emailErr.message);

      // Rollback : on supprime le compte tout juste créé
      await pool.query('DELETE FROM users WHERE id = $1', [newUser.id]);

      await pool.query(
        `INSERT INTO access_logs (user_id, action, success, ip_address)
         VALUES ($1, $2, false, $3)`,
        [adminId, `CREATE_USER_EMAIL_FAILED:${email}`, req.ip]
      );

      return res.status(502).json({
        error:
          "Le compte n'a pas pu être créé : l'envoi de l'email a échoué. " +
          'Réessayez dans quelques instants (rien n\'a été enregistré).',
      });
    }

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, `CREATE_USER:${newUser.id}`, req.ip]
    );

    return res.status(201).json({
      message: 'Utilisateur créé, email envoyé avec le mot de passe temporaire.',
      user: newUser,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors de la création du compte.' });
  }
}

async function listUsers(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, email, role, must_change_password, is_2fa_enabled, created_at
       FROM users ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * POST /admin/users/:id/reset-2fa
 * Réservé à l'admin. Utilisé quand un utilisateur a perdu son téléphone
 * ou supprimé l'entrée dans son app d'authentification.
 * Remet le compte à l'état "2FA non configuré" -> l'utilisateur devra
 * re-scanner un nouveau QR code à sa prochaine connexion.
 */
async function resetTotp(req, res) {
  const { id } = req.params;
  const adminId = req.user.sub;

  try {
    const result = await pool.query(
      `UPDATE users
       SET is_2fa_enabled = false, totp_secret = NULL
       WHERE id = $1
       RETURNING id, email, role`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, `RESET_2FA:${id}`, req.ip]
    );

    return res.json({
      message: `2FA réinitialisé pour ${result.rows[0].email}. L'utilisateur devra reconfigurer un nouveau QR code à sa prochaine connexion.`,
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

const TEMP_PASSWORD_VALIDITY_HOURS = 48;

/**
 * Liste enrichie pour l'onglet Utilisateurs : statut du mot de passe
 * temporaire (en attente / probablement expiré) en plus des infos de base.
 */
async function listUsersDetailed(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, email, role, must_change_password, is_2fa_enabled,
              is_active, failed_login_attempts, locked_until,
              temp_password_created_at, last_login_at, created_at
       FROM users ORDER BY created_at DESC`
    );

    const now = Date.now();
    const users = result.rows.map((u) => {
      let tempPasswordStatus = null;
      if (u.must_change_password) {
        const createdAt = new Date(u.temp_password_created_at || u.created_at).getTime();
        const hoursElapsed = (now - createdAt) / (1000 * 60 * 60);
        tempPasswordStatus = hoursElapsed > TEMP_PASSWORD_VALIDITY_HOURS ? 'expired' : 'pending';
      }
      return { ...u, tempPasswordStatus };
    });

    return res.json(users);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * Régénère un mot de passe temporaire et le renvoie par email.
 * N'écrase le compte que si l'email part bien (même logique de rollback
 * "prudent" que createUser, mais ici on restaure l'ancien hash au lieu
 * de supprimer le compte).
 */
async function resendTempPassword(req, res) {
  const { id } = req.params;
  const adminId = req.user.sub;

  try {
    const existing = await pool.query('SELECT id, email, role, password_hash FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
    const user = existing.rows[0];
    const previousHash = user.password_hash;

    const tempPassword = generateTempPassword();
    const newHash = await hashPassword(tempPassword);

    await pool.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = true, temp_password_created_at = now()
       WHERE id = $2`,
      [newHash, id]
    );

    try {
      await sendTempPasswordEmail(user.email, tempPassword, user.role);
    } catch (emailErr) {
      console.error('Échec renvoi email pour', user.email, '-', emailErr.message);

      // On restaure l'ancien hash pour ne pas bloquer l'utilisateur avec
      // un mot de passe qu'il n'a jamais reçu.
      await pool.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [previousHash, id]
      );

      await pool.query(
        `INSERT INTO access_logs (user_id, action, success, ip_address)
         VALUES ($1, $2, false, $3)`,
        [adminId, `RESEND_TEMP_PASSWORD_EMAIL_FAILED:${id}`, req.ip]
      );

      return res.status(502).json({
        error: "L'envoi de l'email a échoué. Rien n'a été modifié, réessayez.",
      });
    }

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, `RESEND_TEMP_PASSWORD:${id}`, req.ip]
    );

    return res.json({ message: `Nouveau mot de passe temporaire envoyé à ${user.email}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/** Déverrouillage manuel d'un compte verrouillé après échecs de connexion. */
async function unlockUser(req, res) {
  const { id } = req.params;
  const adminId = req.user.sub;

  try {
    const result = await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL
       WHERE id = $1 RETURNING id, email`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, `UNLOCK_ACCOUNT:${id}`, req.ip]
    );

    return res.json({ message: `Compte de ${result.rows[0].email} déverrouillé.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/** Active/désactive un compte (suspension). Un admin ne peut pas se désactiver lui-même. */
async function toggleActive(req, res) {
  const { id } = req.params;
  const adminId = req.user.sub;

  if (id === adminId) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1
       RETURNING id, email, is_active`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const updated = result.rows[0];

    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, `${updated.is_active ? 'REACTIVATE' : 'DEACTIVATE'}_ACCOUNT:${id}`, req.ip]
    );

    return res.json({
      message: `Compte de ${updated.email} ${updated.is_active ? 'réactivé' : 'désactivé'}.`,
      user: updated,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = {
  createUser,
  listUsers,
  resetTotp,
  listUsersDetailed, // nouveau
  resendTempPassword, // nouveau
  unlockUser, // nouveau
  toggleActive, // nouveau
};