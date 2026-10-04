const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

// Toàn bộ API của Roles đều yêu cầu đăng nhập và có quyền MANAGER
router.use(verifyToken, verifyManager);

router.post('/', roleController.create);
router.get('/', roleController.getList);
router.put('/:id', roleController.update);
router.delete('/:id', roleController.remove);
router.patch('/:id/restore', roleController.restore);

module.exports = router;