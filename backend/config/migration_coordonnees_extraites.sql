-- Un patient peut avoir plusieurs documents (visite, EEG, courrier...), reçus
-- au fil du temps. Pour permettre l'extraction "document par document" côté
-- fenêtre Entités Médicales (au lieu d'un seul bloc de texte concaténé), on a
-- besoin de savoir quels documents ont déjà servi à extraire des coordonnées
-- et lesquels ne l'ont pas encore été.
ALTER TABLE documents_bruts ADD COLUMN IF NOT EXISTS coordonnees_extraites BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_documents_bruts_coordonnees_extraites ON documents_bruts(coordonnees_extraites);
