const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  listCoordonnees,
  revealCoordonnee,
  createCoordonnee,
} = require('../controllers/coordonneePatientController');

// Seuls les cliniciens manipulent les données civiles identifiantes.
router.use(requireAuth, requireRole('clinicien'));

router.get('/', listCoordonnees);
router.post('/reveal', revealCoordonnee);
router.post('/', createCoordonnee);

module.exports = router;
