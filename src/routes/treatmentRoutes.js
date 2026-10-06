const express = require('express');
const router = express.Router();
const treatmentController = require('../controllers/treatmentController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

router.use(verifyToken);

// 1. Quản lý Thẻ liệu trình (Chỉ MANAGER mới được tạo thủ công)
router.get('/', treatmentController.getList);
router.post('/', verifyManager, treatmentController.createManualTreatment);

// 2. Lịch sử thực hiện phải khai báo trước '/:id' để Express không hiểu 'execute' là ID thẻ.
router.post('/execute', treatmentController.executeSession);
router.delete('/execute/:historyId', treatmentController.removeHistory);
router.put('/execute/:historyId/staffs', treatmentController.assignStaffs);

// 3. Báo cáo lấy hoa hồng nhân viên (Phục vụ tính lương)
router.get('/commissions', treatmentController.getCommissions);
router.get('/:id', treatmentController.getDetail);

module.exports = router;