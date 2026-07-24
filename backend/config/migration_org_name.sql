-- Nom de la clinique/hôpital (clinicien) ou du labo/institut (chercheur).
-- NULL pour les admins, qui n'ont pas de rattachement organisationnel.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255);