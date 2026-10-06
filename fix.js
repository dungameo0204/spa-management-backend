const fs = require('fs');
const code = fs.readFileSync('src/services/invoiceService.js', 'utf8');

// 1. In createInvoice
let createTarget = code.match(/if \\(item\\.is_product === 0 \\|\\| item\\.is_treatment_combo === 1\\) \\{[\\s\\S]*?const totalSessions = item\\.default_sessions \\* item\\.quantity;[\\s\\S]*?if \\(totalSessions > 0\\) \\{[\\s\\S]*?await connection\\.query\\([\\s\\S]*?INSERT INTO \\\`\\$\\{dbName\\}\\\`\\.treatments[\\s\\S]*?\\);[\\s\\S]*?\\}[\\s\\S]*?\\}/)[0];

let createReplace = createTarget + "\\n" +
"            // Trừ số lượng tồn kho nếu là sản phẩm vật lý\\n" +
"            if (item.is_product === 1) {\\n" +
"                await connection.query(\\n" +
"                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,\\n" +
"                    [item.quantity, branchId, item.product_id]\\n" +
"                );\\n" +
"            }";

let newCode = code.replace(createTarget, createReplace);

// 2. updateInvoice guard
let updateGuardTargetMatch = newCode.match(/const updateInvoice = async[\\s\\S]*?const oldInvoice = headers\\[0\\];[\\s\\S]*?checkPermission\\(userRole, oldInvoice\\.created_at\\);/);
let updateGuardTarget = updateGuardTargetMatch[0];

let guardLogic = "\\n" +
"        const [guardTreatments] = await connection.query(\\n" +
"            `SELECT id FROM \\`${dbName}\\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL`,\\n" +
"            [invoiceId]\\n" +
"        );\\n" +
"        for (const t of guardTreatments) {\\n" +
"            const [histories] = await connection.query(\\n" +
"                `SELECT id FROM \\`${dbName}\\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL LIMIT 1`,\\n" +
"                [t.id]\\n" +
"            );\\n" +
"            if (histories.length > 0) {\\n" +
"                throw new Error('Không thể sửa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước khi sửa hóa đơn.');\\n" +
"            }\\n" +
"        }";

newCode = newCode.replace(updateGuardTarget, updateGuardTarget + guardLogic);

// 3. deleteInvoice guard
let deleteGuardTargetMatch = newCode.match(/const deleteInvoice = async[\\s\\S]*?const oldInvoice = headers\\[0\\];[\\s\\S]*?checkPermission\\(userRole, oldInvoice\\.created_at\\);/);
let deleteGuardTarget = deleteGuardTargetMatch[0];

let deleteGuardLogic = guardLogic.replace('sửa hóa đơn.', 'xóa hóa đơn.');
newCode = newCode.replace(deleteGuardTarget, deleteGuardTarget + deleteGuardLogic);

// 4. updateInvoice Rollback
let updateRollbackTargetMatch = newCode.match(/const \\\[oldItems\\\] = await connection\\.query\\(`SELECT id FROM \\`\\$\\{dbName\\}\\`\\.invoice_items WHERE invoice_id = \\?`, \\\[invoiceId\\\]\\);\\r?\\n\\s*if \\(oldItems\\.length > 0\\) \\{\\r?\\n\\s*await connection\\.query\\(`UPDATE \\`\\$\\{dbName\\}\\`\\.invoice_item_consultants SET deleted_at = NOW\\(\\), deleted_by = \\? WHERE invoice_item_id IN \\(\\?\\)`, \\\[executorName, oldItems\\.map\\(i => i\\.id\\)\\\]\\);\\r?\\n\\s*await connection\\.query\\(`UPDATE \\`\\$\\{dbName\\}\\`\\.invoice_items SET deleted_at = NOW\\(\\), deleted_by = \\? WHERE invoice_id = \\?`, \\\[executorName, invoiceId\\\]\\);\\r?\\n\\s*\\}/);

let updateRollbackTarget = updateRollbackTargetMatch[0];

let updateRollbackReplace = updateRollbackTarget.replace('SELECT id FROM', 'SELECT id, product_id, quantity FROM')
    .replace('WHERE invoice_id = ?`', 'WHERE invoice_id = ? AND deleted_at IS NULL`')
    .replace('if (oldItems.length > 0) {', "if (oldItems.length > 0) {\\n" +
    "            for (const item of oldItems) {\\n" +
    "                const [products] = await connection.query(`SELECT is_product FROM \\`${dbName}\\`.products WHERE id = ?`, [item.product_id]);\\n" +
    "                if (products.length > 0 && products[0].is_product === 1) {\\n" +
    "                    await connection.query(\\n" +
    "                        `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity + ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,\\n" +
    "                        [item.quantity, oldInvoice.branch_id, item.product_id]\\n" +
    "                    );\\n" +
    "                }\\n" +
    "            }");

newCode = newCode.replace(updateRollbackTarget, updateRollbackReplace);

// 5. updateInvoice Deduct
let forLoopTargetMatch = newCode.match(/for \\(const item of normalizedItems\\) \\{[\\s\\S]*?if \\(item\\.is_product === 0 \\|\\| item\\.is_treatment_combo === 1\\) \\{[\\s\\S]*?if \\(ts > 0\\) await connection\\.query\\([\\s\\S]*?INSERT INTO \\`\\$\\{dbName\\}\\`\\.treatments[\\s\\S]*?\\);\\s*\\}\\s*\\}/);
let forLoopTarget = forLoopTargetMatch[0];

let deductNewTargetMatch = forLoopTarget.match(/if \\(item\\.is_product === 0 \\|\\| item\\.is_treatment_combo === 1\\) \\{[\\s\\S]*?\\}\\s*\\}/);
let deductNewTarget = deductNewTargetMatch[0];

let deductNewReplace = deductNewTarget + "\\n" +
"            if (item.is_product === 1) {\\n" +
"                await connection.query(\\n" +
"                    `UPDATE \\`${dbName}\\`.inventory SET quantity = quantity - ?, updated_at = NOW() WHERE branch_id = ? AND product_id = ?`,\\n" +
"                    [item.quantity, oldInvoice.branch_id, item.product_id]\\n" +
"                );\\n" +
"            }";

let forLoopReplace = forLoopTarget.replace(deductNewTarget, deductNewReplace);
newCode = newCode.replace(forLoopTarget, forLoopReplace);

fs.writeFileSync('src/services/invoiceService.js', newCode);
console.log('Fixed successfully in script');
