const staffService = require('../services/staffService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        const { fullname, phone_number, address, role_id, branch_id } = req.body;
        
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role; 
        const userBranchId = req.user.branch_id; 

        // Sửa lại logic check: Chỉ bắt buộc tên, SĐT và Role. 
        // (Không ép buộc branch_id vì MANAGER có thể tạo nhân sự chưa phân bổ chi nhánh - truyền null)
        if (!fullname || !phone_number || !role_id) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ: Họ tên, Số điện thoại và Chức vụ' });
        }

        // Gói gọn data gửi xuống Service. Service sẽ tự biết phân xử MANAGER hay STAFF
        const staffData = { fullname, phone_number, address, role_id, branch_id };
        
        const insertId = await staffService.createStaff(tenantId, staffData, executorName, userRole, userBranchId);
        
        res.status(201).json({ 
            message: 'Tạo hồ sơ nhân viên thành công', 
            staffId: insertId 
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// ... trong staffController.js

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;
        
        // Nhận thêm biến roleId từ query string
        const { search, branchId, roleId } = req.query;

        // Truyền thêm roleId xuống hàm getStaffs
        const staffs = await staffService.getStaffs(tenantId, search, userRole, userBranchId, branchId, roleId, req.query);
        
        res.status(200).json({ message: 'Lấy danh sách thành công', ...staffs });
    } catch (error) {
        respondListError(res, error);
    }
};
const getDetail = async (req, res) => {
    try {
        const data = await staffService.getStaffDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết hồ sơ nhân viên thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};
// Tìm hàm update trong staffController.js và thay bằng đoạn này:

const update = async (req, res) => {
    try {
        const staffId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        // Bổ sung check an toàn: Nếu có gửi fullname lên mà lại gửi chuỗi rỗng thì chặn
        if (req.body.fullname !== undefined && req.body.fullname.trim() === '') {
            return res.status(400).json({ message: 'Họ và tên không được để trống' });
        }

        const updateData = req.body; // Lấy toàn bộ body gửi xuống Service
        
        await staffService.updateStaff(tenantId, staffId, updateData, executorName, userRole, userBranchId);
        
        res.status(200).json({ message: 'Cập nhật hồ sơ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const staffId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        await staffService.deleteStaff(tenantId, staffId, executorName, userRole, userBranchId);
        res.status(200).json({ message: 'Xóa hồ sơ nhân viên thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const staffId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        await staffService.restoreStaff(tenantId, staffId, executorName, userRole, userBranchId);
        res.status(200).json({ message: 'Khôi phục hồ sơ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove, restore };