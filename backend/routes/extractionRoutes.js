const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraireCoordonneesPatient } = require('../controllers/extractionController');

router.use(requireAuth, requireRole('clinicien'));


router.post('/patient', extraireCoordonneesPatient);

module.exports = router;

