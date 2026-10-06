const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { verifyToken } = require('../middlewares/auth');

// 1. PUBLIC ROUTE: Đổi/Quên mật khẩu (MiniApp gọi lên, KHÔNG cần gửi Token)
// Vì không có Token, MiniApp bắt buộc phải gửi kèm tenantId (ID của Spa) trong body JSON
router.post('/reset-password', customerController.resetPassword);

// --------------------------------------------------------------------------
// 2. PROTECTED ROUTES: Các API bên dưới bắt buộc phải có Token đăng nhập
router.use(verifyToken);

router.post('/', customerController.create);
router.get('/', customerController.getList);
router.get('/:id', customerController.getDetail);
router.put('/:id', customerController.update);
router.delete('/:id', customerController.remove);
router.patch('/:id/restore', customerController.restore);

module.exports = router;