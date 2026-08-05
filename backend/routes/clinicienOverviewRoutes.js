const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClinicienOverview } = require('../controllers/clinicienOverviewController');
const { getClinicienRegistreSep } = require('../controllers/clinicienSepController');
const { getClinicienRegistreEpr } = require('../controllers/clinicienEprController');
const { getListePatientsAlerte } = require('../controllers/clinicienEntitesController');

router.use(requireAuth, requireRole('clinicien'));

// Vue d'Ensemble recentrée : Vue globale / Comparatif SEP-EPR / Alertes / Activité
router.get('/overview', getClinicienOverview);
// Fenêtre dédiée au registre SEP (détail clinique propre à la SEP pédiatrique)
router.get('/registre-sep', getClinicienRegistreSep);
// Fenêtre dédiée au registre EPR (détail clinique propre à l'épilepsie pharmacorésistante)
router.get('/registre-epr', getClinicienRegistreEpr);
// Fenêtre "Entités Médicales" : liste des patients derrière une carte d'alerte
router.get('/entites/alerte/:type', getListePatientsAlerte);

module.exports = router;

// Dans app.js, ajouter :
//   const clinicienOverviewRoutes = require('./routes/clinicienOverviewRoutes');
//   app.use('/api/clinicien', clinicienOverviewRoutes);
