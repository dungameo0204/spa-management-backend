require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { masterPool } = require('./config/database');
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

masterPool.getConnection()
    .then(connection => {
        console.log('✅ Đã kết nối thành công vào MySQL (db_system_master)!');
        connection.release(); // Test xong thì trả kết nối lại cho hệ thống
    })
    .catch(err => {
        console.error('❌ Kết nối Database thất bại. Lỗi:', err.message);
    });

// Middlewares cơ bản
app.use(cors());
app.use(express.json()); // Giúp Node.js đọc được dữ liệu JSON từ Frontend gửi lên

// Lắng nghe cổng
const PORT = process.env.PORT || 5000;
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/staffs',staffRoutes);
app.use('/api/branches',branchesRoutes);
app.use('/api/customers', customerRoures);
app.use('/api/products', productRoutes);
app.use('/api/inventory-imports', inventoryImportRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/treatments', treatmentRoutes);

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});