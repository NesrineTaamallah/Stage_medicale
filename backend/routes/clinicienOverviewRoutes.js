const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClinicienOverview } = require('../controllers/clinicienOverviewController');

router.use(requireAuth, requireRole('clinicien'));

router.get('/overview', getClinicienOverview);

module.exports = router;

// Dans app.js, ajouter :
//   const clinicienOverviewRoutes = require('./routes/clinicienOverviewRoutes');
//   app.use('/api/clinicien', clinicienOverviewRoutes);
