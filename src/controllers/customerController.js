const customerService = require('../services/customerService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        if (!req.body.fullname || !req.body.phone_number) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ Họ tên và Số điện thoại' });
        }

        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        // Truyền thẳng req.body xuống Service
        const insertId = await customerService.createCustomer(tenantId, req.body, executorName);
        
        res.status(201).json({ message: 'Thêm mới khách hàng thành công', customerId: insertId });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search } = req.query;

        const customers = await customerService.getCustomers(tenantId, search, req.query);
        res.status(200).json({ message: 'Lấy danh sách thành công', ...customers });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const customer = await customerService.getCustomerById(req.user.tenant_id, req.params.id);
        res.status(200).json({ message: 'Lấy thông tin khách hàng thành công', data: customer });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const customerId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        if (req.body.fullname !== undefined && req.body.fullname.trim() === '') {
            return res.status(400).json({ message: 'Họ và tên không được để trống' });
        }
        if (req.body.phone_number !== undefined && req.body.phone_number.trim() === '') {
            return res.status(400).json({ message: 'Số điện thoại không được để trống' });
        }

        await customerService.updateCustomer(tenantId, customerId, req.body, executorName);
        
        res.status(200).json({ message: 'Cập nhật thông tin khách hàng thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// Controller mới: Đổi mật khẩu qua SĐT (Không cần Token Auth)
const resetPassword = async (req, res) => {
    try {
        const { tenantId, phone_number, new_password } = req.body;

        // Bắt buộc phải có tenantId truyền từ Client/App lên vì API này không dùng Token
        if (!tenantId || !phone_number || !new_password) {
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc (tenantId, phone_number, new_password)' });
        }

        await customerService.updatePasswordByPhone(tenantId, phone_number, new_password);
        
        res.status(200).json({ message: 'Đổi mật khẩu thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const customerId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await customerService.deleteCustomer(tenantId, customerId, executorName);
        res.status(200).json({ message: 'Xóa khách hàng thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const customerId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await customerService.restoreCustomer(tenantId, customerId, executorName);
        res.status(200).json({ message: 'Khôi phục khách hàng thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, resetPassword, remove, restore };