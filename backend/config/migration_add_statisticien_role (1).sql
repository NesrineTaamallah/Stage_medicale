-- Ajoute le rôle "statisticien" à l'enum user_role existant.
-- ALTER TYPE ... ADD VALUE ne peut pas être exécuté dans une transaction
-- avec d'autres commandes DDL sur ce même type dans certaines versions de
-- Postgres — on l'exécute donc seule, avec IF NOT EXISTS (Postgres 12+).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'statisticien';
