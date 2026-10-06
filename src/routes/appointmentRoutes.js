const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

router.post('/', appointmentController.create);
router.get('/', appointmentController.getList);
router.get('/:id', appointmentController.getDetail);
router.put('/:id', appointmentController.update);
router.delete('/:id', appointmentController.remove);

module.exports = router;