const jwt = require('jsonwebtoken');

// 1. Middleware Xác thực Token (Dành cho mọi API cần đăng nhập)
const verifyToken = (req, res, next) => {
    // Lấy chuỗi Token từ Header (định dạng: Bearer <token>)
    const authHeader = req.header('Authorization');
    const match = typeof authHeader === 'string' && authHeader.match(/^Bearer\s+(\S+)$/i);
    const token = match && match[1];

    if (!token) {
        return res.status(401).json({ code: authHeader ? 'AUTH_TOKEN_INVALID' : 'AUTH_TOKEN_MISSING', message: 'Từ chối truy cập! Không tìm thấy Token Bearer hợp lệ.' });
    }

    if (!process.env.JWT_SECRET?.trim()) {
        return res.status(500).json({ code: 'AUTH_SERVICE_ERROR', message: 'Không thể xử lý xác thực lúc này. Vui lòng thử lại sau.' });
    }

    try {
        // Dùng con dấu bí mật để giải mã và kiểm tra chữ ký
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            return res.status(401).json({ code: 'AUTH_TOKEN_INVALID', message: 'Token không hợp lệ.' });
        }
        
        // Nhét thông tin đã giải mã vào req để các hàm phía sau dùng
        req.user = decoded; 
        
    } catch (error) {
        const expired = error.name === 'TokenExpiredError';
        return res.status(401).json({ code: expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID', message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
    return next();
};

// 2. Middleware Kiểm tra quyền Super Admin (Phải đặt sau verifyToken)
const verifySuperAdmin = (req, res, next) => {
    // req.user được kế thừa từ hàm verifyToken vừa chạy trước nó
    if (!req.user || req.user.system_role !== 'SUPER_ADMIN') {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Từ chối truy cập! Chỉ Super Admin mới được thực hiện thao tác này.' });
    }
    
    next(); // Cho đi tiếp
};

// Middleware kiểm tra xem người gọi API có phải là Chủ Spa (MANAGER) không
const verifyManager = (req, res, next) => {
    // req.user được tạo ra từ bước verifyToken
    if (!req.user || req.user.system_role !== 'MANAGER') {
        return res.status(403).json({ 
            code: 'FORBIDDEN',
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