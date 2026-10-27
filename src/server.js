require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { masterPool } = require('./config/database');
const { getServerConfig } = require('./config/server');
const { createHealthHandler } = require('./controllers/healthController');
const app = express();
const authRoutes = require('./routes/authRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const staffRoutes= require('./routes/staffRoutes');
const branchesRoutes= require('./routes/branchRoutes');
const customerRoures= require('./routes/customerRoutes');
const productRoutes = require('./routes/productRoutes');
const inventoryImportRoutes = require('./routes/inventoryImportRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const treatmentRoutes = require('./routes/treatmentRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const customerBookingRoutes = require('./routes/customerBookingRoutes');
const customerWalletLogRoutes = require('./routes/customerWalletLogRoutes');
const debtPaymentRoutes = require('./routes/debtPaymentRoutes');
const reportRoutes = require('./routes/reportRoutes');

// Middlewares cơ bản
const config = getServerConfig();
app.use(config.allowedOrigins ? cors({ origin: config.allowedOrigins }) : cors());
app.use(express.json()); // Giúp Node.js đọc được dữ liệu JSON từ Frontend gửi lên
app.get('/health', createHealthHandler(masterPool));

// Chỉ dùng nội bộ (loopback) khi chạy qua tunnel ở production.
const PORT = config.port;
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/staffs',staffRoutes);
app.use('/api/branches',branchesRoutes);
app.use('/api/customers', customerRoures);
app.use('/api/customers/:customerId/skin-image-sessions', require('./routes/skinImageRoutes'));
app.use('/api/products', productRoutes);
app.use('/api/inventory-imports', inventoryImportRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/treatments', treatmentRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/customer-bookings', customerBookingRoutes);
app.use('/api/customer-wallet-logs', customerWalletLogRoutes);
app.use('/api/debt-payments', debtPaymentRoutes);
app.use('/api/reports', reportRoutes);

const start = async () => {
    if (process.env.UPLOAD_ROOT) {
        const storage = require('./utils/skinImageStorage');
        await storage.cleanupStale();
        const cleanupTimer = setInterval(() => storage.cleanupStale().catch(error => console.error('Skin temp cleanup failed:', error.code || error.message)), 60 * 60 * 1000);
        cleanupTimer.unref();
    }
    const connection = await masterPool.getConnection();
    connection.release();
    console.log('✅ Đã kết nối thành công vào MySQL (db_system_master)!');
    const server = app.listen(PORT, config.host, () => {
        console.log(`🚀 Server đang chạy tại http://${config.host}:${PORT}`);
    });
    server.on('error', error => {
        console.error('Không thể mở cổng API:', error);
        process.exitCode = 1;
    });
};

start().catch(error => {
    console.error('Không thể khởi động backend (kiểm tra cấu hình/MySQL):', error);
    process.exitCode = 1;
    masterPool.end().catch(() => {});
});