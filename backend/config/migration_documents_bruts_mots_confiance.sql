-- Migration à exécuter une fois sur une base déjà existante (les nouvelles
-- bases créées via schema_documents.sql l'ont déjà par défaut).
-- Ajoute le stockage des scores de confiance par mot (Whisper : combinaison
-- avg_logprob/no_speech_prob + score d'alignement wav2vec2), utilisés par le
-- frontend pour colorer les mots peu fiables (rouge/jaune) dans le texte
-- transcrit affiché au clinicien. NULL pour les documents scannés (OCR) et
-- pour tous les documents transcrits avant cette migration.
ALTER TABLE documents_bruts ADD COLUMN IF NOT EXISTS mots_confiance JSONB;
