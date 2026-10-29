// Internal SQL fragments only: customerIdExpression must never contain request input.
// Reused for customer balances and for the transactional legacy collection limit.
const invoiceDebtSql = (dbName, customerIdExpression) => `
    SELECT COALESCE(SUM(GREATEST(0, i.debt_amount - COALESCE(p.paid, 0))), 0) AS invoice_debt
    FROM \`${dbName}\`.invoices i
    LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS paid FROM \`${dbName}\`.debt_payments
        WHERE deleted_at IS NULL AND invoice_id IS NOT NULL GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE i.customer_id = ${customerIdExpression} AND i.deleted_at IS NULL`;

const withDebtBalances = customer => {
    const invoiceDebt = Number(customer.invoice_debt || 0);
    // Preserve the existing total_debt representation (mysql2 DECIMAL string/null).
    const legacyCents = Math.round(Number(customer.total_debt || 0) * 100) - Math.round(invoiceDebt * 100);
    return { ...customer, invoice_debt: invoiceDebt, legacy_debt: Math.max(0, legacyCents) / 100 };
};

module.exports = { invoiceDebtSql, withDebtBalances };