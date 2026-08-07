-- Ajoute sexe à epr_identification_clinique, symétrique de
-- sep_identification_clinique.sexe.
--
-- Contexte : le registre EPR ne capturait pas le sexe du patient, ce qui
-- forçait la carte "Répartition par sexe" de la Vue d'Ensemble à se limiter
-- au registre SEP avec un avertissement dédié. Cette colonne comble l'écart
-- entre les deux registres pour permettre une répartition par sexe sur
-- l'ensemble de la cohorte (SEP + EPR).
--
-- Idempotent (IF NOT EXISTS) pour pouvoir être rejouée sans risque.

ALTER TABLE epr_identification_clinique
  ADD COLUMN IF NOT EXISTS sexe VARCHAR(10);  -- M / F, même convention que sep_identification_clinique.sexe
