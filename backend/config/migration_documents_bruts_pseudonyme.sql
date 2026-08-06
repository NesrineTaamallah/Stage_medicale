-- Migration à exécuter une fois sur une base déjà existante (les nouvelles
-- bases créées via schema_documents.sql l'ont déjà par défaut).
-- Corrige le bug : les documents ajoutés à un patient "legacy" (pseudonyme
-- attribué à la main, ex. SEP_MJ_001) étaient rattachés à un pseudonyme
-- recalculé par hash différent, donc invisibles dans son dossier "détaillé".
ALTER TABLE documents_bruts ADD COLUMN IF NOT EXISTS pseudonyme VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_documents_bruts_pseudonyme ON documents_bruts(pseudonyme);
