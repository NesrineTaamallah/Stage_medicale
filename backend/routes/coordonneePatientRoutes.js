const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  listCoordonnees,
  revealCoordonnee,
  createCoordonnee,
} = require('../controllers/coordonneePatientController');
const { exportPatients } = require('../controllers/exportController');

// Seuls les cliniciens manipulent les données civiles identifiantes.
router.use(requireAuth, requireRole('clinicien'));

router.get('/', listCoordonnees);
router.post('/reveal', revealCoordonnee);
router.post('/', createCoordonnee);
// Export chiffré (AES-256-GCM, clé dérivée du mot de passe du clinicien) —
// voir backend/controllers/exportController.js pour le détail du format.
router.post('/export', exportPatients);

module.exports = router;
