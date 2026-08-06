-- ============================================================================
-- TABLE documents_bruts — un document uploadé par le clinicien (audio dicté
-- ou document scanné), AVANT pseudonymisation et extraction d'entités.
--
-- Volontairement indépendante de la table `patients` (registre pseudonymisé,
-- voir schema_registre.sql) : à ce stade du pipeline, seul le numéro de
-- dossier tel que saisi par le clinicien est connu. Le pseudonyme et le
-- rattachement aux tables SEP/EPR sont produits par l'étape suivante
-- (extraction d'entités / NER), pas ici.
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents_bruts (
    id                      SERIAL PRIMARY KEY,
    numero_dossier          VARCHAR(255) NOT NULL,
    pathologie              VARCHAR(10) NOT NULL CHECK (pathologie IN ('SEP', 'EPR')),
    date_diagnostic         DATE NOT NULL,
    type_document           VARCHAR(30) NOT NULL CHECK (
        type_document IN ('visite', 'admission', 'prelevement_sang', 'eeg', 'emg', 'irm', 'autre')
    ),
    type_entree             VARCHAR(10) NOT NULL CHECK (type_entree IN ('audio', 'scan')),
    chemin_fichier          TEXT NOT NULL,
    nom_fichier_original    TEXT,
    texte_transcrit         TEXT,               -- rempli pour type_entree = 'audio' (WhisperX)
    -- Pseudonyme réellement rattaché à ce document, fixé une fois pour
    -- toutes à la création (creerDossier) : soit recalculé par hash pour un
    -- nouveau dossier, soit repris tel quel (existingPatient.pseudonyme)
    -- pour un ajout de document à un patient déjà existant — y compris les
    -- pseudonymes "legacy" attribués à la main (ex. SEP_MJ_001), qui ne sont
    -- PAS dérivables par hash à partir du numero_dossier. Toute lecture
    -- ultérieure (getDocumentsByPseudonyme, corrigerTexteTranscrit) doit
    -- utiliser cette colonne directement plutôt que recalculer un hash, sous
    -- peine de rattacher le document à un pseudonyme fantôme différent de
    -- celui du patient réel. NULL uniquement pour les lignes créées avant
    -- l'ajout de cette colonne (repli par hash conservé pour celles-ci).
    pseudonyme               VARCHAR(255),
    statut                  VARCHAR(30) NOT NULL DEFAULT 'en_attente'
        CHECK (statut IN (
            'en_attente',            -- scan pas encore traité (OCR à venir)
            'transcrit',              -- audio transcrit avec succès
            'erreur_transcription',
            'pseudonymise'            -- traité par l'étape suivante (pseudonyme + entités attribués)
        )),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pour les bases déjà créées avant l'ajout de la colonne `pseudonyme`
-- ci-dessus (CREATE TABLE IF NOT EXISTS ne modifie pas une table existante).
ALTER TABLE documents_bruts ADD COLUMN IF NOT EXISTS pseudonyme VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_documents_bruts_numero_dossier ON documents_bruts(numero_dossier);
CREATE INDEX IF NOT EXISTS idx_documents_bruts_pseudonyme ON documents_bruts(pseudonyme);
