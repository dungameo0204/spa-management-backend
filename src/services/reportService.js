const { masterPool, getTenantDbName } = require('../config/database');
const { parsePagination } = require('../utils/pagination');

const money = value => Number(value || 0);

const parseFilters = filters => {
    const validDate = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!validDate(filters.startDate) || !validDate(filters.endDate) || filters.startDate > filters.endDate) {
        throw new Error('startDate và endDate phải là ngày YYYY-MM-DD hợp lệ, startDate không được sau endDate.');
    }
    let branchId;
    if (filters.branchId !== undefined) {
        branchId = Number(filters.branchId);
        if (!Number.isSafeInteger(branchId) || branchId < 1) throw new Error('branchId không hợp lệ.');
    }
    let staffId;
    if (filters.staffId !== undefined) {
        staffId = Number(filters.staffId);
        if (!Number.isSafeInteger(staffId) || staffId < 1) throw new Error('staffId không hợp lệ.');
    }
    const search = typeof filters.search === 'string' ? filters.search.trim() : '';
    if (search.length > 100) {
        const error = new Error('search không được vượt quá 100 ký tự.');
        error.status = 400;
        throw error;
    }
    return { startDate: filters.startDate, endDate: filters.endDate, branchId, staffId, search };
};

const pagination = parsePagination;

const scope = (filters, dateColumn, branchColumn) => {
    const sql = `${dateColumn} >= ? AND ${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)` +
        (filters.branchId === undefined ? '' : ` AND ${branchColumn} = ?`);
    return { sql, params: [filters.startDate, filters.endDate, ...(filters.branchId === undefined ? [] : [filters.branchId])] };
};

// Dòng dịch vụ nhận toàn bộ chiết khấu cấp hóa đơn trước; phần dư mới trừ hàng hóa.
// Dùng i.total_amount (đã tính cả % và số tiền chiết khấu cấp hóa đơn), không trừ thêm lần hai.
const invoiceBase = (dbName) => `
    FROM \`${dbName}\`.invoices i
    LEFT JOIN (
        SELECT ii.invoice_id,
               SUM(CASE WHEN p.is_product = 0 THEN ii.final_price ELSE 0 END) AS service_gross,
               SUM(CASE WHEN p.is_product = 1 THEN ii.final_price ELSE 0 END) AS product_gross
        FROM \`${dbName}\`.invoice_items ii
        INNER JOIN \`${dbName}\`.products p ON p.id = ii.product_id
        WHERE ii.deleted_at IS NULL
        GROUP BY ii.invoice_id
    ) items ON items.invoice_id = i.id`;

const serviceNet = `GREATEST(0, COALESCE(items.service_gross, 0) - GREATEST(0, COALESCE(items.service_gross, 0) + COALESCE(items.product_gross, 0) - i.total_amount))`;
const productNet = `(i.total_amount - ${serviceNet})`;
const commissionAmount = 'ths.commission_amount_snapshot';

