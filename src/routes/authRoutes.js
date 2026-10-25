const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { createRateLimiter } = require('../middlewares/rateLimit');
const { verifyToken } = require('../middlewares/auth');

// Không cache thông tin phiên hoặc token, kể cả response lỗi.
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Đăng nhập thất bại quá nhiều lần. Vui lòng thử lại sau 15 phút.'
});

// Khai báo đường dẫn: POST /api/auth/login
router.post('/login', loginLimiter, authController.login);
router.get('/me', verifyToken, authController.me);

module.exports = router;