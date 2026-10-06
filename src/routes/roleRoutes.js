const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

router.use(verifyToken);
router.get('/', roleController.getList);

// Toàn bộ API của Roles đều yêu cầu đăng nhập và có quyền MANAGER
router.use(verifyToken, verifyManager);

router.post('/', roleController.create);

router.put('/:id', roleController.update);
router.delete('/:id', roleController.remove);
router.patch('/:id/restore', roleController.restore);

module.exports = router;