const jwt = require('jsonwebtoken');

// 1. Middleware Xác thực Token (Dành cho mọi API cần đăng nhập)
const verifyToken = (req, res, next) => {
    // Lấy chuỗi Token từ Header (định dạng: Bearer <token>)
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Từ chối truy cập! Không tìm thấy Token xác thực.' });
    }

    try {
        // Dùng con dấu bí mật để giải mã và kiểm tra chữ ký
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Nhét thông tin đã giải mã vào req để các hàm phía sau dùng
        req.user = decoded; 
        
        next(); // Cho đi tiếp vào Controller hoặc Middleware tiếp theo
    } catch (error) {
        return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
};

// 2. Middleware Kiểm tra quyền Super Admin (Phải đặt sau verifyToken)
const verifySuperAdmin = (req, res, next) => {
    // req.user được kế thừa từ hàm verifyToken vừa chạy trước nó
    if (!req.user || req.user.system_role !== 'SUPER_ADMIN') {
        return res.status(403).json({ message: 'Từ chối truy cập! Chỉ Super Admin mới được thực hiện thao tác này.' });
    }
    
    next(); // Cho đi tiếp
};

// Middleware kiểm tra xem người gọi API có phải là Chủ Spa (MANAGER) không
const verifyManager = (req, res, next) => {
    // req.user được tạo ra từ bước verifyToken
    if (!req.user || req.user.system_role !== 'MANAGER') {
        return res.status(403).json({ 
            message: 'Từ chối truy cập! Chỉ tài khoản Chủ Spa (MANAGER) mới có quyền thực hiện hành động này.' 
        });
    }
    next();
};

// MIDDLEWARE MỚI: Dành riêng cho MiniApp (Khách hàng)
const verifyCustomerToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Không tìm thấy xác thực (Token missing)' });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });

        // Token của khách hàng phải chứa customer_id
        if (!decoded.customer_id) {
            return res.status(403).json({ message: 'Token không hợp lệ cho MiniApp' });
        }

        // Gắn thông tin khách hàng vào req để các API sau sử dụng
        req.customer = decoded; 
        next();
    });
};

module.exports = {
    verifyToken,
    verifySuperAdmin,
    verifyManager,
    verifyCustomerToken
};