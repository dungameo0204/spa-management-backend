const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken } = require('../middlewares/auth');

// 1. Cho phép tất cả người có Token (Staff + Manager) đi qua để xem
router.use(verifyToken);
router.get('/', productController.getList);
router.get('/:id', productController.getDetail); // <- BẠN ĐANG THIẾU DÒNG NÀY

// STAFF được quản lý sản phẩm; quyền ghi commissions được kiểm tra trong service.
router.use((req, res, next) => {
    if (req.user.system_role !== 'STAFF' && req.user.system_role !== 'MANAGER') {
        return res.status(403).json({ message: 'Chỉ MANAGER và STAFF được quản lý sản phẩm.' });
    }
    next();
});
router.post('/', productController.create);
router.put('/:id', productController.update);
router.delete('/:id', productController.remove);
router.patch('/:id/restore', productController.restore);

module.exports = router;