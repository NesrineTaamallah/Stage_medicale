-- Ajouts nécessaires pour l'onglet Utilisateurs (gestion du cycle de vie des comptes)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS temp_password_created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;