const sources = dbName => ({
    invoices: {
        from: `${invoiceBase(dbName)} INNER JOIN \`${dbName}\`.branches b ON b.id = i.branch_id INNER JOIN \`${dbName}\`.customers c ON c.id = i.customer_id`,
        where: 'i.deleted_at IS NULL', date: 'i.invoice_date', branch: 'i.branch_id',
        select: `i.id, i.branch_id, b.name AS branch_name, i.customer_id, c.fullname AS customer_name, c.phone_number, i.invoice_date, i.total_amount, i.paid_amount, i.wallet_used, i.debt_amount, i.payment_method, COALESCE(items.service_gross,0) AS service_before_invoice_discount, COALESCE(items.product_gross,0) AS product_before_invoice_discount, GREATEST(0, COALESCE(items.service_gross,0) + COALESCE(items.product_gross,0) - i.total_amount) AS invoice_discount_total, ${serviceNet} AS service_revenue, ${productNet} AS product_revenue`,
        order: 'i.invoice_date DESC, i.id DESC'
    },
    debt_payments: {
        from: `FROM \`${dbName}\`.debt_payments dp INNER JOIN \`${dbName}\`.branches b ON b.id = dp.branch_id INNER JOIN \`${dbName}\`.branches cb ON cb.id = dp.collection_branch_id INNER JOIN \`${dbName}\`.customers c ON c.id = dp.customer_id`,
        where: 'dp.deleted_at IS NULL', date: 'dp.payment_date', branch: 'dp.branch_id',
        select: 'dp.id, dp.invoice_id, dp.customer_id, c.fullname AS customer_name, c.phone_number, dp.branch_id, b.name AS branch_name, dp.collection_branch_id, cb.name AS collection_branch_name, dp.payment_date, dp.amount, dp.payment_method, dp.note',
        order: 'dp.payment_date DESC, dp.id DESC'
    },
    wallet_logs: {
        from: `FROM \`${dbName}\`.customer_wallet_logs w INNER JOIN \`${dbName}\`.branches b ON b.id = w.branch_id INNER JOIN \`${dbName}\`.customers c ON c.id = w.customer_id`,
        where: 'w.deleted_at IS NULL', date: 'w.created_at', branch: 'w.branch_id',
        select: 'w.id, w.customer_id, c.fullname AS customer_name, c.phone_number, w.branch_id, b.name AS branch_name, w.created_at, w.paid_amount, w.bonus_amount, w.total_received, w.payment_method, w.note',
        order: 'w.created_at DESC, w.id DESC'
    },
    expenses: {
        from: `FROM \`${dbName}\`.expense_vouchers e INNER JOIN \`${dbName}\`.branches b ON b.id = e.branch_id`,
        where: 'e.deleted_at IS NULL', date: 'e.expense_date', branch: 'e.branch_id',
        select: 'e.id, e.branch_id, b.name AS branch_name, e.expense_date, e.amount, e.expense_type, e.note',
        order: 'e.expense_date DESC, e.id DESC'
    },
    inventory_imports: {
        from: `FROM \`${dbName}\`.inventory_imports imp INNER JOIN \`${dbName}\`.branches b ON b.id = imp.branch_id`,
        where: 'imp.deleted_at IS NULL', date: 'imp.import_date', branch: 'imp.branch_id',
        select: 'imp.id, imp.branch_id, b.name AS branch_name, imp.import_code, imp.import_date, imp.supplier_name, imp.total_amount, imp.note',
        order: 'imp.import_date DESC, imp.id DESC'
    },
    commissions: {
        from: `FROM \`${dbName}\`.treatment_history_staffs ths INNER JOIN \`${dbName}\`.treatment_history th ON th.id = ths.treatment_history_id INNER JOIN \`${dbName}\`.treatments t ON t.id = th.treatment_id INNER JOIN \`${dbName}\`.staffs s ON s.id = ths.staff_id INNER JOIN \`${dbName}\`.branches b ON b.id = th.branch_id INNER JOIN \`${dbName}\`.customers c ON c.id = t.customer_id INNER JOIN \`${dbName}\`.products p ON p.id = t.product_id LEFT JOIN \`${dbName}\`.roles r ON r.id = s.role_id`,
        where: 'ths.deleted_at IS NULL AND th.deleted_at IS NULL', date: 'th.execution_date', branch: 'th.branch_id',
        select: `ths.id, ths.treatment_history_id, th.execution_date, th.branch_id, b.name AS branch_name, s.id AS staff_id, s.fullname AS staff_name, r.name AS role_name, t.product_id, p.name AS product_name, c.id AS customer_id, c.fullname AS customer_name, ${commissionAmount} AS commission_amount`,
        order: 'th.branch_id ASC, s.fullname ASC, s.id ASC, commission_amount ASC, ths.id ASC',
        group: 'th.branch_id AS branch_id, b.name AS branch_name, s.id AS staff_id, s.fullname AS staff_name', groupBy: 'th.branch_id, b.name, s.id, s.fullname'
    },
    consultants: {
        from: `FROM \`${dbName}\`.invoice_item_consultants ic INNER JOIN \`${dbName}\`.invoice_items ii ON ii.id = ic.invoice_item_id INNER JOIN \`${dbName}\`.invoices i ON i.id = ii.invoice_id INNER JOIN \`${dbName}\`.branches b ON b.id = i.branch_id INNER JOIN \`${dbName}\`.staffs s ON s.id = ic.staff_id INNER JOIN \`${dbName}\`.customers c ON c.id = i.customer_id`,
        where: 'ic.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.deleted_at IS NULL', date: 'i.invoice_date', branch: 'i.branch_id',
        select: 'ic.id, ic.invoice_item_id, i.id AS invoice_id, i.invoice_date, i.branch_id, b.name AS branch_name, s.id AS staff_id, s.fullname AS staff_name, c.id AS customer_id, c.fullname AS customer_name, ii.product_id, ii.snapshot_name AS product_name, ii.final_price AS item_final_price, ic.role_type, ic.revenue_amount',
        order: 'i.branch_id ASC, s.fullname ASC, s.id ASC, ic.revenue_amount ASC, ic.id ASC',
        group: 'i.branch_id AS branch_id, b.name AS branch_name, s.id AS staff_id, s.fullname AS staff_name', groupBy: 'i.branch_id, b.name, s.id, s.fullname'
    }
});

