const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

// Toàn bộ các hành động này đều yêu cầu quyền MANAGER
router.use(verifyToken, verifyManager);

// Route Quản lý Nhân sự của Spa
router.post('/create', userController.createEmployeeAccount); // Đổi thành /create cho gọn
router.get('/', userController.getEmployees);                 // Lấy danh sách
router.get('/:id', userController.getDetail);
router.put('/:id', userController.updateEmployee);            // Cập nhật (bao gồm tự cập nhật)
router.delete('/:id', userController.deleteEmployee);         // Xóa mềm
router.patch('/:id/restore', userController.restoreEmployee); // Khôi phục

module.exports = router;