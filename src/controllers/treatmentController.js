const treatmentService = require('../services/treatmentService');
const { respondListError } = require('../utils/pagination');

const createManualTreatment = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;

        const result = await treatmentService.createTreatment(tenantId, req.body, executorName);
        res.status(201).json({ message: 'Tạo thẻ liệu trình thủ công thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const result = await treatmentService.getTreatments(tenantId, req.query);
        res.status(200).json({ message: 'Lấy danh sách liệu trình thành công', ...result });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const result = await treatmentService.getTreatmentDetail(tenantId, req.params.id);
        res.status(200).json({ message: 'Lấy chi tiết liệu trình thành công', data: result });
    } catch (error) {
        if (error.message.includes('Không tìm thấy')) return res.status(404).json({ message: error.message });
        res.status(500).json({ message: error.message });
    }
};

const executeSession = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const result = await treatmentService.executeTreatmentSession(tenantId, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const assignStaffs = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const result = await treatmentService.assignStaffToHistory(tenantId, req.params.historyId, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getCommissions = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const filters = {
            branchId: req.query.branchId,
            staffName: req.query.staffName,
            roleName: req.query.roleName,
            productId: req.query.productId,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            page: req.query.page,
            pageSize: req.query.pageSize
        };

        const commissions = await treatmentService.getStaffCommissions(tenantId, filters, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy danh sách hoa hồng nhân viên thành công', ...commissions });
    } catch (error) {
        respondListError(res, error);
    }
};

const removeHistory = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const result = await treatmentService.deleteTreatmentHistory(tenantId, req.params.historyId, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getList,
    getDetail, 
    createManualTreatment, 
    executeSession, 
    assignStaffs, 
    getCommissions,
    removeHistory
};