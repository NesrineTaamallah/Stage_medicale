
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const SCRYPT_KEYLEN = 32;

function demanderMotDePasse() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (str) => {
      if (str.includes('\n')) rl.output.write('\n');
    };
    rl.question('Mot de passe : ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage : node decrypt_export.js <fichier.enc> <sortie.json>');
    process.exit(1);
  }

  const fichier = fs.readFileSync(path.resolve(inputPath));
  if (fichier.length < SALT_LEN + IV_LEN + AUTH_TAG_LEN) {
    console.error('Fichier trop court : ce n\'est probablement pas un export valide.');
    process.exit(1);
  }

  const salt = fichier.subarray(0, SALT_LEN);
  const iv = fichier.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = fichier.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const ciphertext = fichier.subarray(SALT_LEN + IV_LEN + AUTH_TAG_LEN);

  const password = await demanderMotDePasse();
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    fs.writeFileSync(path.resolve(outputPath), decrypted);
    console.log(`OK — fichier déchiffré écrit dans ${outputPath}`);
  } catch (err) {
    console.error('Échec du déchiffrement : mot de passe incorrect ou fichier corrompu/altéré.');
    process.exit(1);
  }
}

main();
