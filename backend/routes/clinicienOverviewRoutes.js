const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClinicienOverview } = require('../controllers/clinicienOverviewController');
const { getClinicienRegistreSep } = require('../controllers/clinicienSepController');
const { getClinicienRegistreEpr } = require('../controllers/clinicienEprController');

router.use(requireAuth, requireRole('clinicien'));

// Vue d'Ensemble recentrée : Vue globale / Comparatif SEP-EPR / Alertes / Activité
router.get('/overview', getClinicienOverview);
// Fenêtre dédiée au registre SEP (détail clinique propre à la SEP pédiatrique)
router.get('/registre-sep', getClinicienRegistreSep);
// Fenêtre dédiée au registre EPR (détail clinique propre à l'épilepsie pharmacorésistante)
router.get('/registre-epr', getClinicienRegistreEpr);

module.exports = router;

// Dans app.js, ajouter :
//   const clinicienOverviewRoutes = require('./routes/clinicienOverviewRoutes');
//   app.use('/api/clinicien', clinicienOverviewRoutes);
