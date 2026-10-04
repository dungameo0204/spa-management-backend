const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { verifyToken, verifySuperAdmin } = require('../middlewares/auth');

// Đi qua 2 lớp bảo vệ: Phải có Token + Phải là Super Admin
router.post('/create', verifyToken, verifySuperAdmin, tenantController.createSpa);
router.get('/', verifyToken, verifySuperAdmin, tenantController.getTenants);
router.put('/:id', verifyToken, verifySuperAdmin, tenantController.update);
router.delete('/:id', verifyToken, verifySuperAdmin, tenantController.remove);
router.patch('/:id/restore', verifyToken, verifySuperAdmin, tenantController.restore);
module.exports = router;