// Explicit columns only: never interpolate user input into SQL identifiers or LIKE patterns.
const searchColumns = {
    invoices: ['i.id', 'b.name', 'c.fullname', 'c.phone_number', 'i.payment_method', 'i.total_amount', 'i.paid_amount', 'i.debt_amount'],
    debt_payments: ['dp.id', 'dp.invoice_id', 'b.name', 'cb.name', 'c.fullname', 'c.phone_number', 'dp.payment_method', 'dp.note', 'dp.amount'],
    wallet_logs: ['w.id', 'b.name', 'c.fullname', 'c.phone_number', 'w.payment_method', 'w.note', 'w.paid_amount'],
    expenses: ['e.id', 'b.name', 'e.note', 'e.amount', 'e.expense_type'],
    inventory_imports: ['imp.id', 'b.name', 'imp.import_code', 'imp.supplier_name', 'imp.note', 'imp.total_amount'],
    commissions: ['ths.id', 'b.name', 's.fullname', 'r.name', 'c.fullname', 'p.name', commissionAmount],
    consultants: ['ic.id', 'i.id', 'b.name', 's.fullname', 'c.fullname', 'ii.snapshot_name', 'ic.role_type', 'ic.revenue_amount']
};

const getSource = (dbName, type, filters) => {
    const source = sources(dbName)[type];
    if (!source) throw new Error('type không hợp lệ.');
    const range = scope(filters, source.date, source.branch);
    if (filters.staffId !== undefined && type !== 'commissions' && type !== 'consultants') {
        throw new Error('staffId chỉ dùng cho báo cáo commissions hoặc consultants.');
    }
    const staffScope = filters.staffId === undefined ? '' : ` AND ${type === 'commissions' ? 's.id' : 'ic.staff_id'} = ?`;
    const columns = searchColumns[type];
    const itemSearch = type === 'expenses' ? ` OR EXISTS (SELECT 1 FROM \`${dbName}\`.expenses_vouchers_items xi WHERE xi.expenses_voucher_id = e.id AND LOCATE(LOWER(?), LOWER(xi.expense_type)) > 0)` : '';
    const searchScope = filters.search ? ` AND (${columns.map(column => `LOCATE(LOWER(?), LOWER(COALESCE(CAST(${column} AS CHAR), ''))) > 0`).join(' OR ')}${itemSearch})` : '';
    return { ...source, where: `${source.where} AND ${range.sql}${staffScope}${searchScope}`, params: [...range.params, ...(filters.staffId === undefined ? [] : [filters.staffId]), ...(filters.search ? [...columns.map(() => filters.search), ...(type === 'expenses' ? [filters.search] : [])] : [])] };
};

const totalFor = async (source, field) => {
    const [rows] = await masterPool.query(`SELECT COALESCE(SUM(${field}), 0) AS value ${source.from} WHERE ${source.where}`, source.params);
    return money(rows[0].value);
};

const dailyFor = async (source, field) => {
    const [rows] = await masterPool.query(
        `SELECT DATE_FORMAT(${source.date}, '%Y-%m-%d') AS date, SUM(${field}) AS value ${source.from} WHERE ${source.where} GROUP BY DATE_FORMAT(${source.date}, '%Y-%m-%d') ORDER BY date`,
        source.params
    );
    return new Map(rows.map(row => [row.date, money(row.value)]));
};

