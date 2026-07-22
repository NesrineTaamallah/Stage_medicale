# NeuroExo-Predict — Frontend

Application React (Vite) pour le registre clinique NeuroExo-Predict.
Authentification par cookie httpOnly, interface différenciée par rôle (admin / clinicien / chercheur).

## Prérequis

- Node.js ≥ 18
- Le backend doit être démarré et accessible (par défaut `http://localhost:4000`)

## Installation

```bash
cd frontend
npm install
```

## Configuration

L'URL du backend est actuellement en dur dans `src/api/client.js` :

```js
const client = axios.create({
  baseURL: 'http://localhost:4000',
  withCredentials: true,
});
```

Si le backend tourne sur une autre adresse/port, modifiez cette valeur.

## Démarrage

```bash
npm run dev
```

L'application est accessible sur `http://localhost:5173`.

⚠️ Le backend doit avoir `CORS_ORIGIN=http://localhost:5173` dans son `.env` pour que les requêtes (et le cookie de session) fonctionnent correctement.

## Structure du projet

```
frontend/
└── src/
    ├── api/
    │   └── client.js           # instance axios (withCredentials: true)
    ├── context/
    │   └── AuthContext.jsx     # état d'authentification global
    ├── components/
    │   └── EegTrace.jsx        # élément visuel décoratif (signature EEG)
    ├── pages/
    │   ├── Login.jsx
    │   ├── ChangePassword.jsx
    │   ├── SetupTotp.jsx
    │   ├── VerifyTotp.jsx
    │   ├── AdminDashboard.jsx
    │   └── UserDashboard.jsx
    ├── App.jsx                 # routing + PrivateRoute
    ├── App.css
    ├── index.css
    └── main.jsx                # point d'entrée
```

## Fonctionnement de l'authentification côté frontend

Le token de session n'est **jamais accessible en JavaScript** (cookie `httpOnly` posé par le backend, protection contre le vol de session via XSS). Le frontend suit cette logique :

1. Au chargement de l'app (`AuthContext`), un appel `GET /me` détermine si une session valide existe déjà (cookie envoyé automatiquement par le navigateur).
2. Lors du login, si l'authentification est immédiate, le backend pose le cookie et renvoie `{ user }`, stocké en mémoire React (jamais en `localStorage`).
3. Les tokens intermédiaires (`tempToken` pour le changement de mot de passe, `totpToken` pour la validation 2FA) sont conservés en mémoire (state React) uniquement — perdus au rafraîchissement, ce qui force à recommencer l'étape (comportement voulu, car ce sont des tokens de courte durée).
4. `PrivateRoute` (dans `App.jsx`) bloque l'accès aux pages protégées tant que `user` n'est pas défini, avec un état `isLoading` pour éviter un flash de redirection pendant la vérification `/me`.

## Routes

| Route | Accès | Description |
|---|---|---|
| `/` | Public | Page de connexion |
| `/change-password` | Token temporaire requis | Changement de mot de passe obligatoire (première connexion) |
| `/setup-totp` | Session requise | Configuration du 2FA |
| `/verify-totp` | Token TOTP temporaire requis | Validation du code 2FA au login |
| `/admin` | Rôle `admin` requis | Création d'utilisateurs |
| `/dashboard` | Session requise | Tableau de bord clinicien / chercheur |

## Flux utilisateur type

1. L'utilisateur reçoit un email avec un mot de passe temporaire (créé par un admin).
2. Première connexion → redirection forcée vers `/change-password`.
3. Nouveau mot de passe défini → retour à `/` pour se reconnecter.
4. Si le 2FA n'est pas encore configuré → redirection vers `/setup-totp` (scan du QR code).
5. Aux connexions suivantes → `/verify-totp` demande le code à 6 chiffres.
6. Accès au tableau de bord adapté au rôle (`/admin` ou `/dashboard`).

## Build production

```bash
npm run build
```

Génère les fichiers statiques dans `dist/`, prêts à être servis par un serveur web (Nginx, etc.).

## Lint

```bash
npm run lint
```