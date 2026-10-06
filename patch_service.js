const fs = require('fs');
let code = fs.readFileSync('src/services/treatmentService.js', 'utf8');

const newFuncs = `
const getTreatments = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = getTenantDbName(tenantId);
    let query = \`
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name
        FROM \\\`\${dbName}\\\`.treatments t
        JOIN \\\`\${dbName}\\\`.customers c ON t.customer_id = c.id
        JOIN \\\`\${dbName}\\\`.products p ON t.product_id = p.id
        WHERE t.deleted_at IS NULL
    \`;
    const params = [];

    if (filters.customerId) {
        query += ' AND t.customer_id = ?';
        params.push(filters.customerId);
    }
    if (filters.customerSearch) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ?)';
        params.push(\`%\${filters.customerSearch}%\`, \`%\${filters.customerSearch}%\`);
    }
    if (filters.status === 'active') {
        query += ' AND t.remaining_sessions > 0';
    } else if (filters.status === 'completed') {
        query += ' AND t.remaining_sessions = 0';
    }

    if (userRole === 'STAFF') {
        query += ' AND t.branch_id = ?';
        params.push(userBranchId);
    } else if (filters.branchId) {
        query += ' AND t.branch_id = ?';
        params.push(filters.branchId);
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await masterPool.query(query, params);
    return { data: rows };
};

const getTreatmentDetail = async (tenantId, treatmentId, userRole, userBranchId) => {
    const dbName = getTenantDbName(tenantId);
    
    let query = \`
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name
        FROM \\\`\${dbName}\\\`.treatments t
        JOIN \\\`\${dbName}\\\`.customers c ON t.customer_id = c.id
        JOIN \\\`\${dbName}\\\`.products p ON t.product_id = p.id
        WHERE t.id = ? AND t.deleted_at IS NULL
    \`;
    const params = [treatmentId];

    if (userRole === 'STAFF') {
        query += ' AND t.branch_id = ?';
        params.push(userBranchId);
    }

    const [treatments] = await masterPool.query(query, params);
    if (treatments.length === 0) {
        throw new Error('Không tìm thấy thẻ liệu trình hoặc không có quyền truy cập');
    }
    
    const treatment = treatments[0];

    const [histories] = await masterPool.query(
        \`SELECT * FROM \\\`\${dbName}\\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL ORDER BY execution_date DESC\`,
        [treatmentId]
    );

    for (let history of histories) {
        const [staffs] = await masterPool.query(
            \`SELECT ths.*, s.fullname as staff_name FROM \\\`\${dbName}\\\`.treatment_history_staffs ths 
            JOIN \\\`\${dbName}\\\`.staffs s ON ths.staff_id = s.id
            WHERE ths.history_id = ? AND ths.deleted_at IS NULL\`,
            [history.id]
        );
        history.staffs = staffs;
    }
    
    treatment.histories = histories;
    return treatment;
};
`;

code = code.replace(/module\.exports = \{/, newFuncs + '\nmodule.exports = {\n    getTreatments,\n    getTreatmentDetail,');
fs.writeFileSync('src/services/treatmentService.js', code);
console.log('patched service');
