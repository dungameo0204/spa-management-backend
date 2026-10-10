const express = require('express');
const router = express.Router();
const { verifyToken, verifyManager } = require('../middlewares/auth');
const reportController = require('../controllers/reportController');
router.use(verifyToken);
// Staff can view personnel reports only for their JWT branch; query branchId cannot widen access.
const scopePersonnelReport = (req, res, next) => {
    if (req.user.system_role === 'MANAGER') {
        req.reportQuery = req.query;
    } else if (req.user.system_role === 'STAFF') {
        const branchId = Number(req.user.branch_id);
        if (!Number.isSafeInteger(branchId) || branchId < 1) {
            return res.status(403).json({ message: 'Tài khoản nhân viên không có chi nhánh hợp lệ.' });
        }
        req.reportQuery = { ...req.query, branchId };
    } else {
        return res.status(403).json({ message: 'Từ chối truy cập báo cáo nhân sự.' });
    }
    next();
};
router.get('/commissions', scopePersonnelReport, reportController.commissions);
router.get('/consultants', scopePersonnelReport, reportController.consultants);
router.get('/details/commissions', scopePersonnelReport, reportController.commissionDetails);
router.get('/details/consultants', scopePersonnelReport, reportController.consultantDetails);

router.use(verifyManager);
router.get('/revenue', reportController.revenue);
router.get('/products', reportController.products);
router.get('/products/:productId/invoices', reportController.productInvoices);
router.get('/details/:type', reportController.details);

module.exports = router;