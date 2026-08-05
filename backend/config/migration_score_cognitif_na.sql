-- Migration : ajoute la colonne satellite NA manquante sur sep_suivi.score_cognitif
-- (Priorité 5, base_postgres.md ligne 41). À exécuter une seule fois sur une base
-- déjà migrée avec l'ancienne version de schema_registre.sql (score_cognitif sans
-- son satellite). Sans effet si déjà appliquée (IF NOT EXISTS).

ALTER TABLE sep_suivi
    ADD COLUMN IF NOT EXISTS score_cognitif_non_applicable BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sep_suivi.score_cognitif_non_applicable IS
    'Satellite NA (Priorité 5) : TRUE si le score cognitif n''est pas testable selon l''âge du patient (non applicable), à distinguer de NULL (non encore testé/renseigné).';
