const pool = require('../config/db');

/**
 * Écrit une ligne dans access_logs en capturant systématiquement le
 * user-agent et l'identifiant de session (jti du JWT) quand ils sont
 * disponibles. Centralise ce qui était avant dupliqué (et donc oublié
 * par endroits) dans chaque controller.
 *
 * - user_agent : permet de repérer "ce compte se connecte d'habitude
 *   depuis Chrome/Windows, là c'est soudain Firefox/Linux" (appareil
 *   suspect).
 * - session_id : le jti du token courant (req.user.jti) pour les actions
 *   déjà authentifiées, ou un jti fourni explicitement pour les actions
 *   qui créent un nouveau token (login, validation TOTP). Permet de
 *   détecter un jti réutilisé après révocation (vol/rejeu de session).
 *
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string} params.action
 * @param {boolean} params.success
 * @param {import('express').Request} params.req
 * @param {string|null} [params.sessionId] - jti explicite si pas dans req.user
 */
async function logAccess({ userId = null, action, success, req, sessionId = null }) {
  const ip = req?.ip ?? null;
  const userAgent = req?.headers?.['user-agent'] ?? null;
  const sid = sessionId ?? req?.user?.jti ?? null;

  await pool.query(
    `INSERT INTO access_logs (user_id, action, success, ip_address, user_agent, session_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, success, ip, userAgent, sid]
  );
}

module.exports = { logAccess };
