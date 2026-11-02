const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

// Cho phép tất cả người dùng trong hệ thống (kể cả STAFF) xem danh sách chi nhánh để hiển thị tên cơ sở
router.use(verifyToken);

router.get('/', branchController.getList);
router.get('/:id', branchController.getDetail);

// Các thao tác quản trị chi nhánh yêu cầu quyền MANAGER
router.post('/', verifyManager, branchController.create);
router.put('/:id', verifyManager, branchController.update);
router.delete('/:id', verifyManager, branchController.remove);
router.patch('/:id/restore', verifyManager, branchController.restore);

module.exports = router;
