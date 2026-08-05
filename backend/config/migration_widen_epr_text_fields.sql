-- ============================================================================
-- insert_epr_data.sql contient des descriptions cliniques plus longues que
-- les VARCHAR(n) prévus initialement dans schema_registre.sql. On élargit en
-- TEXT (comme le sont déjà cr_irm_texte, localisation_foyer, etc.) plutôt que
-- de tronquer des données cliniques réelles.
-- ============================================================================

ALTER TABLE epr_type_crise   ALTER COLUMN sous_type          TYPE TEXT;
ALTER TABLE epr_liste_ae     ALTER COLUMN reponse            TYPE TEXT;
ALTER TABLE epr_eeg          ALTER COLUMN type_anomalie       TYPE TEXT;
ALTER TABLE epr_imagerie     ALTER COLUMN type_lesion         TYPE TEXT;
ALTER TABLE epr_genetique    ALTER COLUMN mode_transmission   TYPE TEXT;
