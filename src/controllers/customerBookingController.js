const customerBookingService = require('../services/customerBookingService');

const getList = async (req, res) => {
    try {
        const data = await customerBookingService.getCustomerBookings(req.user.tenant_id, req.query, req.user.system_role, req.user.branch_id);
        res.status(200).json({ message: 'Lấy danh sách booking khách hàng thành công', total: data.length, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getList };