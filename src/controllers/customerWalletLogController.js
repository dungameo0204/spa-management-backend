const customerWalletLogService = require('../services/customerWalletLogService');
const { respondListError } = require('../utils/pagination');

const create = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await customerWalletLogService.createWalletLog(req.user.tenant_id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(201).json({ message: 'Nạp ví khách hàng thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const data = await customerWalletLogService.getWalletLogs(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy lịch sử nạp ví thành công', ...data });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await customerWalletLogService.getWalletLogDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết giao dịch nạp ví thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await customerWalletLogService.updateWalletLog(req.user.tenant_id, req.params.id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await customerWalletLogService.deleteWalletLog(req.user.tenant_id, req.params.id, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove };