const reportService = require('../services/reportService');

const respond = handler => async (req, res) => {
    try {
        const result = await handler(req);
        res.status(200).json({ message: 'Lấy báo cáo thành công', ...result });
    } catch (error) {
        const isBadRequest = error.status === 400 || ['startDate', 'branchId', 'staffId', 'page', 'type'].some(field => error.message.startsWith(field));
        res.status(error.status === 404 ? 404 : isBadRequest ? 400 : 500).json({ message: error.message });
    }
};

const revenue = respond(req => reportService.getRevenue(req.user.tenant_id, req.query));
const details = respond(req => reportService.getDetails(req.user.tenant_id, req.params.type, req.query));
const commissionDetails = respond(req => reportService.getDetails(req.user.tenant_id, 'commissions', req.reportQuery));
const consultantDetails = respond(req => reportService.getDetails(req.user.tenant_id, 'consultants', req.reportQuery));
const commissions = respond(req => reportService.getStaffReport(req.user.tenant_id, 'commissions', req.reportQuery));
const consultants = respond(req => reportService.getStaffReport(req.user.tenant_id, 'consultants', req.reportQuery));
const products = respond(req => reportService.getProductRevenue(req.user.tenant_id, req.query));
const productInvoices = respond(req => reportService.getProductInvoices(req.user.tenant_id, req.params.productId, req.query));

module.exports = { revenue, details, commissionDetails, consultantDetails, commissions, consultants, products, productInvoices };