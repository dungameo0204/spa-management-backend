const express = require('express');
const router = express.Router();
const customerWalletLogController = require('../controllers/customerWalletLogController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);
router.post('/', customerWalletLogController.create);
router.get('/', customerWalletLogController.getList);
router.get('/:id', customerWalletLogController.getDetail);
router.put('/:id', customerWalletLogController.update);
router.delete('/:id', customerWalletLogController.remove);

module.exports = router;