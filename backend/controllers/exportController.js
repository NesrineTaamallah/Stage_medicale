const pool = require('../config/db');
const { decrypt } = require('../utils/cryptoUtils');
const { verifyPassword } = require('../utils/passwordUtils');
const { logAccess } = require('../utils/accessLog');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];


function versLigneCsv(valeurs) {
  return valeurs
    .map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
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

    const patients = [];
    for (const pseudonyme of pseudonymes) {
      const patientResult = await pool.query(
        `SELECT pseudonyme, registre, date_inclusion FROM patients WHERE pseudonyme = $1`,
        [pseudonyme]
      );
      const patient = patientResult.rows[0];
      if (!patient) continue; 

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
