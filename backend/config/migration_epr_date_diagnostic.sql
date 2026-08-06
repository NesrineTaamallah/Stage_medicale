-- Ajoute date_diagnostic à epr_identification_clinique, symétrique de
-- sep_identification_clinique.date_diagnostic.
--
-- Contexte : lors de la création d'un dossier (wizard "Ajouter un patient"),
-- le clinicien saisit désormais une date de diagnostic ET une date
-- d'inclusion distinctes. La date d'inclusion va dans patients.date_inclusion
-- (déjà existante), la date de diagnostic doit être stockée au niveau de la
-- table d'identification clinique du registre concerné (SEP ou EPR) — cette
-- colonne manquait côté EPR.
--
-- Idempotent (IF NOT EXISTS) pour pouvoir être rejouée sans risque.

ALTER TABLE epr_identification_clinique
  ADD COLUMN IF NOT EXISTS date_diagnostic DATE;
