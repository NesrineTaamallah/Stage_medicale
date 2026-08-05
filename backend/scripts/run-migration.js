/**
 * Exécute un fichier .sql de migration en réutilisant la même configuration
 * de connexion que le reste du backend (DB_HOST, DB_USER, etc. depuis .env).
 *
 * Différence avec l'ancienne version : ici chaque instruction SQL est
 * exécutée séparément (dans une transaction), pour pouvoir dire exactement
 * quelle instruction plante au lieu d'un vague "erreur de syntaxe sur ou
 * près de CREATE" qui ne précise pas laquelle des ~30 CREATE TABLE est en cause.
 *
 * Usage :
 *   node backend/scripts/run-migration.js backend/config/schema_registre.sql
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Découpe le fichier en instructions individuelles, en respectant :
 *  - les commentaires -- ligne
 *  - les chaînes entre guillemets simples '...'
 *  - les blocs $$ ... $$ (corps de fonctions plpgsql, ex. CREATE OR REPLACE FUNCTION)
 * pour ne pas couper un ';' qui se trouve à l'intérieur de l'un de ces blocs.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let inLineComment = false;
  let inSingleQuote = false;
  let dollarTag = null; // ex: '$$' ou '$tag$' quand on est dans un bloc dollar-quoted

  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    if (inLineComment) {
      current += c;
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }

    if (dollarTag) {
      current += c;
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag.slice(1); // le premier char déjà ajouté ci-dessus
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      current += c;
      if (c === "'" && sql[i + 1] !== "'") inSingleQuote = false;
      else if (c === "'" && sql[i + 1] === "'") { current += sql[i + 1]; i++; }
      i++;
      continue;
    }

    if (two === '--') {
      inLineComment = true;
      current += two;
      i += 2;
      continue;
    }

    if (c === "'") {
      inSingleQuote = true;
      current += c;
      i++;
      continue;
    }

    if (c === '$') {
      const match = sql.slice(i).match(/^\$[a-zA-Z_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (c === ';') {
      current += c;
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += c;
    i++;
  }

  const trimmedRest = current.trim();
  if (trimmedRest.length > 0) statements.push(trimmedRest);

  // Ignore les "instructions" qui ne contiennent en réalité que des
  // commentaires (ex. un bloc de notes en fin de fichier sans ';').
  return statements.filter((stmt) => {
    const withoutComments = stmt
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
      .trim();
    return withoutComments.length > 0;
  });
}

function firstMeaningfulLine(stmt) {
  const line = stmt
    .split('\n')
    .find((l) => l.trim().length > 0 && !l.trim().startsWith('--'));
  return (line || stmt).trim().slice(0, 120);
}

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

  let sql = fs.readFileSync(fullPath, 'utf8');

  // Retire un éventuel BOM (fréquent avec des fichiers sauvegardés/édités sous Windows)
  if (sql.charCodeAt(0) === 0xfeff) {
    console.log('BOM détecté en début de fichier — retiré automatiquement.');
    sql = sql.slice(1);
  }

  const statements = splitStatements(sql);
  console.log(`${statements.length} instruction(s) détectée(s) dans ${filePath}.`);

  const client = await pool.connect();
  try {
    console.log(`Connexion à la base ${process.env.DB_NAME}@${process.env.DB_HOST}...`);
    await client.query('BEGIN');

    for (let idx = 0; idx < statements.length; idx++) {
      const stmt = statements[idx];
      try {
        await client.query(stmt);
      } catch (err) {
        console.error(`\n❌ Erreur sur l'instruction n°${idx + 1}/${statements.length} :`);
        console.error(`   ${firstMeaningfulLine(stmt)}`);
        console.error(`   → ${err.message}`);
        await client.query('ROLLBACK');
        process.exit(1);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✅ Migration appliquée avec succès (${statements.length} instructions).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main();