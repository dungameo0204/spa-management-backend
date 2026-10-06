const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

const guardLogic = `
        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);

        // Check if any treatments created from this invoice have been used
        const [guardTreatments] = await connection.query(
            \`SELECT id FROM \\\`\${dbName}\\\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL\`,
            [invoiceId]
        );
        for (const t of guardTreatments) {
            const [histories] = await connection.query(
                \`SELECT id FROM \\\`\${dbName}\\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL LIMIT 1\`,
                [t.id]
            );
            if (histories.length > 0) {
                throw new Error('Không thể xóa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước khi xóa hóa đơn.');
            }
        }
`;

code = code.replace(/const oldInvoice = headers\[0\];[\s\S]*?checkPermission\(userRole, oldInvoice\.created_at\);/g, (match, offset, string) => {
    // Only replace the second occurrence (which is in deleteInvoice) because updateInvoice already has it
    if (offset > string.indexOf('updateInvoice')) {
        if (offset > string.indexOf('deleteInvoice')) {
             return guardLogic;
        }
    }
    return match;
});

fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Patched deleteInvoice');

