const customerBookingService = require('../services/customerBookingService');
const { respondListError } = require('../utils/pagination');

const getList = async (req, res) => {
    try {
        const data = await customerBookingService.getCustomerBookings(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy danh sách booking khách hàng thành công', ...data });
    } catch (error) {
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await customerBookingService.getCustomerBookingDetail(req.user.tenant_id, req.params.id, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy chi tiết booking khách hàng thành công', data });
    } catch (error) {
        res.status(error.message === 'bookingId không hợp lệ.' || error.message === 'branch_id không hợp lệ.' ? 400 : 404).json({ message: error.message });
    }
};

const write = (remove = false) => async (req, res) => {
    try {
        const result = await customerBookingService.writeBooking(req.user.tenant_id, req.params.id ?? null, req.body,
            req.user.fullname || req.user.username, req.user.system_role, req.user.branch_id, remove);
        res.status(!req.params.id ? 201 : 200).json({ message: remove ? 'Xóa booking thành công' : 'Lưu booking thành công', ...result });
    } catch (error) { res.status(error.status || 400).json({ message: error.message }); }
};
module.exports = { getList, getDetail, create: write(), update: write(), remove: write(true) };