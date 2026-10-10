const inventoryImportService = require('../services/inventoryImportService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await inventoryImportService.createInventoryImport(tenantId, req.body, executorName, userRole, userBranchId);
        res.status(201).json({ message: 'Tạo phiếu nhập kho thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;
        const { search, branchId, startDate, endDate } = req.query;

        const inventoryImports = await inventoryImportService.getInventoryImports(tenantId, search, branchId, startDate, endDate, userRole, userBranchId, req.query);
        res.status(200).json({ message: 'Lấy danh sách thành công', ...inventoryImports });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await inventoryImportService.getInventoryImportDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết phiếu nhập kho thành công', data });
    } catch (error) {
        res.status(['inventoryImportId không hợp lệ.', 'branch_id không hợp lệ.'].includes(error.message) ? 400 : 404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await inventoryImportService.updateInventoryImport(tenantId, req.params.id, req.body, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await inventoryImportService.deleteInventoryImport(tenantId, req.params.id, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove };