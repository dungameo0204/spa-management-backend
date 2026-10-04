const productService = require('../services/productService');

const create = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        const productId = await productService.createProduct(tenantId, req.body, executorName);
        res.status(201).json({ message: 'Tạo sản phẩm/dịch vụ thành công', productId });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getList = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        // Bỏ is_active hoàn toàn khỏi query params
        const { search, is_product } = req.query; 

        const products = await productService.getProducts(tenantId, search, is_product, userRole, userBranchId);
        
        res.status(200).json({ 
            message: 'Lấy danh sách thành công', 
            total: products.length, 
            data: products 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetail = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const productId = req.params.id;
        
        const userRole = req.user.system_role;
        const userBranchId = req.user.branch_id;

        const product = await productService.getProductById(tenantId, productId, userRole, userBranchId);
        
        res.status(200).json({ 
            message: 'Lấy chi tiết sản phẩm thành công', 
            data: product 
        });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const update = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        await productService.updateProduct(tenantId, req.params.id, req.body, executorName);
        res.status(200).json({ message: 'Cập nhật sản phẩm/dịch vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        await productService.deleteProduct(tenantId, req.params.id, executorName);
        res.status(200).json({ message: 'Xóa sản phẩm/dịch vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const restore = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;
        const executorName = req.user.fullname || req.user.username;
        await productService.restoreProduct(tenantId, req.params.id, executorName);
        res.status(200).json({ message: 'Khôi phục sản phẩm/dịch vụ thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { create, getList, getDetail, update, remove, restore };