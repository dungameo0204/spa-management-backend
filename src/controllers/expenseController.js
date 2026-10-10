const expenseService = require('../services/expenseService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role; // Lấy đúng tên field system_role
        const userBranchId = req.user.branch_id;

        const result = await expenseService.createExpense(tenantId, req.body, executorName, userRole, userBranchId);
        res.status(201).json({ message: 'Tạo phiếu chi thành công', ...result });
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

        const expenses = await expenseService.getExpenses(tenantId, search, branchId, startDate, endDate, userRole, userBranchId, req.query);
        res.status(200).json({ message: 'Lấy danh sách thành công', ...expenses });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const data = await expenseService.getExpenseDetail(tenantId, req.params.id, userRole, userBranchId);
        res.status(200).json({ message: 'Lấy chi tiết phiếu chi thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await expenseService.updateExpense(tenantId, req.params.id, req.body, executorName, userRole, userBranchId);
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

        const result = await expenseService.deleteExpense(tenantId, req.params.id, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove };