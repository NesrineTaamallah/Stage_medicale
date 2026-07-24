/**
 * Exécute un fichier .sql de migration en réutilisant la même configuration
 * de connexion que le reste du backend (DB_HOST, DB_USER, etc. depuis .env),
 * pour éviter d'avoir à reconstruire à la main une commande psql avec tous
 * les paramètres de connexion.
 *
 * Usage :
 *   node backend/scripts/run-migration.js backend/config/migration_access_logs_meta.sql
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node backend/scripts/run-migration.js <chemin-vers-fichier.sql>');
    process.exit(1);
  }

  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Fichier introuvable : ${fullPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(fullPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log(`Exécution de ${filePath} sur la base ${process.env.DB_NAME}@${process.env.DB_HOST}...`);
    await client.query(sql);
    console.log('Migration appliquée avec succès.');
  } catch (err) {
    console.error('Erreur pendant la migration :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
