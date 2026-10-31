const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

// Toàn bộ API của Branches đều yêu cầu đăng nhập và có quyền MANAGER
router.use(verifyToken);

router.get('/', branchController.getList);
router.get('/:id', branchController.getDetail);

router.use(verifyToken, verifyManager);

router.post('/', branchController.create);
router.put('/:id', branchController.update);
router.delete('/:id', branchController.remove);
router.patch('/:id/restore', branchController.restore);

module.exports = router;