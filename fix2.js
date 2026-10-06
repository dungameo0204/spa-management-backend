const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

// 1. In createInvoice
const createTarget = `if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        \`INSERT INTO \\\`\${dbName}\\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)\`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }`;

const createReplace = createTarget + `
            if (item.is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, branchId, item.product_id]
                );
            }`;
code = code.replace(createTarget, createReplace);

// 2. In updateInvoice
const updateGuardTarget = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);`;

const guardLogic = `
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

code = code.replace(updateGuardTarget, updateGuardTarget + guardLogic);

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

const updateDeductReplace = updateDeductTarget + `
            if (item.is_product === 1) {
                await connection.query(
                    \`UPDATE \\\`\${dbName}\\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?\`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }`;
code = code.replace(updateDeductTarget, updateDeductReplace);


// 3. deleteInvoice
const deleteGuardTarget = `const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);`;

const deleteGuardLogic = guardLogic.replace(/sửa hóa đơn/g, 'xóa hóa đơn');

// Using replace with a global regex so we can skip the first match (which is updateInvoice)
let replacedDelete = false;
code = code.replace(new RegExp(deleteGuardTarget.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&'), 'g'), (match, offset, string) => {
    // If it's the second match (deleteInvoice)
    if (offset > string.indexOf('deleteInvoice')) {
        replacedDelete = true;
        return match + deleteGuardLogic;
    }
    return match; // return original for updateInvoice
});


const deleteRollbackTarget = `await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?\`, [executorName, invoiceId]);
        await connection.query(\`UPDATE \\\`\${dbName}\\\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?\`, [executorName, invoiceId]);`;

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
        await connection.query(\`UPDATE \\\`\${dbName}\\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?\`, [executorName, invoiceId]);
        await connection.query(\`UPDATE \\\`\${dbName}\\\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?\`, [executorName, invoiceId]);`;

code = code.replace(deleteRollbackTarget, deleteRollbackReplace);

fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Fixed successfully');
