const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

// 1. In createInvoice: deduct inventory
const createDeductTarget = `
            // Sinh liệu trình tự động
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        \`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }
        }`;
const createDeductReplace = `
            // Sinh liệu trình tự động
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
            }
        }`;
code = code.replace(createDeductTarget, createDeductReplace);


// 2. In updateInvoice: Add guard + rollback old inventory + deduct new inventory
const updateGuardTarget = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);`;
const updateGuardReplace = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);
        
        // Kiểm tra liệu trình đã sử dụng chưa
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
        }`;
code = code.replace(updateGuardTarget, updateGuardReplace);

const updateRollbackTarget = `const [oldItems] = await connection.query(\`SELECT id FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ?\`, [invoiceId]);
        if (oldItems.length > 0) {
            await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)\`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?\`, [executorName, invoiceId]);
        }`;
const updateRollbackReplace = `const [oldItems] = await connection.query(\`SELECT id, product_id, quantity FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL\`, [invoiceId]);
        if (oldItems.length > 0) {
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
        }`;
code = code.replace(updateRollbackTarget, updateRollbackReplace);

const updateDeductTarget = `if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const ts = item.default_sessions * item.quantity;
                if (ts > 0) await connection.query(\`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`, [newCustomerId, item.product_id, invoiceId, ts, ts, executorName]);
            }`;
const updateDeductReplace = `if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const ts = item.default_sessions * item.quantity;
                if (ts > 0) await connection.query(\`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`, [newCustomerId, item.product_id, invoiceId, ts, ts, executorName]);
            }
            if (item.is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }`;
code = code.replace(updateDeductTarget, updateDeductReplace);


// 3. In deleteInvoice: Add guard + rollback old inventory
const deleteGuardTarget = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);`;
const deleteGuardReplace = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);

        // Kiểm tra liệu trình đã sử dụng chưa
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
        }`;
code = code.replace(deleteGuardTarget, deleteGuardReplace);

const deleteRollbackTarget = `await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?\`, [executorName, invoiceId]);`;
const deleteRollbackReplace = `const [items] = await connection.query(\`SELECT product_id, quantity FROM \\\`\${dbName}\\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL\`, [invoiceId]);
        for (const item of items) {
            const [products] = await connection.query(\`SELECT is_product FROM \\\`\${dbName}\\\`.products WHERE id = ?\`, [item.product_id]);
            if (products.length > 0 && products[0].is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }
        }
        await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?\`, [executorName, invoiceId]);`;
code = code.replace(deleteRollbackTarget, deleteRollbackReplace);

fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Successfully patched all invoice logic');

