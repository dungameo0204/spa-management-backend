const baseUrl = 'http://localhost:5000/api';

const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, options);
    const body = await response.json();
    return { status: response.status, body };
};

const assertStatus = (result, expectedStatus, label) => {
    if (result.status !== expectedStatus) {
        throw new Error(`${label}: expected HTTP ${expectedStatus}, received ${result.status}: ${JSON.stringify(result.body)}`);
    }
};

const run = async () => {
    const suffix = `wallet-guard-${Date.now()}`;
    const login = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '3thang10', password: '123' })
    });
    assertStatus(login, 200, 'Login');

    const token = login.body.data?.token;
    if (!token) throw new Error(`Login did not return token: ${JSON.stringify(login.body)}`);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const created = { customerId: null, productId: null, invoiceId: null, debtPaymentId: null };

    try {
        const customer = await request('/customers', {
            method: 'POST', headers,
            body: JSON.stringify({ fullname: `Test ${suffix}`, phone_number: `${Date.now()}`.slice(-10) })
        });
        assertStatus(customer, 201, 'Create customer');
        created.customerId = customer.body.customerId;

        const product = await request('/products', {
            method: 'POST', headers,
            body: JSON.stringify({ name: `Test ${suffix}`, price: 500000, is_product: 0, is_treatment_combo: 0, default_sessions: 0 })
        });
        assertStatus(product, 201, 'Create product');
        created.productId = product.body.productId;

        const invoicePayload = (paidAmount, walletUsed) => ({
            customer_id: created.customerId,
            branch_id: 1,
            paid_amount: paidAmount,
            wallet_used: walletUsed,
            payment_method: 'CASH',
            items: [{ product_id: created.productId, quantity: 1, unit_price: 500000 }]
        });

        const excessiveWallet = await request('/invoices', {
            method: 'POST', headers, body: JSON.stringify(invoicePayload(0, 500001))
        });
        assertStatus(excessiveWallet, 400, 'Reject wallet_used greater than total_amount');
        if (excessiveWallet.body.message !== 'wallet_used không được lớn hơn tổng tiền hóa đơn.') {
            throw new Error(`Unexpected excessive wallet error: ${JSON.stringify(excessiveWallet.body)}`);
        }

        const excessivePayment = await request('/invoices', {
            method: 'POST', headers, body: JSON.stringify(invoicePayload(500000, 1))
        });
        assertStatus(excessivePayment, 400, 'Reject paid_amount plus wallet_used greater than total_amount');
        if (excessivePayment.body.message !== 'Tổng wallet_used và paid_amount không được lớn hơn tổng tiền hóa đơn.') {
            throw new Error(`Unexpected excessive total payment error: ${JSON.stringify(excessivePayment.body)}`);
        }

        const invoice = await request('/invoices', {
            method: 'POST', headers, body: JSON.stringify(invoicePayload(0, 0))
        });
        assertStatus(invoice, 201, 'Create debt invoice');
        created.invoiceId = invoice.body.invoiceId;
        if (Number(invoice.body.debtAmount) !== 500000) {
            throw new Error(`Debt invoice should have debtAmount 500000: ${JSON.stringify(invoice.body)}`);
        }

        const debtSummaryPath = `/debt-payments/invoices/${created.invoiceId}/remaining-debt`;
        const assertRemainingDebt = async (paid, remaining) => {
            const result = await request(debtSummaryPath, { headers });
            assertStatus(result, 200, 'Get remaining invoice debt');
            const data = result.body.data;
            if (Number(data.invoiceId) !== Number(created.invoiceId) || Number(data.invoiceDebtAmount) !== 500000 ||
                Number(data.paidDebtAmount) !== paid || Number(data.remainingDebtAmount) !== remaining) {
                throw new Error(`Unexpected remaining invoice debt: ${JSON.stringify(result.body)}`);
            }
        };
        await assertRemainingDebt(0, 500000);

        const missingInvoice = await request('/debt-payments', {
            method: 'POST', headers,
            body: JSON.stringify({ collection_branch_id: 1, amount: 500000 })
        });
        assertStatus(missingInvoice, 400, 'Require invoice_id');
        if (missingInvoice.body.message !== 'invoice_id là bắt buộc khi thu nợ.') throw new Error(JSON.stringify(missingInvoice.body));

        const mismatchedBranch = await request('/debt-payments', {
            method: 'POST', headers,
            body: JSON.stringify({ invoice_id: created.invoiceId, branch_id: 999, collection_branch_id: 1, amount: 500000 })
        });
        assertStatus(mismatchedBranch, 400, 'Reject accounting branch mismatch');

        const firstDebtPayment = await request('/debt-payments', {
            method: 'POST', headers,
            body: JSON.stringify({ collection_branch_id: 1, invoice_id: created.invoiceId, amount: 200000, payment_method: 'CASH' })
        });
        assertStatus(firstDebtPayment, 201, 'Create first debt payment');
        created.debtPaymentId = firstDebtPayment.body.debtPaymentId;
        await assertRemainingDebt(200000, 300000);
        const debtPayment = await request('/debt-payments', {
            method: 'POST', headers,
            body: JSON.stringify({ collection_branch_id: 1, invoice_id: created.invoiceId, amount: 300000, payment_method: 'CASH' })
        });
        assertStatus(debtPayment, 201, 'Pay remaining invoice debt');
        created.secondDebtPaymentId = debtPayment.body.debtPaymentId;
        await assertRemainingDebt(500000, 0);
        if (Number(debtPayment.body.branchId) !== 1 || Number(debtPayment.body.customerId) !== Number(created.customerId) || Number(debtPayment.body.collectionBranchId) !== 1) {
            throw new Error(`Unexpected branch/customer attribution: ${JSON.stringify(debtPayment.body)}`);
        }

        const overpaidInvoice = await request('/debt-payments', {
            method: 'POST', headers,
            body: JSON.stringify({ collection_branch_id: 1, invoice_id: created.invoiceId, amount: 1 })
        });
        assertStatus(overpaidInvoice, 400, 'Reject total payments exceeding invoice debt');
        if (overpaidInvoice.body.message !== 'Tổng tiền thu nợ của hóa đơn không được vượt debt_amount của hóa đơn.') {
            throw new Error(`Unexpected invoice overpayment error: ${JSON.stringify(overpaidInvoice.body)}`);
        }
        const overpaidUpdate = await request(`/debt-payments/${created.secondDebtPaymentId}`, {
            method: 'PUT', headers, body: JSON.stringify({ amount: 300001 })
        });
        assertStatus(overpaidUpdate, 400, 'Reject update exceeding invoice debt');
        if (overpaidUpdate.body.message !== 'Tổng tiền thu nợ của hóa đơn không được vượt debt_amount của hóa đơn.') {
            throw new Error(`Unexpected invoice update overpayment error: ${JSON.stringify(overpaidUpdate.body)}`);
        }
        await assertRemainingDebt(500000, 0);

        const clearInvoice = await request(`/debt-payments/${created.debtPaymentId}`, {
            method: 'PUT', headers, body: JSON.stringify({ invoice_id: null })
        });
        assertStatus(clearInvoice, 400, 'Reject clearing invoice_id');

        const update = await request(`/invoices/${created.invoiceId}`, {
            method: 'PUT', headers, body: JSON.stringify(invoicePayload(0, 0))
        });
        assertStatus(update, 400, 'Reject update for invoice with debt payment');
        if (update.body.message !== 'Không thể sửa hóa đơn đã có phiếu thu nợ.') {
            throw new Error(`Unexpected invoice update guard error: ${JSON.stringify(update.body)}`);
        }

        const deletion = await request(`/invoices/${created.invoiceId}`, { method: 'DELETE', headers });
        assertStatus(deletion, 400, 'Reject delete for invoice with debt payment');
        if (deletion.body.message !== 'Không thể xóa hóa đơn đã có phiếu thu nợ.') {
            throw new Error(`Unexpected invoice delete guard error: ${JSON.stringify(deletion.body)}`);
        }

        const deleteSecondPayment = await request(`/debt-payments/${created.secondDebtPaymentId}`, { method: 'DELETE', headers });
        assertStatus(deleteSecondPayment, 200, 'Soft-delete second debt payment');
        created.secondDebtPaymentId = null;
        await assertRemainingDebt(200000, 300000);

        console.log('PASS: invoice payment validation and debt-payment invoice guards are working.');
    } finally {
        if (created.secondDebtPaymentId) await request(`/debt-payments/${created.secondDebtPaymentId}`, { method: 'DELETE', headers });
        if (created.debtPaymentId) await request(`/debt-payments/${created.debtPaymentId}`, { method: 'DELETE', headers });
        if (created.invoiceId) await request(`/invoices/${created.invoiceId}`, { method: 'DELETE', headers });
        if (created.productId) await request(`/products/${created.productId}`, { method: 'DELETE', headers });
        if (created.customerId) await request(`/customers/${created.customerId}`, { method: 'DELETE', headers });
    }
};

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});