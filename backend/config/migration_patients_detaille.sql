-- Ajoute la colonne `detaille` à `patients` : y sont accumulés (concaténés,
-- séparés par un séparateur horodaté) les textes extraits (transcription
-- audio WhisperX ou OCR de document scanné) une fois validés par le
-- clinicien depuis le wizard d'ajout de document. Une même pseudonyme peut
-- recevoir plusieurs documents au fil du temps -> on ajoute à la suite,
-- on n'écrase jamais.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS detaille TEXT;
