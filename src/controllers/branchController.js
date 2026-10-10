const branchService = require('../services/branchService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        if (!req.body.name) return res.status(400).json({ message: 'Tên chi nhánh không được để trống' });

        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        // Truyền thẳng toàn bộ req.body xuống Service
        const insertId = await branchService.createBranch(tenantId, req.body, executorName);
        res.status(201).json({ message: 'Thêm mới chi nhánh thành công', branchId: insertId });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const { search } = req.query;

        const branches = await branchService.getBranches(tenantId, search, req.query);
        res.status(200).json({ message: 'Lấy danh sách thành công', ...branches });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await branchService.getBranchDetail(req.user.tenant_id, req.params.id);
        res.status(200).json({ message: 'Lấy chi tiết chi nhánh thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const branchId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await branchService.updateBranch(tenantId, branchId, req.body, executorName);
        
        res.status(200).json({ message: 'Cập nhật chi nhánh thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const branchId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        await branchService.deleteBranch(tenantId, branchId, executorName);
        res.status(200).json({ message: 'Xóa chi nhánh thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const branchId = req.params.id;
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        // ĐÃ SỬA LỖI: Trả về đúng hàm restoreBranch thay vì updateBranch
        await branchService.restoreBranch(tenantId, branchId, executorName);
        res.status(200).json({ message: 'Khôi phục chi nhánh thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove, restore };