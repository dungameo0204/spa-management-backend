import os

with open('src/services/treatmentService.js', 'r', encoding='utf-8') as f:
    code = f.read()

old_getTreatments_start = code.find('const getTreatments = async')
old_getTreatments_end = code.find('const getTreatmentDetail = async')

old_getTreatments = code[old_getTreatments_start:old_getTreatments_end]

new_getTreatments = """const getTreatments = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name, i.branch_id
        FROM \\`${dbName}\\`.treatments t
        JOIN \\`${dbName}\\`.customers c ON t.customer_id = c.id
        JOIN \\`${dbName}\\`.products p ON t.product_id = p.id
        LEFT JOIN \\`${dbName}\\`.invoices i ON t.invoice_id = i.id
        WHERE t.deleted_at IS NULL
    `;
    const params = [];

    if (filters.customerId) {
        query += ' AND t.customer_id = ?';
        params.push(filters.customerId);
    }
    if (filters.customerSearch) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ?)';
        params.push(`%${filters.customerSearch}%`, `%${filters.customerSearch}%`);
    }
    if (filters.productSearch) {
        query += ' AND p.name LIKE ?';
        params.push(`%${filters.productSearch}%`);
    }
    if (filters.status === 'active') {
        query += ' AND t.remaining_sessions > 0';
    } else if (filters.status === 'completed') {
        query += ' AND t.remaining_sessions = 0';
    }
    
    if (filters.startDate) {
        query += ' AND DATE(t.created_at) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(t.created_at) <= ?';
        params.push(filters.endDate);
    }

    // Phân quyền cơ sở: Nếu là STAFF, chỉ xem liệu trình tạo từ hóa đơn của cơ sở đó (hoặc liệu trình thủ công không có hóa đơn)
    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND (i.branch_id = ? OR t.invoice_id IS NULL)';
        params.push(userBranchId);
    } else if (filters.branchId) {
        query += ' AND (i.branch_id = ? OR t.invoice_id IS NULL)';
        params.push(filters.branchId);
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await masterPool.query(query, params);
    return { data: rows };
};

"""

code = code.replace(old_getTreatments, new_getTreatments)

old_getTreatmentDetail_start = code.find('const getTreatmentDetail = async')
old_getTreatmentDetail_end = code.find('module.exports = {')

old_getTreatmentDetail = code[old_getTreatmentDetail_start:old_getTreatmentDetail_end]

new_getTreatmentDetail = """const getTreatmentDetail = async (tenantId, treatmentId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    let query = `
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name, i.branch_id
        FROM \\`${dbName}\\`.treatments t
        JOIN \\`${dbName}\\`.customers c ON t.customer_id = c.id
        JOIN \\`${dbName}\\`.products p ON t.product_id = p.id
        LEFT JOIN \\`${dbName}\\`.invoices i ON t.invoice_id = i.id
        WHERE t.id = ? AND t.deleted_at IS NULL
    `;
    const params = [treatmentId];

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND (i.branch_id = ? OR t.invoice_id IS NULL)';
        params.push(userBranchId);
    }

    const [treatments] = await masterPool.query(query, params);
    if (treatments.length === 0) {
        throw new Error('Không tìm thấy thẻ liệu trình hoặc không có quyền truy cập');
    }
    
    const treatment = treatments[0];

    const [histories] = await masterPool.query(
        `SELECT * FROM \\`${dbName}\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL ORDER BY execution_date DESC`,
        [treatmentId]
    );

    for (let history of histories) {
        const [staffs] = await masterPool.query(
            `SELECT ths.*, s.fullname as staff_name FROM \\`${dbName}\\`.treatment_history_staffs ths 
            JOIN \\`${dbName}\\`.staffs s ON ths.staff_id = s.id
            WHERE ths.treatment_history_id = ? AND ths.deleted_at IS NULL`,
            [history.id]
        );
        history.staffs = staffs;
    }
    
    treatment.histories = histories;
    return treatment;
};

"""

code = code.replace(old_getTreatmentDetail, new_getTreatmentDetail)

with open('src/services/treatmentService.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("SUCCESS!")
