const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraireCoordonneesPatient } = require('../controllers/extractionController');

// Seul le clinicien déclenche l'extraction (accès aux données civiles).
router.use(requireAuth, requireRole('clinicien'));

// Étape 1 du pipeline d'extraction : identité patient/famille.
// Utilisé par le bouton "Extraire données patient" du wizard Ajouter
// (dossier neuf ou existant) et par "Extraire coordonnées" de la fenêtre
// Entités Médicales — même endpoint, même comportement de fusion.
router.post('/patient', extraireCoordonneesPatient);

module.exports = router;

// Dans app.js, ajouter :
//   const extractionRoutes = require('./routes/extractionRoutes');
//   app.use('/api/extraction', extractionRoutes);
