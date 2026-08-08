const pool = require('../config/db');


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
