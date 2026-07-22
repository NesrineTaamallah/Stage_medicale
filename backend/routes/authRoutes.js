const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const { loginSchema, changePasswordSchema } = require('../validators/schemas');
const { login, changePassword, logout, me } = require('../controllers/authController');

router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/change-password', validate(changePasswordSchema), changePassword);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);

module.exports = router;