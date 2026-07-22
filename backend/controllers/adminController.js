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

/**
 * GET /admin/overview
 * Alimente l'onglet "Vue d'ensemble" : compteurs clés, alertes, activité
 * récente, statut email, et comptes en attente de 1ère connexion > 24h.
 */
async function getOverview(req, res) {
  try {
    const [byRole, statusCounts, recentLockAlerts, recentActivity, lastEmailLog, pendingFirstLogin] =
      await Promise.all([
        pool.query(`SELECT role, COUNT(*)::int AS count FROM users GROUP BY role`),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE last_login_at IS NULL)::int AS never_logged_in,
            COUNT(*) FILTER (WHERE locked_until IS NOT NULL AND locked_until > now())::int AS locked_now,
            COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive_accounts,
            COUNT(*)::int AS total_users
          FROM users
        `),
        pool.query(`
          SELECT COUNT(*)::int AS count
          FROM access_logs
          WHERE action LIKE 'LOGIN_ATTEMPT_LOCKED%' AND created_at > now() - interval '1 hour'
        `),
        pool.query(`
          SELECT al.id, al.action, al.success, al.ip_address, al.created_at, u.email AS user_email
          FROM access_logs al
          LEFT JOIN users u ON u.id = al.user_id
          WHERE al.action ~ '^(CREATE_USER|RESEND_TEMP_PASSWORD|RESET_2FA|UNLOCK_ACCOUNT|DEACTIVATE_ACCOUNT|REACTIVATE_ACCOUNT)'
          ORDER BY al.created_at DESC
          LIMIT 10
        `),
        pool.query(`
          SELECT action, success, created_at
          FROM access_logs
          WHERE action ~ '^(CREATE_USER|RESEND_TEMP_PASSWORD)'
          ORDER BY created_at DESC
          LIMIT 1
        `),
        pool.query(`
          SELECT id, email, role, created_at, temp_password_created_at
          FROM users
          WHERE must_change_password = true
            AND COALESCE(temp_password_created_at, created_at) < now() - interval '24 hours'
          ORDER BY COALESCE(temp_password_created_at, created_at) ASC
        `),
      ]);

    const roleCounts = { admin: 0, clinicien: 0, chercheur: 0 };
    byRole.rows.forEach((r) => { roleCounts[r.role] = r.count; });

    const emailLog = lastEmailLog.rows[0] || null;

    return res.json({
      totalUsers: statusCounts.rows[0].total_users,
      roleCounts,
      neverLoggedIn: statusCounts.rows[0].never_logged_in,
      lockedNow: statusCounts.rows[0].locked_now,
      inactiveAccounts: statusCounts.rows[0].inactive_accounts,
      alerts: {
        lockoutsLastHour: recentLockAlerts.rows[0].count,
      },
      recentActivity: recentActivity.rows,
      emailStatus: emailLog
        ? { success: emailLog.success, action: emailLog.action, at: emailLog.created_at }
        : null,
      pendingFirstLoginOver24h: pendingFirstLogin.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement de la vue d\'ensemble.' });
  }
}

const KNOWN_ACTIONS = [
  'LOGIN_ATTEMPT', 'LOGIN_ATTEMPT_LOCKED', 'LOGIN_ATTEMPT_WHILE_LOCKED',
  'LOGIN_ATTEMPT_DISABLED_ACCOUNT', 'LOGIN_PASSWORD_OK', 'LOGIN_PASSWORD_OK_AWAITING_TOTP',
  'LOGOUT', 'TOTP_ATTEMPT', 'TOTP_OK', 'CREATE_USER', 'CREATE_USER_EMAIL_FAILED',
  'RESET_2FA', 'RESEND_TEMP_PASSWORD', 'RESEND_TEMP_PASSWORD_EMAIL_FAILED',
  'UNLOCK_ACCOUNT', 'DEACTIVATE_ACCOUNT', 'REACTIVATE_ACCOUNT',
];

/**
 * GET /admin/logs
 * Flux brut filtrable (onglet Logs & Sécurité, section A).
 * Query params : action, userId, ip, dateFrom, dateTo, page, pageSize
 */
async function getLogs(req, res) {
  const { action, userId, ip, dateFrom, dateTo } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const conditions = [];
  const params = [];

  if (action) {
    params.push(`${action}%`);
    conditions.push(`al.action LIKE $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`al.user_id = $${params.length}`);
  }
  if (ip) {
    params.push(`%${ip}%`);
    conditions.push(`al.ip_address LIKE $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`al.created_at <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM access_logs al ${whereClause}`,
      params
    );

    params.push(pageSize);
    params.push(offset);
    const result = await pool.query(
      `SELECT al.id, al.user_id, u.email AS user_email, al.action, al.success,
              al.ip_address, al.created_at
       FROM access_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      rows: result.rows,
      total: countResult.rows[0].count,
      page,
      pageSize,
      knownActions: KNOWN_ACTIONS,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement des logs.' });
  }
}

/**
 * GET /admin/logs/anomalies
 * Vue synthétique des patterns suspects (onglet Logs & Sécurité, section B).
 * Heuristiques simples sur une fenêtre glissante (calculées à la volée —
 * pas de table de score dédiée pour l'instant, cf. "idées à considérer plus tard").
 */
async function getAnomalies(req, res) {
  try {
    const [bruteForce, credentialStuffing, totpBypass, freq2fa, massAdminActivity] = await Promise.all([
      pool.query(`
        SELECT u.email, COUNT(*)::int AS attempts, MAX(al.created_at) AS last_attempt
        FROM access_logs al
        JOIN users u ON u.id = al.user_id
        WHERE al.action IN ('LOGIN_ATTEMPT', 'LOGIN_ATTEMPT_LOCKED')
          AND al.created_at > now() - interval '24 hours'
        GROUP BY u.email
        HAVING COUNT(*) FILTER (WHERE al.action = 'LOGIN_ATTEMPT_LOCKED') > 0
        ORDER BY last_attempt DESC
      `),
      pool.query(`
        SELECT al.ip_address, COUNT(DISTINCT al.user_id)::int AS distinct_users, MAX(al.created_at) AS last_attempt
        FROM access_logs al
        WHERE al.action LIKE 'LOGIN_ATTEMPT%'
          AND al.ip_address IS NOT NULL
          AND al.created_at > now() - interval '24 hours'
        GROUP BY al.ip_address
        HAVING COUNT(DISTINCT al.user_id) >= 4
        ORDER BY distinct_users DESC
      `),
      pool.query(`
        SELECT u.email, COUNT(*)::int AS failed_attempts, MAX(al.created_at) AS last_attempt
        FROM access_logs al
        JOIN users u ON u.id = al.user_id
        WHERE al.action = 'TOTP_ATTEMPT' AND al.success = false
          AND al.created_at > now() - interval '24 hours'
        GROUP BY u.email
        HAVING COUNT(*) >= 3
        ORDER BY failed_attempts DESC
      `),
      pool.query(`
        SELECT u.email, COUNT(*)::int AS resets, MAX(al.created_at) AS last_reset
        FROM access_logs al
        JOIN users u ON u.id = al.user_id
        WHERE al.action LIKE 'RESET_2FA%'
          AND al.created_at > now() - interval '7 days'
        GROUP BY u.email
        HAVING COUNT(*) >= 2
        ORDER BY resets DESC
      `),
      pool.query(`
        SELECT al.user_id, u.email AS admin_email, COUNT(*)::int AS created_count
        FROM access_logs al
        JOIN users u ON u.id = al.user_id
        WHERE al.action LIKE 'CREATE_USER:%'
          AND al.created_at > now() - interval '1 hour'
        GROUP BY al.user_id, u.email
        HAVING COUNT(*) >= 5
        ORDER BY created_count DESC
      `),
    ]);

    // Connexions à horaires inhabituels : approximation simple —
    // connexions réussies entre 00h et 05h.
    const unusualHours = await pool.query(`
      SELECT u.email, al.created_at, al.ip_address
      FROM access_logs al
      JOIN users u ON u.id = al.user_id
      WHERE al.action = 'LOGIN_PASSWORD_OK'
        AND al.created_at > now() - interval '7 days'
        AND EXTRACT(HOUR FROM al.created_at) BETWEEN 0 AND 5
      ORDER BY al.created_at DESC
      LIMIT 20
    `);

    return res.json({
      bruteForceLockouts: bruteForce.rows,
      credentialStuffingIps: credentialStuffing.rows,
      totpBypassAttempts: totpBypass.rows,
      frequent2faResets: freq2fa.rows,
      massAdminActivity: massAdminActivity.rows,
      unusualHourLogins: unusualHours.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors du calcul des anomalies.' });
  }
}

/**
 * GET /admin/logs/user/:id
 * Timeline complète d'un compte (onglet Logs & Sécurité, section C).
 */
async function getUserTimeline(req, res) {
  const { id } = req.params;
  try {
    const userResult = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const logsResult = await pool.query(
      `SELECT id, action, success, ip_address, created_at
       FROM access_logs WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [id]
    );

    return res.json({ user: userResult.rows[0], logs: logsResult.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement de la timeline.' });
  }
}

/**
 * GET /admin/logs/export
 * Export CSV des logs pour une période donnée (onglet Logs & Sécurité, section D).
 */
async function exportLogsCsv(req, res) {
  const { action, userId, ip, dateFrom, dateTo } = req.query;
  const conditions = [];
  const params = [];

  if (action) {
    params.push(`${action}%`);
    conditions.push(`al.action LIKE $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`al.user_id = $${params.length}`);
  }
  if (ip) {
    params.push(`%${ip}%`);
    conditions.push(`al.ip_address LIKE $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`al.created_at <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT al.created_at, u.email AS user_email, al.action, al.success, al.ip_address
       FROM access_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 10000`,
      params
    );

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const header = ['Date', 'Utilisateur', 'Action', 'Succès', 'Adresse IP'].join(';');
    const lines = result.rows.map((r) => [
      new Date(r.created_at).toISOString(),
      r.user_email || '',
      r.action,
      r.success ? 'OUI' : 'NON',
      r.ip_address || '',
    ].map(escapeCsv).join(';'));

    const adminId = req.user.sub;
    await pool.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [adminId, 'EXPORT_LOGS_CSV', req.ip]
    );

    const csv = '\uFEFF' + [header, ...lines].join('\n'); // BOM pour Excel/accents FR
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logs-export-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'export.' });
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
  getOverview, // nouveau
  getLogs, // nouveau
  getAnomalies, // nouveau
  getUserTimeline, // nouveau
  exportLogsCsv, // nouveau
};