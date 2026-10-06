const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

const inventoryLogic = `
        const [items] = await connection.query(\`SELECT product_id, quantity FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL\`, [invoiceId]);
        for (const item of items) {
            const [products] = await connection.query(\`SELECT is_product FROM \\\`\${dbName}\\\`.products WHERE id = ?\`, [item.product_id]);
            if (products.length > 0 && products[0].is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, headers[0].branch_id, item.product_id]
                );
            }
        }
`;

code = code.replace(/await connection\.query\(`UPDATE \\\`\$\{dbName\}\\\`\.invoices SET deleted_at/, inventoryLogic + "\n        $&");
fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Patched inventory rollback');
