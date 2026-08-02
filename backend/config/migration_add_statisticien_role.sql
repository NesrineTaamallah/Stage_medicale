-- Ajoute le rôle 'statisticien' à l'enum user_role existant.
-- ALTER TYPE ... ADD VALUE ne peut pas être exécuté dans un bloc BEGIN/COMMIT
-- explicite avec d'autres commandes DDL avant PostgreSQL 12+ ; on l'exécute seul.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'statisticien';
