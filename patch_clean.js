const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

const newLogic = `if (headers.length === 0) throw new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');

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

code = code.replace(/if \(headers\.length === 0\) throw new Error\('Hóa đơn không tồn tại hoặc đã bị xóa\.'\);/, newLogic);

const inventoryLogic = `
        const [items] = await connection.query(\`SELECT product_id, quantity FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL\`, [invoiceId]);
        for (const item of items) {
            const [products] = await connection.query(\`SELECT is_product FROM \\\`\${dbName}\\\`.products WHERE id = ?\`, [item.product_id]);
            if (products.length > 0 && products[0].is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }
        }
`;
code = code.replace(/await connection\.query\(`UPDATE \\\`\$\{dbName\}\\\`\.invoices SET deleted_at/, inventoryLogic + "\n        $&");

fs.writeFileSync('src/services/invoiceService.js', code);
