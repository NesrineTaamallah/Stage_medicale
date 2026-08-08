const crypto = require('crypto');
const pool = require('../config/db');
const { decrypt } = require('../utils/cryptoUtils');
const { verifyPassword } = require('../utils/passwordUtils');
const { logAccess } = require('../utils/accessLog');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

const SCRYPT_KEYLEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // recommandé pour GCM

/**
 * POST /api/coordonnees/export
 * body: { password, pseudonymes: string[] }
 *
 * Exporte la fiche complète (déchiffrée) des patients demandés sous forme
 * d'un fichier BINAIRE CHIFFRÉ (.enc), jamais en clair sur le disque du
 * clinicien ni en transit.
 *
 * Choix de conception :
 * - Le mot de passe du compte sert DEUX rôles volontairement distincts :
 *   1) réauthentification (comme /reveal) pour vérifier que c'est bien le
 *      clinicien connecté qui demande l'export ;
 *   2) dérivation de la clé de chiffrement du fichier exporté (via scrypt +
 *      sel aléatoire propre à cet export). Ainsi le fichier exporté n'est
 *      déchiffrable qu'avec CE mot de passe, jamais avec la clé serveur
 *      statique (TOTP_ENCRYPTION_KEY) utilisée pour le stockage en base —
 *      un fichier exporté reste protégé même s'il quitte le serveur
 *      (clé USB, email, etc.) et même en cas de compromission de la clé
 *      serveur après coup.
 * - Format binaire du fichier produit : salt(16) || iv(12) || authTag(16) || ciphertext.
 *   Un script de déchiffrement autonome est fourni dans
 *   backend/scripts/decrypt_export.js.
 */
async function exportPatients(req, res) {
  const { password, pseudonymes } = req.body;

  if (!password || !Array.isArray(pseudonymes) || pseudonymes.length === 0) {
    return res.status(400).json({ error: 'Mot de passe et liste de pseudonymes requis.' });
  }
  if (pseudonymes.length > 2000) {
    return res.status(400).json({ error: 'Trop de patients sélectionnés pour un seul export.' });
  }

  try {
    const userResult = await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [req.user.sub]);
    const user = userResult.rows[0];
    const valid = user && await verifyPassword(password, user.password_hash);

    if (!valid) {
      await logAccess({ userId: req.user.sub, action: 'export_patients', success: false, req });
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    // --- Récupération + déchiffrement des fiches demandées ---
    const patients = [];
    for (const pseudonyme of pseudonymes) {
      const patientResult = await pool.query(
        `SELECT pseudonyme, registre, date_inclusion FROM patients WHERE pseudonyme = $1`,
        [pseudonyme]
      );
      const patient = patientResult.rows[0];
      if (!patient) continue; // pseudonyme inconnu (course condition, ligne supprimée) : on l'ignore plutôt que d'échouer tout l'export

      const coordResult = await pool.query(
        `SELECT * FROM coordonnee_patient WHERE pseudonyme = $1`,
        [pseudonyme]
      );
      const row = coordResult.rows[0];

      const fiche = {
        pseudonyme: patient.pseudonyme,
        registre: patient.registre,
        date_inclusion: patient.date_inclusion,
      };
      for (const field of SENSITIVE_FIELDS) {
        fiche[field] = row && row[field] ? decrypt(row[field]) : null;
      }
      patients.push(fiche);
    }

    const payload = JSON.stringify({
      genere_le: new Date().toISOString(),
      exporte_par: user.email,
      total: patients.length,
      patients,
    });

    // --- Chiffrement du fichier exporté (clé dérivée du mot de passe, PAS
    //     la clé serveur — voir commentaire d'en-tête) ---
    const salt = crypto.randomBytes(SALT_LEN);
    const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const fichierChiffre = Buffer.concat([salt, iv, authTag, ciphertext]);

    await logAccess({ userId: req.user.sub, action: 'export_patients', success: true, req });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="export_patients_${timestamp}.enc"`);
    res.send(fichierChiffre);
  } catch (err) {
    console.error('Erreur exportPatients :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { exportPatients };
