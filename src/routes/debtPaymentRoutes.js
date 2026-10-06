const express = require('express');
const router = express.Router();
const debtPaymentController = require('../controllers/debtPaymentController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);
router.post('/', debtPaymentController.create);
router.get('/', debtPaymentController.getList);
router.get('/:id', debtPaymentController.getDetail);
router.put('/:id', debtPaymentController.update);
router.delete('/:id', debtPaymentController.remove);

module.exports = router;