const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

const newLogic = `
        // Check if any treatments created from this invoice have been used
        const [treatments] = await connection.query(
            \`SELECT id FROM \\\`\${dbName}\\\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL\`,
            [invoiceId]
        );
        for (const t of treatments) {
            const [histories] = await connection.query(
                \`SELECT id FROM \\\`\${dbName}\\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL LIMIT 1\`,
                [t.id]
            );
            if (histories.length > 0) {
                throw new Error('Không thể xóa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước khi xóa hóa đơn.');
            }
        }
`;

code = code.replace(
    /const \[items\] = await connection\.query\([\s\S]*?FROM `\$\{dbName\}`\.invoice_items[\s\S]*?WHERE invoice_id = \?[\s\S]*?\);/,
    `$&` + '\n' + newLogic
);

fs.writeFileSync('src/services/invoiceService.js', code);
console.log('patched invoice service');
