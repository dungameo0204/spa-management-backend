const treatmentService = require('../services/treatmentService');

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

const executeSession = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await treatmentService.executeTreatmentSession(tenantId, req.body, executorName, userRole, userBranchId);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const assignStaffs = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await treatmentService.assignStaffToHistory(tenantId, req.params.historyId, req.body, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getCommissions = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;
        
        const filters = {
            branchId: req.query.branchId,
            staffName: req.query.staffName,
            systemRole: req.query.systemRole,
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };

        const commissions = await treatmentService.getStaffCommissions(tenantId, filters, userRole, userBranchId);
        res.status(200).json({ message: 'Lấy danh sách hoa hồng nhân viên thành công', total: commissions.length, data: commissions });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const removeHistory = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const result = await treatmentService.deleteTreatmentHistory(tenantId, req.params.historyId, executorName, userRole, userBranchId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { 
    createManualTreatment, 
    executeSession, 
    assignStaffs, 
    getCommissions,
    removeHistory
};