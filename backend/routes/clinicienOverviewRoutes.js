const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClinicienOverview } = require('../controllers/clinicienOverviewController');
const { getClinicienRegistreSep } = require('../controllers/clinicienSepController');
const { getClinicienRegistreEpr } = require('../controllers/clinicienEprController');
const { getListePatientsAlerte } = require('../controllers/clinicienEntitesController');

router.use(requireAuth, requireRole('clinicien'));

router.get('/overview', getClinicienOverview);
router.get('/registre-sep', getClinicienRegistreSep);
router.get('/registre-epr', getClinicienRegistreEpr);
router.get('/entites/alerte/:type', getListePatientsAlerte);

module.exports = router;


