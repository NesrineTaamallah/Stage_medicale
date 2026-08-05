const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/cryptoUtils');
const { verifyPassword } = require('../utils/passwordUtils');
const { logAccess } = require('../utils/accessLog');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

/**
 * GET /api/coordonnees
 * Liste uniquement les pseudonymes — jamais les champs chiffrés en clair,
 * même via cet endpoint. Le front affiche des placeholders floutés tant
 * que /reveal n'a pas été appelé pour la ligne concernée.
 */
async function listCoordonnees(req, res) {
  try {
    const result = await pool.query(
      `SELECT pseudonyme, created_at FROM coordonnee_patient ORDER BY created_at DESC`
    );
    res.json(result.rows.map((r) => ({ pseudonyme: r.pseudonyme, createdAt: r.created_at })));
  } catch (err) {
    console.error('Erreur listCoordonnees :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * POST /api/coordonnees/reveal
 * body: { pseudonyme, password }
 * Re-vérifie le mot de passe du clinicien connecté (comme une confirmation
 * de session) avant de déchiffrer et renvoyer la fiche complète. Chaque
 * appel — succès ou échec — est journalisé dans access_logs.
 */
async function revealCoordonnee(req, res) {
  const { pseudonyme, password } = req.body;

  if (!pseudonyme || !password) {
    return res.status(400).json({ error: 'Pseudonyme et mot de passe requis.' });
  }

  try {
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    const user = userResult.rows[0];
    const valid = user && await verifyPassword(password, user.password_hash);

    if (!valid) {
      await logAccess({ userId: req.user.sub, action: 'coordonnee_patient_reveal', success: false, req });
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    const result = await pool.query(
      `SELECT * FROM coordonnee_patient WHERE pseudonyme = $1`,
      [pseudonyme]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Fiche introuvable.' });
    }

    const decrypted = { pseudonyme: row.pseudonyme };
    for (const field of SENSITIVE_FIELDS) {
      decrypted[field] = row[field] ? decrypt(row[field]) : null;
    }

    await logAccess({ userId: req.user.sub, action: 'coordonnee_patient_reveal', success: true, req });
    res.json(decrypted);
  } catch (err) {
    console.error('Erreur revealCoordonnee :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/**
 * POST /api/coordonnees
 * body: { pseudonyme, ...champs en clair }
 * Chiffre chaque champ sensible avant stockage (fenêtre 3 / pseudonymisation).
 */
async function createCoordonnee(req, res) {
  const { pseudonyme, ...fields } = req.body;
  if (!pseudonyme) {
    return res.status(400).json({ error: 'Pseudonyme requis.' });
  }

  try {
    const columns = ['pseudonyme', ...SENSITIVE_FIELDS, 'created_by'];
    const values = [
      pseudonyme,
      ...SENSITIVE_FIELDS.map((f) => (fields[f] ? encrypt(String(fields[f])) : null)),
      req.user.sub,
    ];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    await pool.query(
      `INSERT INTO coordonnee_patient (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (pseudonyme) DO UPDATE SET
       ${SENSITIVE_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}`,
      values
    );

    await logAccess({ userId: req.user.sub, action: 'coordonnee_patient_create', success: true, req });
    res.status(201).json({ pseudonyme });
  } catch (err) {
    console.error('Erreur createCoordonnee :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { listCoordonnees, revealCoordonnee, createCoordonnee };