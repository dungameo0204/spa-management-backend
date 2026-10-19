const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { verifyToken, verifyManager } = require('../middlewares/auth');
const { createRateLimiter } = require('../middlewares/rateLimit');

const resetPasswordLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Đã yêu cầu đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.'
});

// Chỉ MANAGER đang đăng nhập được đặt lại mật khẩu khách thuộc chính Spa của mình.
// Luồng quên mật khẩu public cho MiniApp phải có OTP/xác minh riêng trước khi được mở lại.
router.post('/reset-password', resetPasswordLimiter, verifyToken, verifyManager, customerController.resetPassword);

// --------------------------------------------------------------------------
// Các API bên dưới bắt buộc phải có Token đăng nhập
router.use(verifyToken);

router.post('/', customerController.create);
router.get('/', customerController.getList);
router.get('/:id/overview', customerController.getOverview);
router.get('/:id', customerController.getDetail);
router.put('/:id', customerController.update);
router.delete('/:id', customerController.remove);
router.patch('/:id/restore', customerController.restore);

module.exports = router;