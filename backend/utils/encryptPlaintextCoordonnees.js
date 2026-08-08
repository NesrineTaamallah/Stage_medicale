
const { encrypt } = require('./cryptoUtils');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

const ENCRYPTED_FORMAT = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

function isAlreadyEncrypted(value) {
  return typeof value === 'string' && ENCRYPTED_FORMAT.test(value);
}


async function encryptPlaintextCoordonnees(db) {
  const { rows } = await db.query(
    `SELECT pseudonyme, ${SENSITIVE_FIELDS.join(', ')} FROM coordonnee_patient`
  );

  let fixed = 0;

  for (const row of rows) {
    const updates = {};
    for (const field of SENSITIVE_FIELDS) {
      const value = row[field];
      if (value !== null && value !== undefined && !isAlreadyEncrypted(value)) {
        updates[field] = encrypt(String(value));
      }
    }

    const fieldsToUpdate = Object.keys(updates);
    if (fieldsToUpdate.length === 0) continue;

    const setClauses = fieldsToUpdate.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [row.pseudonyme, ...fieldsToUpdate.map((f) => updates[f])];

    await db.query(
      `UPDATE coordonnee_patient SET ${setClauses} WHERE pseudonyme = $1`,
      values
    );

    console.log(`   🔒 ${row.pseudonyme} : ${fieldsToUpdate.length} champ(s) rechiffré(s) automatiquement.`);
    fixed++;
  }

  return { scanned: rows.length, fixed };
}

module.exports = { encryptPlaintextCoordonnees, isAlreadyEncrypted };
