const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

// 1. Cho phép tất cả người có Token (Staff + Manager) đi qua để xem
router.use(verifyToken);
router.get('/', productController.getList);
router.get('/:id', productController.getDetail); // <- BẠN ĐANG THIẾU DÒNG NÀY

// 2. Chặn quyền: Chỉ Manager mới được đi xuống dưới để Thêm/Sửa/Xóa
router.use(verifyManager);
router.post('/', productController.create);
router.put('/:id', productController.update);
router.delete('/:id', productController.remove);
router.patch('/:id/restore', productController.restore);

module.exports = router;