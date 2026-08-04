/**
 * Corrige les fiches coordonnee_patient insérées EN CLAIR (via un INSERT SQL
 * direct) en les rechiffrant avec la même fonction encrypt() que l'API,
 * pour que /api/coordonnees/reveal (et donc decrypt()) fonctionne.
 *
 * Usage (depuis le dossier backend/) :
 *   node scripts/fix-encrypt-coordonnees.js
 */
require('dotenv').config();
const pool = require('../config/db');
const { encrypt } = require('../utils/cryptoUtils');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];

// Mêmes 3 patients simulés que le seed SQL précédent, avec leurs vraies
// valeurs en clair (nécessaires pour pouvoir les rechiffrer correctement).
const PATIENTS = [
  {
    pseudonyme: 'SEP_AZ_005',
    coordonnees: {
      numero_dossier: '2025-00001',
      nom_prenom: 'Ben Salah Yasmine',
      date_naissance: '25/02/2012',
      adresse: '12 Rue Ibn Khaldoun, Tunis',
      origine: 'Tunis',
      telephone: '+216 20 123 456',
      cin: '09876543',
      num_cnam: '1122334455',
      nom_prenom_pere: 'Karim Ben Salah',
      nom_prenom_mere: 'Sana Ben Salah',
      frere: 'Ahmed',
      soeur: 'Ines',
      autre_antecedent: 'RAS',
    },
  },
  {
    pseudonyme: 'SEP_MBH_003',
    coordonnees: {
      numero_dossier: '2025-00002',
      nom_prenom: 'Dupont Lucas',
      date_naissance: '14/06/2015',
      adresse: '5 Avenue Habib Bourguiba, Sousse',
      origine: 'Sousse',
      telephone: '+216 22 987 654',
      cin: '08765432',
      num_cnam: '2233445566',
      nom_prenom_pere: 'Marc Dupont',
      nom_prenom_mere: 'Claire Dupont',
      frere: '—',
      soeur: 'Emma',
      autre_antecedent: 'Épilepsie familiale',
    },
  },
  {
    pseudonyme: 'SEP_MJ_001',
    coordonnees: {
      numero_dossier: '2025-00003',
      nom_prenom: 'Trabelsi Amine',
      date_naissance: '03/09/2013',
      adresse: '18 Rue de Carthage, Sfax',
      origine: 'Sfax',
      telephone: '+216 55 456 789',
      cin: '07654321',
      num_cnam: '3344556677',
      nom_prenom_pere: 'Nabil Trabelsi',
      nom_prenom_mere: 'Leïla Trabelsi',
      frere: 'Yassine',
      soeur: '—',
      autre_antecedent: 'RAS',
    },
  },
];

async function fix() {
  for (const p of PATIENTS) {
    const setClauses = SENSITIVE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [p.pseudonyme, ...SENSITIVE_FIELDS.map((f) => encrypt(String(p.coordonnees[f])))];

    const result = await pool.query(
      `UPDATE coordonnee_patient SET ${setClauses} WHERE pseudonyme = $1`,
      values
    );

    console.log(
      result.rowCount > 0
        ? `OK — ${p.pseudonyme} rechiffré.`
        : `Ignoré — ${p.pseudonyme} introuvable dans coordonnee_patient.`
    );
  }

  console.log('Terminé.');
  process.exit(0);
}

fix().catch((err) => {
  console.error('Erreur pendant le rechiffrement :', err);
  process.exit(1);
});
