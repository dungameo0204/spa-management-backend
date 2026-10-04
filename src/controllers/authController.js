const authService = require('../services/authService');

const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Bắt lỗi nếu Frontend gửi thiếu dữ liệu
        if (!username || !password) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
        }

        // Gọi anh Bếp trưởng (Service) để xử lý logic
        const result = await authService.login(username, password);

        // Trả kết quả về cho Frontend
        res.status(200).json({
            message: 'Đăng nhập thành công!',
            data: result
        });
    } catch (error) {
        console.error('[Login Error]', error.message);
        // Trả về lỗi 401 (Unauthorized) nếu sai thông tin
        res.status(401).json({ message: error.message });
    }
};

module.exports = {
    login
};