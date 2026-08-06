const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { listDossiers, getDossierDetail, updateChampDossier } = require('../controllers/dossierController');

// Comme coordonneePatientRoutes : réservé aux cliniciens.
router.use(requireAuth, requireRole('clinicien'));

router.get('/', listDossiers);
router.get('/:pseudonyme', getDossierDetail);
router.patch('/:pseudonyme/champ', updateChampDossier);

module.exports = router;
