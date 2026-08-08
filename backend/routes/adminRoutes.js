const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createUserSchema, userIdParamSchema } = require('../validators/schemas');
const {
  createUser,
  listUsers,
  resetTotp,
  listUsersDetailed,
  resendTempPassword,
  unlockUser,
  toggleActive,
  getOverview,
  getLogs,
  getAnomalies,
  getUserTimeline,
  exportLogsCsv,
  notifyDormantUsers,
  retryFailedEmails,
  sendCommunication,
  notifyMfaSetup,
} = require('../controllers/adminController');

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({ error: 'Paramètre invalide.' });
    }
    next();
  };
}

router.post('/users', requireAuth, requireRole('admin'), validate(createUserSchema), createUser);
router.get('/users', requireAuth, requireRole('admin'), listUsers);
router.get('/users/detailed', requireAuth, requireRole('admin'), listUsersDetailed);
router.post('/users/:id/reset-2fa', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), resetTotp);
router.post('/users/:id/resend-temp-password', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), resendTempPassword); 
router.post('/users/:id/unlock', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), unlockUser); 
router.post('/users/:id/toggle-active', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), toggleActive); 
router.post('/users/notify-dormant', requireAuth, requireRole('admin'), notifyDormantUsers); 
router.post('/users/retry-failed-emails', requireAuth, requireRole('admin'), retryFailedEmails); 

router.post('/communications/send', requireAuth, requireRole('admin'), sendCommunication); 
router.post('/users/notify-mfa-setup', requireAuth, requireRole('admin'), notifyMfaSetup); 

router.get('/overview', requireAuth, requireRole('admin'), getOverview);


router.get('/logs/export', requireAuth, requireRole('admin'), exportLogsCsv); 
router.get('/logs/anomalies', requireAuth, requireRole('admin'), getAnomalies);
router.get('/logs/user/:id', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), getUserTimeline); 
router.get('/logs', requireAuth, requireRole('admin'), getLogs); 

module.exports = router;