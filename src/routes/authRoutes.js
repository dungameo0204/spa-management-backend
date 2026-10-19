const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { createRateLimiter } = require('../middlewares/rateLimit');

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Đăng nhập thất bại quá nhiều lần. Vui lòng thử lại sau 15 phút.'
});

// Khai báo đường dẫn: POST /api/auth/login
router.post('/login', loginLimiter, authController.login);

module.exports = router;