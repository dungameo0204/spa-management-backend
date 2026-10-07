const appointmentService = require('../services/appointmentService');

const create = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await appointmentService.createAppointment(req.user.tenant_id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(201).json({ message: 'Tạo lịch hẹn thành công', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const data = await appointmentService.getAppointments(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy danh sách lịch hẹn thành công', total: data.length, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getTomorrow = async (req, res) => {
    try {
        const data = await appointmentService.getAppointments(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id, 'tomorrow');
        res.status(200).json({ message: 'Lấy danh sách khách hẹn ngày mai thành công', total: data.length, data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getNotArrived = async (req, res) => {
    try {
        const data = await appointmentService.getAppointments(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id, 'not-arrived');
        res.status(200).json({ message: 'Lấy danh sách khách chưa đến thành công', total: data.length, data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await appointmentService.getAppointmentDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết lịch hẹn thành công', data });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await appointmentService.updateAppointment(req.user.tenant_id, req.params.id, req.body, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const executorName = req.user.fullname || req.user.username;
        const result = await appointmentService.deleteAppointment(req.user.tenant_id, req.params.id, executorName, req.user.system_role, req.user.branch_id);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getTomorrow, getNotArrived, getDetail, update, remove };