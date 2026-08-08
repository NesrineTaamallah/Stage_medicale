
require('dotenv').config();
const pool = require('../config/db');
const { encrypt } = require('../utils/cryptoUtils');

const SENSITIVE_FIELDS = [
  'numero_dossier', 'nom_prenom', 'date_naissance', 'adresse', 'origine',
  'telephone', 'cin', 'num_cnam', 'nom_prenom_pere', 'nom_prenom_mere',
  'frere', 'soeur', 'autre_antecedent',
];


const PATIENTS = [
  {
    pseudonyme: 'SEP_AZ_005',
    coordonnees: {
      numero_dossier: 'DOS-2025-00512',
      nom_prenom: 'Amira Zoghlami',
      date_naissance: '2009-02-14',
      adresse: '12 Rue des Jasmins, Ariana, Tunisie',
      origine: 'Ariana',
      telephone: '+216 20 111 222',
      cin: '09512345',
      num_cnam: 'CNAM-AZ-0005512',
      nom_prenom_pere: 'Zoghlami Kamel',
      nom_prenom_mere: 'Zoghlami Sana',
      frere: 'Zoghlami Youssef (14 ans)',
      soeur: null,
      autre_antecedent: null,
    },
  },
  {
    pseudonyme: 'SEP_MBH_003',
    coordonnees: {
      numero_dossier: 'DOS-2025-00487',
      nom_prenom: 'Malek Ben Hassine',
      date_naissance: '2013-01-20',
      adresse: '45 Avenue Habib Bourguiba, Nabeul, Tunisie',
      origine: 'Nabeul',
      telephone: '+216 22 333 444',
      cin: '13487654',
      num_cnam: 'CNAM-MBH-0003487',
      nom_prenom_pere: 'Ben Hassine Fathi',
      nom_prenom_mere: 'Ben Hassine Leila',
      frere: 'Ben Hassine Sami (17 ans)',
      soeur: 'Ben Hassine Rania (15 ans)',
      autre_antecedent: 'Hypoacousie familiale (tante maternelle, cousin)',
    },
  },
  {
    pseudonyme: 'SEP_MJ_001',
    coordonnees: {
      numero_dossier: 'DOS-2026-00104',
      nom_prenom: 'Mehdi Jendoubi',
      date_naissance: '2011-03-05',
      adresse: '7 Rue de Carthage, Ben Arous, Tunisie',
      origine: 'Ben Arous',
      telephone: '+216 24 555 666',
      cin: '11104321',
      num_cnam: 'CNAM-MJ-0001104',
      nom_prenom_pere: 'Jendoubi Nabil',
      nom_prenom_mere: 'Jendoubi Wafa',
      frere: null,
      soeur: 'Jendoubi Ines (17 ans)',
      autre_antecedent: null,
    },
  },
  {
    pseudonyme: 'SEP_MJ_002',
    coordonnees: {
      numero_dossier: 'DOS-2023-00021',
      nom_prenom: 'Maryam Jaouadi',
      date_naissance: '2007-12-09',
      adresse: '3 Rue Ibn Khaldoun, Sfax, Tunisie',
      origine: 'Sfax',
      telephone: '+216 25 777 888',
      cin: '07021987',
      num_cnam: 'CNAM-MJ-0002021',
      nom_prenom_pere: 'Jaouadi Slim',
      nom_prenom_mere: 'Jaouadi Amel',
      frere: null,
      soeur: 'Jaouadi Yosra (19 ans)',
      autre_antecedent: 'Mort fœtale in utero chez la mère',
    },
  },
  {
    pseudonyme: 'SEP_ZM_004',
    coordonnees: {
      numero_dossier: 'DOS-2025-00398',
      nom_prenom: 'Zied Mansouri',
      date_naissance: '2009-03-19',
      adresse: '21 Rue de la République, Bizerte, Tunisie',
      origine: 'Bizerte',
      telephone: '+216 26 999 000',
      cin: '09398765',
      num_cnam: 'CNAM-ZM-0004398',
      nom_prenom_pere: 'Mansouri Adel',
      nom_prenom_mere: 'Mansouri Souad',
      frere: null,
      soeur: null,
      autre_antecedent: 'Tante maternelle suivie pour SEP depuis 21 ans',
    },
  },
];

async function fix() {
  for (const p of PATIENTS) {
    const setClauses = SENSITIVE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [
      p.pseudonyme,
      ...SENSITIVE_FIELDS.map((f) =>
        p.coordonnees[f] ? encrypt(String(p.coordonnees[f])) : null
      ),
    ];

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