-- ============================================================================
-- Données de référence : les 24 gouvernorats tunisiens.
-- Nécessaire AVANT d'exécuter insert_sep_data.sql, car
-- sep_identification_clinique.gouvernorat_code référence cette table
-- (clé étrangère). Absent du repo d'origine — complété ici.
--
-- Convention de code observée dans insert_sep_data.sql : 3 premières lettres
-- du nom en majuscules (TUN, ARI, BEN, SFA, NAB...). Si le vrai pipeline NER
-- utilise une autre convention plus tard, il suffira d'adapter cette table.
-- ============================================================================

INSERT INTO gouvernorats_reference (code, nom, latitude_centroide, longitude_centroide) VALUES
  ('TUN', 'Tunis',        36.8065, 10.1815),
  ('ARI', 'Ariana',       36.8625, 10.1956),
  ('BEN', 'Ben Arous',    36.7533, 10.2189),
  ('MAN', 'Manouba',      36.8081, 10.0972),
  ('NAB', 'Nabeul',       36.4561, 10.7376),
  ('ZAG', 'Zaghouan',     36.4028, 10.1425),
  ('BIZ', 'Bizerte',      37.2744, 9.8739),
  ('BEJ', 'Béja',         36.7256, 9.1817),
  ('JEN', 'Jendouba',     36.5011, 8.7803),
  ('KEF', 'Le Kef',       36.1826, 8.7148),
  ('SIL', 'Siliana',      36.0844, 9.3708),
  ('SOU', 'Sousse',       35.8256, 10.6411),
  ('MON', 'Monastir',     35.7643, 10.8113),
  ('MAH', 'Mahdia',       35.5047, 11.0622),
  ('SFA', 'Sfax',         34.7406, 10.7603),
  ('KAI', 'Kairouan',     35.6781, 10.0963),
  ('KAS', 'Kasserine',    35.1676, 8.8365),
  ('SID', 'Sidi Bouzid',  35.0382, 9.4849),
  ('GAB', 'Gabès',        33.8815, 10.0982),
  ('MED', 'Médenine',     33.3549, 10.5055),
  ('TAT', 'Tataouine',    32.9297, 10.4518),
  ('GAF', 'Gafsa',        34.4250, 8.7842),
  ('TOZ', 'Tozeur',       33.9197, 8.1335),
  ('KEB', 'Kébili',       33.7044, 8.9690)
ON CONFLICT (code) DO NOTHING;
