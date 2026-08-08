

const pool = require('../config/db');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node backend/scripts/emergency-reset-2fa.js <email>');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      'SELECT id, email, role FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      console.error(`Aucun compte trouvé pour ${email}.`);
      process.exit(1);
    }

    const user = userResult.rows[0];
    if (user.role !== 'admin') {
      console.error(
        `${email} n'est pas admin (rôle: ${user.role}). ` +
        'Pour un compte clinicien/chercheur/statisticien, utilisez la réinitialisation depuis l\'interface (un autre admin actif suffit).'
      );
      process.exit(1);
    }

    await client.query(
      `UPDATE users SET is_2fa_enabled = false, totp_secret = NULL WHERE id = $1`,
      [user.id]
    );

    await client.query(
      `INSERT INTO access_logs (user_id, action, success, ip_address)
       VALUES ($1, $2, true, $3)`,
      [user.id, 'EMERGENCY_RESET_2FA:script', 'server-cli']
    );

    console.log(`2FA réinitialisée pour ${user.email}. Le compte devra reconfigurer un nouveau QR code à la prochaine connexion.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