const round = value => Math.round(value * 100) / 100;
const revenueAmounts = (serviceRevenue, productRevenue, invoiceCash, walletUsed, debtPayments, walletTopups, expenseVouchers, inventoryImports) => {
    const totalReceipts = round(invoiceCash + debtPayments + walletTopups);
    const totalExpenses = round(expenseVouchers + inventoryImports);
    return {
        serviceRevenue, productRevenue, totalRevenue: round(serviceRevenue + productRevenue),
        receipts: { invoiceCash, debtPayments, walletTopups, total: totalReceipts, walletUsedExcluded: walletUsed },
        expenses: { expenseVouchers, inventoryImports, total: totalExpenses },
        netCashFlow: round(totalReceipts - totalExpenses)
    };
};

const getRevenue = async (tenantId, input) => {
    const filters = { ...parseFilters(input), search: '' };
    if (filters.staffId !== undefined) throw new Error('staffId chỉ dùng cho báo cáo commissions hoặc consultants.');
    const dbName = await getTenantDbName(tenantId);
    const invoice = getSource(dbName, 'invoices', filters);
    const debtSource = getSource(dbName, 'debt_payments', filters);
    const walletSource = getSource(dbName, 'wallet_logs', filters);
    const expenseSource = getSource(dbName, 'expenses', filters);
    const inventorySource = getSource(dbName, 'inventory_imports', filters);
    const [[invoiceTotals], debtPayments, walletTopups, expenseVouchers, inventoryImports,
        [invoiceDays], debtDays, walletDays, expenseDays, inventoryDays] = await Promise.all([
        masterPool.query(`SELECT COALESCE(SUM(${serviceNet}), 0) AS service_revenue, COALESCE(SUM(${productNet}), 0) AS product_revenue, COALESCE(SUM(i.paid_amount), 0) AS invoice_cash, COALESCE(SUM(i.wallet_used), 0) AS wallet_used ${invoice.from} WHERE ${invoice.where}`, invoice.params),
        totalFor(debtSource, 'dp.amount'),
        totalFor(walletSource, 'w.paid_amount'),
        totalFor(expenseSource, 'e.amount'),
        totalFor(inventorySource, 'imp.total_amount'),
        masterPool.query(`SELECT DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date,
            SUM(${serviceNet}) AS service_revenue, SUM(${productNet}) AS product_revenue,
            SUM(i.paid_amount) AS invoice_cash, SUM(i.wallet_used) AS wallet_used
            ${invoice.from} WHERE ${invoice.where} GROUP BY DATE_FORMAT(i.invoice_date, '%Y-%m-%d') ORDER BY date`, invoice.params),
        dailyFor(debtSource, 'dp.amount'),
        dailyFor(walletSource, 'w.paid_amount'),
        dailyFor(expenseSource, 'e.amount'),
        dailyFor(inventorySource, 'imp.total_amount')
    ]);
    const { service_revenue, product_revenue, invoice_cash, wallet_used } = invoiceTotals[0];
    const invoiceByDay = new Map(invoiceDays.map(row => [row.date, row]));
    const daily = [];
    const end = Date.parse(`${filters.endDate}T00:00:00Z`);
    for (let time = Date.parse(`${filters.startDate}T00:00:00Z`); time <= end; time += 86400000) {
        const date = new Date(time).toISOString().slice(0, 10);
        const row = invoiceByDay.get(date) || {};
        daily.push({ date, ...revenueAmounts(
            money(row.service_revenue), money(row.product_revenue), money(row.invoice_cash), money(row.wallet_used),
            debtDays.get(date) || 0, walletDays.get(date) || 0, expenseDays.get(date) || 0, inventoryDays.get(date) || 0
        ) });
    }
    return { period: { startDate: filters.startDate, endDate: filters.endDate, branchId: filters.branchId ?? null },
        ...revenueAmounts(money(service_revenue), money(product_revenue), money(invoice_cash), money(wallet_used),
            debtPayments, walletTopups, expenseVouchers, inventoryImports), daily };
};

