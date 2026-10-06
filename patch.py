import os

with open('src/services/invoiceService.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. createInvoice
old_create = """            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        `INSERT INTO \\`${dbName}\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }"""
new_create = old_create + """
            if (item.is_product === 1) {
                await connection.query(
                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,
                    [item.quantity, branchId, item.product_id]
                );
            }"""
code = code.replace(old_create, new_create)


# 2. updateInvoice guard
old_update_guard = """        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);"""

guard = """
        const [guardTreatments] = await connection.query(
            `SELECT id FROM \\`${dbName}\\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL`,
            [invoiceId]
        );
        for (const t of guardTreatments) {
            const [histories] = await connection.query(
                `SELECT id FROM \\`${dbName}\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL LIMIT 1`,
                [t.id]
            );
            if (histories.length > 0) {
                throw new Error('Không thể sửa/xóa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước.');
            }
        }"""
code = code.replace(old_update_guard, old_update_guard + guard)

# 3. updateInvoice rollback
old_update_rollback = """        const [oldItems] = await connection.query(`SELECT id FROM \\`${dbName}\\`.invoice_items WHERE invoice_id = ?`, [invoiceId]);
        if (oldItems.length > 0) {
            await connection.query(`UPDATE \\`${dbName}\\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(`UPDATE \\`${dbName}\\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        }"""

new_update_rollback = """        const [oldItems] = await connection.query(`SELECT id, product_id, quantity FROM \\`${dbName}\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [invoiceId]);
        if (oldItems.length > 0) {
            for (const item of oldItems) {
                const [products] = await connection.query(`SELECT is_product FROM \\`${dbName}\\`.products WHERE id = ?`, [item.product_id]);
                if (products.length > 0 && products[0].is_product === 1) {
                    await connection.query(
                        `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,
                        [item.quantity, oldInvoice.branch_id, item.product_id]
                    );
                }
            }
            await connection.query(`UPDATE \\`${dbName}\\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(`UPDATE \\`${dbName}\\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        }"""
code = code.replace(old_update_rollback, new_update_rollback)


# 4. updateInvoice deduct
old_update_deduct = """            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const ts = item.default_sessions * item.quantity;
                if (ts > 0) await connection.query(`INSERT INTO \\`${dbName}\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)`, [newCustomerId, item.product_id, invoiceId, ts, ts, executorName]);
            }"""

new_update_deduct = old_update_deduct + """
            if (item.is_product === 1) {
                await connection.query(
                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }"""
code = code.replace(old_update_deduct, new_update_deduct)

# 5. deleteInvoice guard
old_delete_guard = """        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);"""

# The replace will replace both update and delete if they were identical, but we already replaced update guard above!
code = code.replace(old_delete_guard, old_delete_guard + guard)

# 6. deleteInvoice rollback
old_delete_rollback = """        await connection.query(`UPDATE \\`${dbName}\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, invoiceId]);
        await connection.query(`UPDATE \\`${dbName}\\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);"""

new_delete_rollback = """        const [items] = await connection.query(`SELECT product_id, quantity FROM \\`${dbName}\\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [invoiceId]);
        for (const item of items) {
            const [products] = await connection.query(`SELECT is_product FROM \\`${dbName}\\`.products WHERE id = ?`, [item.product_id]);
            if (products.length > 0 && products[0].is_product === 1) {
                await connection.query(
                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,
                    [item.quantity, oldInvoice.branch_id, item.product_id]
                );
            }
        }
        await connection.query(`UPDATE \\`${dbName}\\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, invoiceId]);
        await connection.query(`UPDATE \\`${dbName}\\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);"""
code = code.replace(old_delete_rollback, new_delete_rollback)

with open('src/services/invoiceService.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("SUCCESS!")
