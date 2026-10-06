const debtPaymentService = require('../services/debtPaymentService');

const create = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await debtPaymentService.createDebtPayment(req.user.tenant_id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(201).json({ message: 'Ghi nhận thu nợ thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const data = await debtPaymentService.getDebtPayments(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy danh sách phiếu thu nợ thành công', total: data.length, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await debtPaymentService.getDebtPaymentDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết phiếu thu nợ thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await debtPaymentService.updateDebtPayment(req.user.tenant_id, req.params.id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await debtPaymentService.deleteDebtPayment(req.user.tenant_id, req.params.id, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove };