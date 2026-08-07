-- Ajoute une colonne chemin_fichier (chemin relatif du document uploadé :
-- image/PDF de l'IRM, tracé EEG scanné, compte-rendu LCR, etc.) aux tables
-- "répétées" qui correspondent à un examen pouvant avoir une pièce jointe.
-- Colonne nullable : un examen peut rester sans document, comme aujourd'hui.
--
-- Volontairement TEXT (chemin relatif sous backend/uploads/entites/...) et
-- non un BYTEA : cohérent avec documents_bruts.chemin_fichier (voir
-- schema_documents.sql) qui suit déjà cette convention.

-- Ajoute une colonne chemin_fichier (chemin relatif du document uploadé :
-- image/PDF de l'IRM, tracé EEG scanné, compte-rendu LCR, bilan, etc.) à
-- toutes les tables "répétées" qui correspondent à un résultat d'examen ou
-- un compte-rendu pouvant avoir une pièce jointe. Colonne nullable : un
-- examen peut rester sans document, comme aujourd'hui.
--
-- Volontairement TEXT (chemin relatif sous backend/uploads/entites/...) et
-- non un BYTEA : cohérent avec documents_bruts.chemin_fichier (voir
-- schema_documents.sql) qui suit déjà cette convention.

-- Registre SEP
ALTER TABLE sep_edss_visites       ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE sep_irm                ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE sep_biologie_lcr       ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE sep_potentiels_evoques ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;

-- Registre EPR
ALTER TABLE epr_examen               ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_eeg                  ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_imagerie             ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_genetique            ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_bilan_prechirurgical ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_chirurgie            ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_bilan_orthophonique  ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_bilan_neuropsy       ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;
ALTER TABLE epr_bilan_ergotherapique ADD COLUMN IF NOT EXISTS chemin_fichier TEXT;

-- Nom original conservé séparément pour l'affichage (chemin_fichier est un
-- nom de fichier généré, illisible pour l'utilisateur).

-- Registre SEP
ALTER TABLE sep_edss_visites       ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE sep_irm                ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE sep_biologie_lcr       ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE sep_potentiels_evoques ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;

-- Registre EPR
ALTER TABLE epr_examen               ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_eeg                  ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_imagerie             ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_genetique            ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_bilan_prechirurgical ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_chirurgie            ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_bilan_orthophonique  ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_bilan_neuropsy       ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;
ALTER TABLE epr_bilan_ergotherapique ADD COLUMN IF NOT EXISTS nom_fichier_original TEXT;

