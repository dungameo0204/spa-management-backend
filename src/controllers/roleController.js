const roleService = require('../services/roleService');

const create = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ message: 'Tên chức vụ không được để trống' });

        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        const insertId = await roleService.createRole(tenantId, name, description, executorName);
        res.status(201).json({ message: 'Tạo chức vụ thành công', roleId: insertId });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search } = req.query;

        const roles = await roleService.getRoles(tenantId, search);
        res.status(200).json({ message: 'Lấy danh sách thành công', total: roles.length, data: roles });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const roleId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        // Bỏ việc bóc tách name, description ở đây. 
        // Truyền nguyên req.body xuống Service để xử lý linh hoạt (Partial Update)
        await roleService.updateRole(tenantId, roleId, req.body, executorName);
        
        res.status(200).json({ message: 'Cập nhật chức vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const roleId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await roleService.deleteRole(tenantId, roleId, executorName);
        res.status(200).json({ message: 'Xóa chức vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const roleId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await roleService.restoreRole(tenantId, roleId, executorName);
        res.status(200).json({ message: 'Khôi phục chức vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, update, remove, restore };