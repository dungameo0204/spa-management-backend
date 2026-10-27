const express = require('express');
const router = express.Router();
const customerBookingController = require('../controllers/customerBookingController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);
router.use((req, res, next) => {
    if (req.user.customer_id !== undefined || !['MANAGER', 'STAFF'].includes(req.user.system_role) || !Number.isSafeInteger(req.user.tenant_id) || req.user.tenant_id <= 0) {
        return res.status(403).json({ message: 'Chỉ MANAGER/STAFF của Spa được truy cập booking.' });
    }
    next();
});
router.get('/', customerBookingController.getList);
router.post('/', customerBookingController.create);
router.put('/:id', customerBookingController.update);
router.delete('/:id', customerBookingController.remove);
router.get('/:id', customerBookingController.getDetail);

module.exports = router;