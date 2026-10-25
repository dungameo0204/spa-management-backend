const authService = require('../services/authService');
const { respondAuthError } = require('../utils/authError');

const login = async (req, res) => {
    try {
        const { username, password } = req.body || {};

        // Bắt lỗi nếu Frontend gửi thiếu dữ liệu
        if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
            return res.status(400).json({ code: 'AUTH_INPUT_INVALID', message: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
        }

        // Gọi anh Bếp trưởng (Service) để xử lý logic
        const result = await authService.login(username, password);

        // Trả kết quả về cho Frontend
        res.status(200).json({
            message: 'Đăng nhập thành công!',
            data: result
        });
    } catch (error) {
        return respondAuthError(res, error);
    }
};

const me = async (req, res) => {
    try {
        const data = await authService.getSession(req.user);
        return res.status(200).json({ message: 'Phiên đăng nhập hợp lệ.', data });
    } catch (error) {
        return respondAuthError(res, error);
    }
};

module.exports = {
    login,
    me
};