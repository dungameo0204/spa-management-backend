const userService = require('../services/userService');
const { respondListError } = require('../utils/pagination');

const createEmployeeAccount = async (req, res) => {
    try {
        const { username, password, fullname, systemRole, branchId } = req.body;
        
        if (!username || !password || !fullname || !systemRole) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ: username, password, fullname, systemRole' });
        }

        // --- BỔ SUNG LOGIC RÀNG BUỘC THEO ROLE ---
        if (systemRole === 'STAFF' && !branchId) {
            return res.status(400).json({ message: 'Bắt buộc phải chọn cơ sở (branchId) khi tạo tài khoản STAFF!' });
        }

        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        // Chỉ truyền các tham số cần thiết
        const newUserId = await userService.createUser(tenantId, username, password, fullname, systemRole, branchId, executorName);

        res.status(201).json({ message: 'Tạo tài khoản đăng nhập thành công', userId: newUserId });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getEmployees = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search } = req.query;

        const users = await userService.getUsersByTenant(tenantId, search, req.query);
        res.status(200).json({ message: 'Lấy danh sách tài khoản thành công', ...users });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await userService.getUserDetail(req.user.tenant_id, req.params.id);
        res.status(200).json({ message: 'Lấy chi tiết tài khoản thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const updateEmployee = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        
        if (Number(targetUserId) === req.user.id && req.body.systemRole && req.body.systemRole !== req.user.system_role) {
            return res.status(400).json({ message: 'Bạn không thể tự thay đổi chức vụ hệ thống của chính mình.' });
        }

        const updateData = {
            newUsername: req.body.username,
            fullname: req.body.fullname,
            newPassword: req.body.password,
            newRole: req.body.systemRole,
            branchId: req.body.branchId
        };

        await userService.updateUser(tenantId, targetUserId, updateData, executorName);
        res.status(200).json({ message: 'Cập nhật tài khoản thành công!' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const deleteEmployee = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        if (parseInt(targetUserId) === req.user.id) {
            return res.status(400).json({ message: 'Bạn không thể tự khóa tài khoản của chính mình!' });
        }

        await userService.deleteUser(tenantId, targetUserId, executorName);
        res.status(200).json({ message: 'Khóa tài khoản thành công!' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restoreEmployee = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await userService.restoreUser(tenantId, targetUserId, executorName);
        res.status(200).json({ message: 'Khôi phục tài khoản thành công!' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { createEmployeeAccount, getEmployees, getDetail, updateEmployee, deleteEmployee, restoreEmployee };