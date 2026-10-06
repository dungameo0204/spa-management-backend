
const jwt = require('jsonwebtoken');
require('dotenv').config();
const SECRET = process.env.JWT_SECRET;
const token = jwt.sign({
    id: 2,
    tenant_id: 1,
    username: 'xulyhihi',
    fullname: 'Admin Test',
    branch_id: 1,
    system_role: 'MANAGER'
}, SECRET, { expiresIn: '15h' });

async function runTests() {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };

    console.log('--- BẮT ĐẦU TEST FLOW INVOICE & TREATMENT ---');

    console.log('\n[1] Tạo Hóa đơn mới...');
    let res = await fetch('http://localhost:5000/api/invoices', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            customer_id: 1,
            branch_id: 1,
            discount_percent: 0,
            discount_amount: 0,
            paid_amount: 500000,
            wallet_used: 0,
            payment_method: 'Tiền mặt',
            note: 'Test create invoice',
            items: [
                {
                    product_id: 1,
                    quantity: 1,
                    discount_percent: 0,
                    discount_amount: 0,
                    consultants: []
                }
            ]
        })
    });
    let data = await res.json();
    console.log('Kết quả POST /api/invoices:', data);
    const invoiceId = data.invoiceId;

    if (!invoiceId) throw new Error('Không tạo được Invoice!');

    console.log('\n[2] Lấy thẻ liệu trình của khách hàng...');
    res = await fetch('http://localhost:5000/api/treatments?customerId=1', { headers });
    data = await res.json();
    console.log('Kết quả GET /api/treatments:', data);
    
    const treatment = data.data.find(t => t.invoice_id === invoiceId);
    if (!treatment) throw new Error('Không tìm thấy thẻ liệu trình tự sinh!');
    console.log('=> Treatment ID là:', treatment.id);

    console.log('\n[3] Bấm thực hiện (trừ 1 buổi) liệu trình...');
    res = await fetch('http://localhost:5000/api/treatments/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            treatment_id: treatment.id,
            branch_id: 1,
            staffs: [
                { staff_id: 1, commission_amount: 50000 }
            ]
        })
    });
    data = await res.json();
    console.log('Kết quả POST /api/treatments/execute:', data);

    console.log('\n[4] Lấy chi tiết thẻ liệu trình...');
    res = await fetch('http://localhost:5000/api/treatments/' + treatment.id, { headers });
    data = await res.json();
    console.log('Số buổi còn lại:', data.data.remaining_sessions);
    console.log('Lịch sử thực hiện:', data.data.histories.map(h => ({ id: h.id, staffs: h.staffs })));
    
    const historyId = data.data.histories[0].id;

    console.log('\n[5] Thử xóa Hóa đơn (Chặn do đã dùng liệu trình)...');
    res = await fetch('http://localhost:5000/api/invoices/' + invoiceId, {
        method: 'DELETE',
        headers
    });
    data = await res.json();
    console.log('Kết quả DELETE /api/invoices/' + invoiceId + ':', res.status, data);

    console.log('\n[6] Hoàn tác trừ buổi liệu trình...');
    res = await fetch('http://localhost:5000/api/treatments/execute/' + historyId, {
        method: 'DELETE',
        headers
    });
    data = await res.json();
    console.log('Kết quả DELETE /api/treatments/execute/' + historyId + ':', data);

    console.log('\n[7] Thử xóa lại Hóa đơn...');
    res = await fetch('http://localhost:5000/api/invoices/' + invoiceId, {
        method: 'DELETE',
        headers
    });
    data = await res.json();
    console.log('Kết quả DELETE /api/invoices/' + invoiceId + ':', res.status, data);

    console.log('\n--- KẾT THÚC TEST FLOW ---');
}

runTests().catch(console.error);

