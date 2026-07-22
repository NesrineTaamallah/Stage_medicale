# NeuroExo-Predict — Backend

API Node.js/Express pour le registre clinique NeuroExo-Predict.
Authentification par email/mot de passe + 2FA TOTP obligatoire, gestion des rôles (admin, clinicien, chercheur).

## Prérequis

- Node.js ≥ 18
- PostgreSQL ≥ 14
- Un compte SMTP (Gmail avec mot de passe d'application, ou autre fournisseur)

## Installation

1. Se placer dans le dossier `backend/` :
   ```bash
   cd backend
   npm install
   ```

2. Copier le fichier d'exemple d'environnement et le compléter :
   ```bash
   cp .env.example .env
   ```

   Variables à définir dans `.env` :

   | Variable | Description |
   |---|---|
   | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Connexion PostgreSQL |
   | `DB_SSL` | `true`/`false` selon l'environnement |
   | `PASSWORD_PEPPER` | Clé forte (32+ caractères) — générer avec `openssl rand -hex 32` |
   | `JWT_SECRET` | Clé forte pour signer les JWT — générer avec `openssl rand -hex 32` |
   | `TOTP_ENCRYPTION_KEY` | Clé hex 32 octets pour chiffrer les secrets TOTP — générer avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Envoi d'email (mot de passe temporaire) |
   | `APP_URL` | URL du frontend (ex: `http://localhost:5173`) |
   | `PORT` | Port du serveur backend (défaut: `4000`) |
   | `CORS_ORIGIN` | URL exacte du frontend autorisée (ex: `http://localhost:5173`) |
   | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Identifiants du premier compte admin créé par le seed |
   | `NODE_ENV` | `development` en local, `production` en déploiement (active `Secure` sur le cookie) |

   ⚠️ Ne jamais committer `.env` dans Git. Ne jamais réutiliser les valeurs d'exemple telles quelles.

3. Créer la base de données PostgreSQL si elle n'existe pas :
   ```bash
   psql -U postgres -c "CREATE DATABASE neuroexo_predict;"
   ```

4. Appliquer le schéma de base :
   ```bash
   psql -U postgres -d neuroexo_predict -f config/schema.sql
   psql -U postgres -d neuroexo_predict -f config/migration_lockout.sql
   ```

5. Créer le compte admin initial :
   ```bash
   npm run seed
   ```

## Démarrage

```bash
npm run dev      # avec nodemon (rechargement automatique)
npm start        # sans nodemon (production)
```

Le serveur démarre sur `http://localhost:4000` (ou le port défini dans `.env`).

## Structure du projet

```
backend/
├── config/
│   ├── db.js                    # Pool de connexion PostgreSQL
│   ├── schema.sql               # Schéma initial des tables
│   └── migration_lockout.sql    # Ajout des colonnes de verrouillage de compte
├── controllers/
│   ├── authController.js        # login, changePassword, logout, me
│   ├── totpController.js        # setup / confirm / validate 2FA
│   └── adminController.js       # création d'utilisateurs, reset 2FA
├── middleware/
│   ├── auth.js                  # requireAuth (lit le cookie), requireRole
│   └── rateLimiter.js           # limiteurs sur /login et /2fa/validate
├── routes/
│   ├── authRoutes.js
│   ├── totpRoutes.js
│   └── adminRoutes.js
├── utils/
│   ├── jwtUtils.js              # sign / verify JWT
│   ├── passwordUtils.js         # hash / verify avec pepper
│   ├── totpUtils.js             # génération secret / QR TOTP
│   ├── cryptoUtils.js           # chiffrement AES-256-GCM du secret TOTP
│   ├── cookieOptions.js         # options du cookie httpOnly
│   └── mailer.js                # envoi d'email SMTP
├── app.js                       # point d'entrée Express
└── seed.js                      # création du premier admin
```

## Flux d'authentification

1. **Login** (`POST /login`) — email + mot de passe.
   - Si `must_change_password` → renvoie un `tempToken` (scope limité, 15 min).
   - Si `is_2fa_enabled` → renvoie un `totpToken` (scope limité, 10 min).
   - Sinon → pose un cookie `httpOnly` de session (2h) et renvoie `{ user }`.

2. **Changement de mot de passe** (`POST /change-password`, header `Authorization: Bearer <tempToken>`).

3. **Configuration 2FA** (`POST /2fa/setup`, `POST /2fa/confirm`, protégés par le cookie de session).

4. **Validation 2FA au login** (`POST /2fa/validate` avec `totpToken` + code) → pose le cookie de session final.

5. **Vérification de session** (`GET /me`, protégé par cookie) → utilisé par le frontend au chargement de l'app.

6. **Déconnexion** (`POST /logout`, protégé par cookie) → révoque le token (`jti`) et efface le cookie.

## Routes API

| Méthode | Route | Protection | Description |
|---|---|---|---|
| POST | `/login` | Rate limited | Connexion |
| POST | `/change-password` | Token temporaire | Changement de mot de passe obligatoire |
| POST | `/logout` | Cookie session | Déconnexion + révocation |
| GET | `/me` | Cookie session | Infos utilisateur connecté |
| POST | `/2fa/setup` | Cookie session | Génère le QR code TOTP |
| POST | `/2fa/confirm` | Cookie session | Active le 2FA |
| POST | `/2fa/validate` | Rate limited | Valide le code au login |
| POST | `/admin/users` | Cookie session + rôle admin | Créer un utilisateur |
| GET | `/admin/users` | Cookie session + rôle admin | Lister les utilisateurs |
| POST | `/admin/users/:id/reset-2fa` | Cookie session + rôle admin | Réinitialiser le 2FA d'un utilisateur |

## Sécurité en place

- Mots de passe : bcrypt (12 rounds) + pepper HMAC-SHA256
- JWT signés, à portée (`scope`) limitée selon l'étape du flux
- Cookie de session `httpOnly`, `SameSite=strict`, `Secure` en production
- Secret TOTP chiffré en base (AES-256-GCM)
- Rate limiting : 5 tentatives / 15 min sur `/login`, 5 / 10 min sur `/2fa/validate`
- Verrouillage de compte après 5 échecs de connexion (15 min)
- Révocation de token à la déconnexion (table `revoked_tokens`)
- Logs d'accès (`access_logs`) pour audit

## Notes de production

- Définir `NODE_ENV=production` pour activer `Secure` sur les cookies (nécessite HTTPS).
- Prévoir une purge périodique de `revoked_tokens` (entrées expirées) :
  ```sql
  DELETE FROM revoked_tokens WHERE expires_at < now();
  ```
- Ne jamais exposer `/config/*.sql` ou `.env` publiquement.
- Recommandé : ajouter `helmet` pour les en-têtes de sécurité HTTP et une validation stricte des entrées (`zod`/`joi`).
