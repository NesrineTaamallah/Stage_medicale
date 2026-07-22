require('dotenv').config();
const pool = require('./config/db');
const { hashPassword } = require('./utils/passwordUtils');

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const plainPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !plainPassword) {
    console.error(
      'SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD doivent être définis dans le .env avant de lancer le seed.'
    );
    process.exit(1);
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log('Admin de test déjà présent.');
    process.exit(0);
  }

  const passwordHash = await hashPassword(plainPassword);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role, must_change_password)
     VALUES ($1, $2, 'admin', false)
     RETURNING id, email, role`,
    [email, passwordHash]
  );

  console.log('Admin de test créé :', result.rows[0]);
  console.log(`Identifiants -> ${email} / (mot de passe défini dans .env)`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
