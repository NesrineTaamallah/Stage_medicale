const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  listCoordonnees,
  revealCoordonnee,
  createCoordonnee,
} = require('../controllers/coordonneePatientController');
const { exportPatients } = require('../controllers/exportController');

router.use(requireAuth, requireRole('clinicien'));

router.get('/', listCoordonnees);
router.post('/reveal', revealCoordonnee);
router.post('/', createCoordonnee);

router.post('/export', exportPatients);

module.exports = router;
