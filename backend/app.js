const express = require('express');
require('dotenv').config({ override: true });
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const totpRoutes = require('./routes/totpRoutes');

const analysisRoutes = require('./routes/analysisRoutes');
const coordonneePatientRoutes = require('./routes/coordonneePatientRoutes');
const clinicienOverviewRoutes = require('./routes/clinicienOverviewRoutes');
const dossierRoutes = require('./routes/dossierRoutes');
const dossierUploadRoutes = require('./routes/dossierUploadRoutes'); // AJOUT : création dossier + upload audio/scan
const extractionRoutes = require('./routes/extractionRoutes'); // AJOUT : étape 1 extraction (identité patient)
const app = express();

// Ces 4 middlewares doivent être montés AVANT toute route : sans cookieParser
// et express.json() en place, requireAuth (utilisé par /api/analyses) ne
// trouve ni cookie de session ni corps de requête parsé, et échoue en
// silence côté frontend (liste d'analyses vide, pas d'erreur visible).
app.use(helmet()); // en-têtes de sécurité HTTP (X-Content-Type-Options, HSTS, etc.)
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true, // indispensable pour que le navigateur envoie/accepte le cookie
}));
app.use(express.json());
app.use(cookieParser());

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/2fa', totpRoutes);
app.use('/api/analyses', analysisRoutes);
app.use('/api/coordonnees', coordonneePatientRoutes);
app.use('/api/clinicien', clinicienOverviewRoutes);
// IMPORTANT : dossierUploadRoutes AVANT dossierRoutes. dossierRoutes définit
// `GET /:pseudonyme` (wildcard un seul segment) qui, monté en premier,
// capturait par erreur `GET /api/dossiers/verifier` (pseudonyme="verifier")
// avant même d'atteindre la vraie route /verifier de dossierUploadRoutes —
// la vérification de doublon échouait donc systématiquement.
app.use('/api/dossiers', dossierUploadRoutes);
app.use('/api/dossiers', dossierRoutes);
app.use('/api/extraction', extractionRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));