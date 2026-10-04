const express = require('express');
const router = express.Router();
const treatmentController = require('../controllers/treatmentController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

router.use(verifyToken);

// 1. Quản lý Thẻ liệu trình (Chỉ MANAGER mới được tạo thủ công)
router.post('/', verifyManager, treatmentController.createManualTreatment);

// 2. Quản lý Lịch sử trừ buổi (Bấm thực hiện dịch vụ)
router.post('/execute', treatmentController.executeSession);
router.delete('/execute/:historyId', treatmentController.removeHistory);

// 3. Quản lý Hoa hồng nhân viên (Gán bổ sung nhân viên vào một lịch sử đã trừ buổi)
router.put('/execute/:historyId/staffs', treatmentController.assignStaffs);

// 4. Báo cáo lấy hoa hồng nhân viên (Phục vụ tính lương)
router.get('/commissions', treatmentController.getCommissions);

module.exports = router;