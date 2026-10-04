const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

router.post('/', invoiceController.create);
router.get('/', invoiceController.getList);
router.get('/:id', invoiceController.getDetail);
router.put('/:id', invoiceController.update);
router.delete('/:id', invoiceController.remove);

module.exports = router;