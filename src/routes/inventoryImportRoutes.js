const express = require('express');
const router = express.Router();
const inventoryImportController = require('../controllers/inventoryImportController');
const { verifyToken } = require('../middlewares/auth');

// Cho phép tất cả nhân sự đã đăng nhập truy cập vào module này
router.use(verifyToken);

// Lấy danh sách & Chi tiết (Có hỗ trợ filter startDate, endDate)
router.get('/', inventoryImportController.getList);

// Tạo mới phiếu nhập
router.post('/', inventoryImportController.create);

// Sửa & Xóa phiếu nhập (Logic trừ/cộng kho tự động + Chặn thời gian theo Role)
router.put('/:id', inventoryImportController.update);
router.delete('/:id', inventoryImportController.remove);

module.exports = router;