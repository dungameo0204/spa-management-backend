const express = require('express');
const router = express.Router();
const miniappController = require('../controllers/miniappController');
const { verifyCustomerToken } = require('../middlewares/auth');

// API Public: Khách đăng nhập (Không cần Token)
router.post('/login', miniappController.miniappLogin);

// Khóa tất cả các API bên dưới bằng Token của Khách hàng
router.use(verifyCustomerToken);

// API Lấy hồ sơ cá nhân (Backend tự lấy req.customer.customer_id để query, khách không thể xem của người khác)
router.get('/profile', miniappController.getMyProfile); 

// API Khách tự đặt lịch
router.post('/bookings', miniappController.bookAppointment);

module.exports = router;