const getDetails = async (tenantId, type, input) => {
    const filters = parseFilters(input);
    const paging = pagination(input);
    const dbName = await getTenantDbName(tenantId);
    const source = getSource(dbName, type, filters);
    const amountColumns = {
        invoices: 'i.total_amount', debt_payments: 'dp.amount', wallet_logs: 'w.paid_amount',
        expenses: 'e.amount', inventory_imports: 'imp.total_amount',
        commissions: commissionAmount, consultants: 'ic.revenue_amount'
    };
    const [[totals], [rows]] = await Promise.all([
        masterPool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(${amountColumns[type]}), 0) AS total_amount ${source.from} WHERE ${source.where}`, source.params),
        masterPool.query(`SELECT ${source.select} ${source.from} WHERE ${source.where} ORDER BY ${source.order} LIMIT ? OFFSET ?`, [...source.params, paging.pageSize, paging.offset])
    ]);
    const total = Number(totals[0].total);
    return { type, period: { startDate: filters.startDate, endDate: filters.endDate, branchId: filters.branchId ?? null, ...(filters.staffId === undefined ? {} : { staffId: filters.staffId }) },
        page: paging.page, pageSize: paging.pageSize, total, totalAmount: money(totals[0].total_amount), totalPages: Math.ceil(total / paging.pageSize), data: rows };
};

const getStaffReport = async (tenantId, type, input) => {
    const filters = parseFilters(input);
    const paging = pagination(input);
    const dbName = await getTenantDbName(tenantId);
    const source = getSource(dbName, type, filters);
    const amount = type === 'commissions' ? commissionAmount : 'ic.revenue_amount';
    const groupedSql = `SELECT ${source.group}, COALESCE(SUM(${amount}), 0) AS total_amount, COUNT(*) AS record_count ${source.from} WHERE ${source.where} GROUP BY ${source.groupBy}`;
    const [[totals], [rows]] = await Promise.all([
        masterPool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS grand_total FROM (${groupedSql}) AS grouped`, source.params),
        masterPool.query(`${groupedSql} ORDER BY ${source.branch} ASC, s.fullname ASC, s.id ASC LIMIT ? OFFSET ?`, [...source.params, paging.pageSize, paging.offset])
    ]);
    const groups = rows.map(row => ({ branch_id: row.branch_id, branch_name: row.branch_name, staff_id: row.staff_id, staff_name: row.staff_name, total_amount: money(row.total_amount), record_count: Number(row.record_count) }));
    const total = Number(totals[0].total);
    return { period: { startDate: filters.startDate, endDate: filters.endDate, branchId: filters.branchId ?? null, ...(filters.staffId === undefined ? {} : { staffId: filters.staffId }) }, totalAmount: money(totals[0].grand_total), total, page: paging.page, pageSize: paging.pageSize, totalPages: Math.ceil(total / paging.pageSize), staffTotals: groups };
};

// Allocate the invoice-level discount to services first (same rule as /revenue),
// then proportionally between lines of the same category. Round each sold line
// before summing so the category total agrees with its paginated invoice lines.
const productSalesSource = (dbName, filters) => {
    const range = scope(filters, 'i.invoice_date', 'i.branch_id');
    const lineRevenue = `CASE WHEN p.is_product = 0 THEN
        CASE WHEN COALESCE(items.service_gross, 0) = 0 THEN 0
             ELSE ii.final_price * ${serviceNet} / items.service_gross END
        ELSE CASE WHEN COALESCE(items.product_gross, 0) = 0 THEN 0
             ELSE ii.final_price * ${productNet} / items.product_gross END END`;
    return {
        sql: `SELECT ii.id AS invoice_item_id, i.id AS invoice_id, i.invoice_date,
                i.branch_id, b.name AS branch_name, i.customer_id, c.fullname AS customer_name,
                c.phone_number, ii.product_id, p.name AS product_name, p.is_product,
                ii.snapshot_name, ii.snapshot_price, ii.quantity,
                ii.discount_percent, ii.discount_amount, ii.final_price,
                ROUND(${lineRevenue}, 2) AS revenue
              ${invoiceBase(dbName)}
              INNER JOIN \`${dbName}\`.invoice_items ii ON ii.invoice_id = i.id
              INNER JOIN \`${dbName}\`.products p ON p.id = ii.product_id
              INNER JOIN \`${dbName}\`.branches b ON b.id = i.branch_id
              INNER JOIN \`${dbName}\`.customers c ON c.id = i.customer_id
              WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND ${range.sql}`,
        params: range.params
    };
};

