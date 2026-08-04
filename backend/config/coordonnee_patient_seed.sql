-- 1) Recrée les 3 patients dans la table pivot (elle est actuellement vide)
INSERT INTO patients (pseudonyme, registre, date_inclusion, age, sexe)
VALUES
  ('SEP_AZ_005', 'SEP', '2025-04-07', 16, 'F'),
  ('SEP_MBH_003', 'SEP', '2025-04-07', 12, 'F'),
  ('SEP_MJ_001', 'SEP', '2026-05-30', 15, 'M')
ON CONFLICT (pseudonyme) DO NOTHING;

-- 2) Coordonnées civiles associées
INSERT INTO coordonnee_patient (
  pseudonyme, numero_dossier, nom_prenom, date_naissance, adresse, origine,
  telephone, cin, num_cnam, nom_prenom_pere, nom_prenom_mere, frere, soeur, autre_antecedent
)
VALUES
  (
    'SEP_AZ_005', '2025-00001', 'Ben Salah Yasmine', '25/02/2012',
    '12 Rue Ibn Khaldoun, Tunis', 'Tunis', '+216 20 123 456', '09876543',
    '1122334455', 'Karim Ben Salah', 'Sana Ben Salah', 'Ahmed', 'Ines', 'RAS'
  ),
  (
    'SEP_MBH_003', '2025-00002', 'Dupont Lucas', '14/06/2015',
    '5 Avenue Habib Bourguiba, Sousse', 'Sousse', '+216 22 987 654', '08765432',
    '2233445566', 'Marc Dupont', 'Claire Dupont', '—', 'Emma', 'Épilepsie familiale'
  ),
  (
    'SEP_MJ_001', '2025-00003', 'Trabelsi Amine', '03/09/2013',
    '18 Rue de Carthage, Sfax', 'Sfax', '+216 55 456 789', '07654321',
    '3344556677', 'Nabil Trabelsi', 'Leïla Trabelsi', 'Yassine', '—', 'RAS'
  )
ON CONFLICT (pseudonyme) DO UPDATE SET
  numero_dossier    = EXCLUDED.numero_dossier,
  nom_prenom         = EXCLUDED.nom_prenom,
  date_naissance      = EXCLUDED.date_naissance,
  adresse              = EXCLUDED.adresse,
  origine               = EXCLUDED.origine,
  telephone              = EXCLUDED.telephone,
  cin                     = EXCLUDED.cin,
  num_cnam                 = EXCLUDED.num_cnam,
  nom_prenom_pere            = EXCLUDED.nom_prenom_pere,
  nom_prenom_mere              = EXCLUDED.nom_prenom_mere,
  frere                          = EXCLUDED.frere,
  soeur                           = EXCLUDED.soeur,
  autre_antecedent                 = EXCLUDED.autre_antecedent;