const invoiceService = require('../services/invoiceService');

const create = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await invoiceService.createInvoice(tenantId, req.body, executorName, userRole, userBranchId);
        res.status(201).json({ message: 'Tạo hóa đơn thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;
        const filters = {
            searchKeyword: req.query.search,
            branchId: req.query.branchId,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            productName: req.query.productName,
            minAmount: req.query.minAmount,
            maxAmount: req.query.maxAmount,
            hasDebt: req.query.hasDebt
        };

        const invoices = await invoiceService.getInvoices(tenantId, filters, userRole, userBranchId);
        res.status(200).json({ message: 'Lấy danh sách thành công', total: invoices.length, data: invoices });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetail = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const data = await invoiceService.getInvoiceDetail(tenantId, req.params.id, userRole, userBranchId);
        res.status(200).json({ message: 'Lấy chi tiết hóa đơn thành công', data });
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

        const result = await invoiceService.updateInvoice(tenantId, req.params.id, req.body, executorName, userRole, userBranchId);
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

        const result = await invoiceService.deleteInvoice(tenantId, req.params.id, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove };