const tenantService = require('../services/tenantService');
const { respondListError } = require('../utils/pagination');

const createSpa = async (req, res) => {
    try {
        // THÊM: Lấy thêm managerFullname từ Frontend gửi lên
        const { spaName, managerUsername, managerPassword, managerFullname, years } = req.body;

        if (!spaName || !managerUsername || !managerPassword || !managerFullname) {
            return res.status(400).json({ message: 'Vui lòng điền đủ thông tin: spaName, managerUsername, managerPassword, managerFullname' });
        }

        // Lấy tên của Super Admin đang thao tác từ Token
        const creatorName = req.user.fullname || req.user.username;

        const result = await tenantService.createNewSpa(spaName, managerUsername, managerPassword, managerFullname, years, creatorName);

        res.status(201).json({
            message: 'Khởi tạo Spa và nhân bản Database thành công!',
            data: result
        });
    } catch (error) {
        console.error('[Create Tenant Error]', error);
        res.status(error.status === 400 ? 400 : 500).json({ message: error.status === 400 ? error.message : 'Lỗi hệ thống khi tạo Spa mới: ' + error.message });
    }
};

const getTenants = async (req, res) => {
    try {
        const { search } = req.query; 
        const tenants = await tenantService.getAllTenants(search, req.query);

        res.status(200).json({
            message: 'Lấy danh sách Spa thành công',
            ...tenants
        });
    } catch (error) {
        console.error('[Get Tenants Error]', error);
        respondListError(res, error);
    }
};

const getDetail = async (req, res) => {
    try {
        const data = await tenantService.getTenantDetail(req.params.id);
        res.status(200).json({ message: 'Lấy chi tiết Spa thành công', data });
    } catch (error) {
        res.status(error.status === 400 ? 400 : 404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const tenantId = req.params.id;
        const { spaName, expireAt } = req.body; 
        
        const executorName = req.user.fullname || req.user.username; // Lấy tên người sửa

        const updatedTenant = await tenantService.updateTenant(tenantId, spaName, expireAt, executorName);

        res.status(200).json({
            message: 'Cập nhật thông tin Spa thành công!',
            data: updatedTenant
        });
    } catch (error) {
        console.error('[Update Tenant Error]', error);
        res.status(error.status === 404 ? 404 : 400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const tenantId = req.params.id;
        const executorName = req.user.fullname || req.user.username; // Lấy tên người xóa

        await tenantService.deleteTenant(tenantId, executorName);

        res.status(200).json({
            message: 'Đã xóa (vô hiệu hóa) Spa thành công!',
        });
    } catch (error) {
        console.error('[Delete Tenant Error]', error);
        res.status(error.status === 400 ? 400 : 400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const tenantId = req.params.id;
        const executorName = req.user.fullname || req.user.username; // Lấy tên người khôi phục

        await tenantService.restoreTenant(tenantId, executorName);

        res.status(200).json({
            message: 'Đã khôi phục Spa thành công! Các tài khoản đã có thể đăng nhập lại.',
        });
    } catch (error) {
        console.error('[Restore Tenant Error]', error);
        res.status(error.status === 400 ? 400 : 400).json({ message: error.message });
    }
};

const respondAdminError = (res, error) => res.status(error.status === 400 || error.status === 404 ? error.status : 500).json({ message: error.message });

const getManagers = async (req, res) => {
    try {
        const data = await tenantService.getManagers(req.params.id);
        res.status(200).json({ message: 'Lấy danh sách MANAGER thành công', total: data.length, data });
    } catch (error) {
        respondAdminError(res, error);
    }
};

const resetManagerPassword = async (req, res) => {
    try {
        await tenantService.resetManagerPassword(req.params.id, req.params.userId, req.body?.newPassword, req.user.fullname || req.user.username);
        res.status(200).json({ message: 'Đã cấp lại mật khẩu MANAGER thành công.' });
    } catch (error) {
        respondAdminError(res, error);
    }
};

const renew = async (req, res) => {
    try {
        const data = await tenantService.renewTenant(req.params.id, req.body?.years, req.user.fullname || req.user.username);
        res.status(200).json({ message: 'Gia hạn Spa thành công.', data });
    } catch (error) {
        respondAdminError(res, error);
    }
};

module.exports = {
    createSpa,
    getTenants,
    getDetail,
    update,
    remove,
    restore,
    getManagers,
    resetManagerPassword,
    renew
};