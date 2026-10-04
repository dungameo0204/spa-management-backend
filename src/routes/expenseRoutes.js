const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const { verifyToken } = require('../middlewares/auth');

// Cho phép tất cả nhân sự đã đăng nhập truy cập, quyền hạn sẽ được khóa chặt ở tầng Service
router.use(verifyToken);

router.post('/', expenseController.create);
router.get('/', expenseController.getList);
router.get('/:id', expenseController.getDetail);
router.put('/:id', expenseController.update);
router.delete('/:id', expenseController.remove);

module.exports = router;