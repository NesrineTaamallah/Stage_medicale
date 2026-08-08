const pool = require('../config/db');
const { decrypt } = require('../utils/cryptoUtils');
const { verifyPassword } = require('../utils/passwordUtils');
const { logAccess } = require('../utils/accessLog');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

/**
 * POST /api/coordonnees/export
 * body: { password, pseudonymes: string[] }
 *
 * Exporte la fiche complète (déchiffrée) des patients demandés sous forme
 * d'un fichier CSV en clair (ouvrable directement dans Excel).
 *
 * ATTENTION SÉCURITÉ : ce fichier contient des données identifiantes en
 * clair (CIN, téléphone, adresse, nom, n° CNAM...). Contrairement à
 * l'ancien export chiffré (.enc), rien ne protège plus ce fichier une fois
 * téléchargé — c'est un choix explicite demandé côté clinicien pour
 * pouvoir l'ouvrir directement dans Excel. Le mot de passe reste requis
 * en amont pour réauthentifier le clinicien (empêcher un export "en un
 * clic" par une session laissée ouverte) mais ne sert plus à chiffrer
 * quoi que ce soit.
 */
function versLigneCsv(valeurs) {
  return valeurs
    .map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Échappement CSV standard : guillemets doublés, champ entre guillemets
      // dès qu'il contient une virgule, un guillemet ou un retour à la ligne.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

const CSV_COLUMNS = [
  { key: 'pseudonyme', label: 'Pseudonyme' },
  { key: 'registre', label: 'Registre' },
  { key: 'date_inclusion', label: "Date d'inclusion" },
  { key: 'numero_dossier', label: 'N° Dossier' },
  { key: 'nom_prenom', label: 'Nom et Prénom' },
  { key: 'date_naissance', label: 'Date de naissance' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'origine', label: 'Origine' },
  { key: 'telephone', label: 'Téléphone' },
  { key: 'cin', label: 'CIN' },
  { key: 'num_cnam', label: 'N° CNAM' },
  { key: 'nom_prenom_pere', label: 'Nom et Prénom (père)' },
  { key: 'nom_prenom_mere', label: 'Nom et Prénom (mère)' },
  { key: 'frere', label: 'Frère(s)' },
  { key: 'soeur', label: 'Sœur(s)' },
  { key: 'autre_antecedent', label: 'Autre antécédent' },
];
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

    // --- Génération du CSV (BOM UTF-8 pour qu'Excel affiche correctement
    //     les accents dès l'ouverture) ---
    const entete = versLigneCsv(CSV_COLUMNS.map((c) => c.label));
    const lignes = patients.map((fiche) =>
      versLigneCsv(CSV_COLUMNS.map((c) => fiche[c.key]))
    );
    const csv = '\uFEFF' + [entete, ...lignes].join('\r\n');

    await logAccess({ userId: req.user.sub, action: 'export_patients', success: true, req });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export_patients_${timestamp}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Erreur exportPatients :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { exportPatients };
