import os

with open('src/services/invoiceService.js', 'r', encoding='utf-8') as f:
    code = f.read()

target_start = code.find('        for (const item of normalizedItems) {')
target_end = code.find('        // 4. Trừ Ví và Tăng Công nợ')
if target_start != -1 and target_end != -1:
    new_block = """        for (const item of normalizedItems) {
            const [itemResult] = await connection.query(
                `INSERT INTO \\`${dbName}\\`.invoice_items (invoice_id, product_id, snapshot_name, snapshot_price, quantity, discount_percent, discount_amount, final_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.product_id, item.snapshot_name, item.snapshot_price, item.quantity, item.discount_percent, item.discount_amount, item.final_price, executorName]
            );
            const invoiceItemId = itemResult.insertId;

            if (item.consultants && item.consultants.length > 0) {
                for (const consultant of item.consultants) {
                    await connection.query(
                        `INSERT INTO \\`${dbName}\\`.invoice_item_consultants (invoice_item_id, staff_id, revenue_amount, role_type, created_by) VALUES (?, ?, ?, ?, ?)`,
                        [invoiceItemId, consultant.staff_id, consultant.revenue_amount || 0, consultant.role_type || null, executorName]
                    );
                }
            }

            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        `INSERT INTO \\`${dbName}\\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
            }

            if (item.is_product === 1) {
                await connection.query(
                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,
                    [item.quantity, branchId, item.product_id]
                );
            }
        }

"""
    code = code[:target_start] + new_block + code[target_end:]
    with open('src/services/invoiceService.js', 'w', encoding='utf-8') as f:
        f.write(code)
    print('Cleaned up createInvoice!')
