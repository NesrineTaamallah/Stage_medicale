CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'clinicien', 'chercheur');

CREATE TABLE IF NOT EXISTS users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 VARCHAR(255) UNIQUE NOT NULL,
    password_hash         VARCHAR(255) NOT NULL,
    role                  user_role NOT NULL,
    must_change_password  BOOLEAN NOT NULL DEFAULT true,
    totp_secret           VARCHAR(255),
    is_2fa_enabled        BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS access_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tokens révoqués avant leur expiration naturelle (logout, reset 2FA forcé, etc.)
-- On stocke jti (l'identifiant unique du token), pas le token entier.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL  -- copie de l'exp du token, pour purge future
);