const productFilters = input => {
    const filters = parseFilters(input);
    if (filters.staffId !== undefined) throw new Error('staffId chỉ dùng cho báo cáo commissions hoặc consultants.');
    return filters;
};

const getProductRevenue = async (tenantId, input) => {
    const filters = productFilters(input);
    const paging = pagination(input);
    const dbName = await getTenantDbName(tenantId);
    const sales = productSalesSource(dbName, filters);
    const grouped = `SELECT product_id, product_name, is_product,
        COUNT(DISTINCT invoice_id) AS invoice_count, COUNT(*) AS item_count,
        COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(final_price), 0) AS item_total,
        COALESCE(SUM(revenue), 0) AS revenue
        FROM (${sales.sql}) AS sales GROUP BY product_id, product_name, is_product`;
    const filtered = filters.search ? `${grouped} HAVING LOCATE(LOWER(?), LOWER(product_name)) > 0 OR LOCATE(LOWER(?), CAST(product_id AS CHAR)) > 0` : grouped;
    const params = filters.search ? [...sales.params, filters.search, filters.search] : sales.params;
    const [[overall], [rows]] = await Promise.all([
        masterPool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(revenue), 0) AS total_revenue FROM (${filtered}) AS grouped`, params),
        masterPool.query(`${filtered} ORDER BY revenue DESC, product_id ASC LIMIT ? OFFSET ?`, [...params, paging.pageSize, paging.offset])
    ]);
    const total = Number(overall[0].total);
    return {
        period: { startDate: filters.startDate, endDate: filters.endDate, branchId: filters.branchId ?? null },
        totalRevenue: money(overall[0].total_revenue), total, page: paging.page,
        pageSize: paging.pageSize, totalPages: Math.ceil(total / paging.pageSize),
        data: rows.map(row => ({ ...row, invoice_count: Number(row.invoice_count), item_count: Number(row.item_count), quantity: Number(row.quantity), item_total: money(row.item_total), revenue: money(row.revenue) }))
    };
};

const getProductInvoices = async (tenantId, productIdInput, input) => {
    const id = Number(productIdInput);
    if (typeof productIdInput !== 'string' || !/^[1-9]\d*$/.test(productIdInput) || !Number.isSafeInteger(id)) {
        const error = new Error('productId không hợp lệ.');
        error.status = 400;
        throw error;
    }
    const filters = productFilters(input);
    const paging = pagination(input);
    const dbName = await getTenantDbName(tenantId);
    const [products] = await masterPool.query(`SELECT id, name, is_product FROM \`${dbName}\`.products WHERE id = ?`, [id]);
    if (products.length === 0) {
        const error = new Error('Sản phẩm/Dịch vụ không tồn tại.');
        error.status = 404;
        throw error;
    }
    const sales = productSalesSource(dbName, filters);
    const from = `FROM (${sales.sql}) AS sales WHERE product_id = ?`;
    const params = [...sales.params, id];
    const [[summary], [rows]] = await Promise.all([
        masterPool.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT invoice_id) AS invoice_count,
            COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(final_price), 0) AS item_total,
            COALESCE(SUM(revenue), 0) AS revenue ${from}`, params),
        masterPool.query(`SELECT * ${from} ORDER BY invoice_date DESC, invoice_id DESC, invoice_item_id DESC LIMIT ? OFFSET ?`, [...params, paging.pageSize, paging.offset])
    ]);
    const total = Number(summary[0].total);
    return {
        period: { startDate: filters.startDate, endDate: filters.endDate, branchId: filters.branchId ?? null },
        product: products[0], invoiceCount: Number(summary[0].invoice_count),
        quantity: Number(summary[0].quantity), itemTotal: money(summary[0].item_total), revenue: money(summary[0].revenue),
        total, page: paging.page, pageSize: paging.pageSize, totalPages: Math.ceil(total / paging.pageSize),
        data: rows.map(row => ({ ...row, revenue: money(row.revenue) }))
    };
};

module.exports = { getRevenue, getDetails, getStaffReport, getProductRevenue, getProductInvoices };