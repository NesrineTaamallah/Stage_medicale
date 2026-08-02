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
router.get('/users/detailed', requireAuth, requireRole('admin'), listUsersDetailed); // nouveau
router.post('/users/:id/reset-2fa', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), resetTotp);
router.post('/users/:id/resend-temp-password', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), resendTempPassword); // nouveau
router.post('/users/:id/unlock', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), unlockUser); // nouveau
router.post('/users/:id/toggle-active', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), toggleActive); // nouveau
router.post('/users/notify-dormant', requireAuth, requireRole('admin'), notifyDormantUsers); // nouveau
router.post('/users/retry-failed-emails', requireAuth, requireRole('admin'), retryFailedEmails); // nouveau

// --- Onglet Communications ---
router.post('/communications/send', requireAuth, requireRole('admin'), sendCommunication); // nouveau
router.post('/users/notify-mfa-setup', requireAuth, requireRole('admin'), notifyMfaSetup); // nouveau

// --- Onglet Vue d'ensemble ---
router.get('/overview', requireAuth, requireRole('admin'), getOverview); // nouveau

// --- Onglet Logs & Sécurité ---
// NB : /logs/export et /logs/anomalies et /logs/user/:id doivent être déclarés
// avant toute route générique pour éviter les conflits de matching Express.
router.get('/logs/export', requireAuth, requireRole('admin'), exportLogsCsv); // nouveau
router.get('/logs/anomalies', requireAuth, requireRole('admin'), getAnomalies); // nouveau
router.get('/logs/user/:id', requireAuth, requireRole('admin'), validateParams(userIdParamSchema), getUserTimeline); // nouveau
router.get('/logs', requireAuth, requireRole('admin'), getLogs); // nouveau

module.exports = router;