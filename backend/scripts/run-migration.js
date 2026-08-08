
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { encryptPlaintextCoordonnees } = require('../utils/encryptPlaintextCoordonnees');


function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let inLineComment = false;
  let inSingleQuote = false;
  let dollarTag = null; 

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
        current += dollarTag.slice(1); 
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

    
    if (/coordonnee_patient/i.test(sql)) {
      console.log('\n🔍 coordonnee_patient concernée par ce fichier — vérification du chiffrement...');
      const { scanned, fixed } = await encryptPlaintextCoordonnees(pool);
      if (fixed === 0) {
        console.log(`   Rien à faire (${scanned} fiche(s) déjà chiffrée(s)).`);
      } else {
        console.log(`   ✅ ${fixed}/${scanned} fiche(s) rechiffrée(s) automatiquement.`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main();