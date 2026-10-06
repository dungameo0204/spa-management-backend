const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

const target = `// Sinh liệu trình tự động
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        \`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }`;

const replacement = `// Sinh liệu trình tự động
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        \`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }
            
            // Trừ số lượng tồn kho nếu là sản phẩm vật lý
            if (item.is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, branchId, item.product_id]
                );
            }`;

code = code.replace(target, replacement);
fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Patched');
