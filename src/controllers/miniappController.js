const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { masterPool, getTenantDbName } = require('../config/database');

const miniappLogin = async (req, res) => {
    try {
        // MiniApp khi build ra cho Spa nào thì Frontend đã gắn cứng tenantId của Spa đó ngầm bên dưới
        const { tenantId, phone_number, password } = req.body; 

        if (!tenantId || !phone_number || !password) {
            return res.status(400).json({ message: 'Thiếu thông tin đăng nhập' });
        }

        const dbName = await getTenantDbName(tenantId);

        const [users] = await masterPool.query(
            `SELECT id, fullname, password, avatar FROM \`${dbName}\`.customers WHERE phone_number = ? AND deleted_at IS NULL`,
            [phone_number]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'Số điện thoại không tồn tại' });
        }

        const customer = users[0];

        // Khách hàng được tạo bởi Lễ tân nhưng chưa cài mật khẩu
        if (!customer.password) {
            return res.status(401).json({ message: 'Tài khoản chưa thiết lập mật khẩu. Vui lòng chọn "Quên mật khẩu" để tạo mới.' });
        }

        const isMatch = await bcrypt.compare(password, customer.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Mật khẩu không chính xác' });
        }

        // Tạo JWT Token cho Khách hàng
        const token = jwt.sign(
            { 
                tenant_id: tenantId, 
                customer_id: customer.id,
                phone_number: phone_number
            }, 
            process.env.JWT_SECRET, 
            { expiresIn: '30d' } // MiniApp thường giữ đăng nhập lâu (30 ngày)
        );

        res.status(200).json({
            message: 'Đăng nhập thành công',
            token: token,
            data: {
                id: customer.id,
                fullname: customer.fullname,
                avatar: customer.avatar
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};