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

module.exports = router;