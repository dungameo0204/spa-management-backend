const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

// 1. Add Guard to updateInvoice
const guardLogic = `
        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
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
                throw new Error('Không thể sửa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước khi sửa hóa đơn.');
            }
        }
`;

code = code.replace(/const oldInvoice = headers\[0\];[\s\S]*?checkPermission\(userRole, oldInvoice\.created_at\);/, guardLogic);

// 2. Add inventory rollback for old items in updateInvoice
const oldItemsRollbackLogic = `
        const [oldItems] = await connection.query(\`SELECT id, product_id, quantity FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL\`, [invoiceId]);
        if (oldItems.length > 0) {
            // Khôi phục tồn kho cho các sản phẩm vật lý cũ
            for (const item of oldItems) {
                const [products] = await connection.query(\`SELECT is_product FROM \\\`\${dbName}\\\`.products WHERE id = ?\`, [item.product_id]);
                if (products.length > 0 && products[0].is_product === 1) {
                    await connection.query(
                        \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                        [item.quantity, oldInvoice.branch_id, item.product_id]
                    );
                }
            }

            await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)\`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?\`, [executorName, invoiceId]);
        }
`;

code = code.replace(/const \[oldItems\] = await connection\.query\(`SELECT id FROM \\\`\$\{dbName\}\\\`\.invoice_items WHERE invoice_id = \?`, \[invoiceId\]\);\s*if \(oldItems\.length > 0\) \{[\s\S]*?\}/, oldItemsRollbackLogic);

// 3. Add inventory deduction for new items in updateInvoice
const newItemDeductLogic = `
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        \`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`,
                        [newCustomerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }
            
            // Trừ số lượng tồn kho nếu là sản phẩm vật lý
            if (item.is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }
`;

code = code.replace(/if \(item\.is_product === 0 \|\| item\.is_treatment_combo === 1\) \{[\s\S]*?\}[\s\S]*?\}/, newItemDeductLogic);

fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Patched updateInvoice');

