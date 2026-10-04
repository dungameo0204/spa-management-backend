const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { verifyToken, verifyManager } = require('../middlewares/auth');

router.use(verifyToken);

router.post('/', staffController.create);
router.get('/', staffController.getList);
router.put('/:id', staffController.update);
router.delete('/:id', staffController.remove);
router.patch('/:id/restore', staffController.restore);

module.exports = router;