const express = require('express');
const router = express.Router();
const { verifyToken, verifyManager } = require('../middlewares/auth');
const reportController = require('../controllers/reportController');
router.use(verifyToken, verifyManager);
router.get('/commissions', reportController.commissions);
router.get('/consultants', reportController.consultants);
router.get('/details/commissions', reportController.commissionDetails);
router.get('/details/consultants', reportController.consultantDetails);
router.get('/revenue', reportController.revenue);
router.get('/products', reportController.products);
router.get('/products/:productId/invoices', reportController.productInvoices);
router.get('/details/:type', reportController.details);

module.exports = router;