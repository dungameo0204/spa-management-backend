const express = require('express');
const router = express.Router();
const treatmentController = require('../controllers/treatmentController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

router.use(verifyToken);

// 1. Quản lý Thẻ liệu trình (Chỉ MANAGER mới được tạo thủ công)
router.get('/', treatmentController.getList);
router.post('/', verifyManager, treatmentController.createManualTreatment);
// Both managers and staff can collect the customer's completion signature.
router.post('/:id/close', (req, res, next) => {
    if (req.user.customer_id !== undefined || !['MANAGER', 'STAFF'].includes(req.user.system_role) ||
        !Number.isSafeInteger(req.user.tenant_id) || req.user.tenant_id <= 0) {
        return res.status(403).json({ message: 'Chỉ MANAGER/STAFF của Spa được xác nhận ký hoàn thành liệu trình.' });
    }
    next();
}, treatmentController.close);

// 2. Lịch sử thực hiện phải khai báo trước '/:id' để Express không hiểu 'execute' là ID thẻ.
router.post('/execute', treatmentController.executeSession);
const verifyHistoryActor = (req, res, next) => {
    if (req.user.customer_id !== undefined || !['MANAGER', 'STAFF'].includes(req.user.system_role) ||
        !Number.isSafeInteger(req.user.tenant_id) || req.user.tenant_id <= 0) {
        return res.status(403).json({ message: 'Chỉ MANAGER/STAFF của Spa được cập nhật buổi thực hiện.' });
    }
    next();
};
router.put('/execute/:historyId/note', verifyHistoryActor, treatmentController.updateHistoryNote);
router.post('/execute/:historyId/sign', verifyHistoryActor, treatmentController.signHistory);
router.delete('/execute/:historyId', treatmentController.removeHistory);
router.put('/execute/:historyId/staffs', treatmentController.assignStaffs);

// 3. Báo cáo lấy hoa hồng nhân viên (Phục vụ tính lương)
router.get('/commissions', treatmentController.getCommissions);
router.get('/:id', treatmentController.getDetail);

module.exports = router;