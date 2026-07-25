const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { totpLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const { totpCodeSchema, totpValidateSchema, selfResetAdminSchema } = require('../validators/schemas');
const { setupTotp, confirmTotp, validateTotp, selfResetAdminTotp } = require('../controllers/totpController');

router.post('/setup', requireAuth, setupTotp);
router.post('/confirm', requireAuth, validate(totpCodeSchema), confirmTotp);
router.post('/validate', totpLimiter, validate(totpValidateSchema), validateTotp);
router.post('/self-reset-admin', totpLimiter, validate(selfResetAdminSchema), selfResetAdminTotp);

module.exports = router;