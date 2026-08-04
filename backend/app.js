const express = require('express');
require('dotenv').config();
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const totpRoutes = require('./routes/totpRoutes');

const analysisRoutes = require('./routes/analysisRoutes');
const app = express();

app.use('/api/analyses', analysisRoutes);
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));