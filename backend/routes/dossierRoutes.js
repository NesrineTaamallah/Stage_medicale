const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { listDossiers, getDossierDetail } = require('../controllers/dossierController');

// Comme coordonneePatientRoutes : réservé aux cliniciens.
router.use(requireAuth, requireRole('clinicien'));

router.get('/', listDossiers);
router.get('/:pseudonyme', getDossierDetail);

module.exports = router;
