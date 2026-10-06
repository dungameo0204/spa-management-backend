const express = require('express');
const router = express.Router();
const customerBookingController = require('../controllers/customerBookingController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);
router.get('/', customerBookingController.getList);

module.exports = router;