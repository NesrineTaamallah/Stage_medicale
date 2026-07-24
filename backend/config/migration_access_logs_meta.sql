-- Ajoute les métadonnées nécessaires pour deux nouvelles détections :
--   - session_id (jti du JWT) : permet de repérer un token volé/réutilisé
--     (le même jti ne doit correspondre qu'à une seule "lignée" d'usage).
--   - user_agent : permet de repérer un changement d'appareil/navigateur
--     inhabituel pour un compte donné.
-- Les deux colonnes sont nullables : les lignes déjà en base restent valides,
-- seules les nouvelles écritures les renseigneront (cf. utils/accessLog.js).

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS session_id UUID;

-- Utile pour la détection "vol de session" : retrouver rapidement toutes
-- les lignes d'un même jti.
CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON access_logs(session_id);
