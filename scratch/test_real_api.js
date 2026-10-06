async function runTests() {
    let res, data;
    console.log('--- BƯỚC 1: ĐĂNG NHẬP ---');
    res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '3thang10', password: '123' })
    });
    data = await res.json();
    if (!data.data || !data.data.token) {
        console.error('Đăng nhập thất bại:', data);
        return;
    }
    const token = data.data.token;
    console.log('=> Đăng nhập thành công, nhận JWT Token.');

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };

    console.log('\n--- BƯỚC 2: TẠO DỮ LIỆU MẪU ---');
    let randomStr = Math.random().toString(36).substring(7);

    res = await fetch('http://localhost:5000/api/branches', {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Chi nhánh ' + randomStr, address: '123 VIP', phone: '0900000000' })
    });
    data = await res.json();
    console.log('Tạo Branch response:', data);
    const branchId = data.branchId || data.insertId || data.id || 3; 

    res = await fetch('http://localhost:5000/api/roles', {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Kỹ Thuật Viên ' + randomStr })
    });
    data = await res.json();
    console.log('Tạo Role response:', data);
    const roleId = data.roleId || data.insertId || data.id || 3;

    res = await fetch('http://localhost:5000/api/staffs', {
        method: 'POST', headers,
        body: JSON.stringify({ fullname: 'Nhân viên ' + randomStr, phone_number: '0987654321', branch_id: branchId, role_id: roleId })
    });
    data = await res.json();
    console.log('Tạo Staff response:', data);
    const staffId = data.staffId || data.insertId || data.id || data.data?.id;

    res = await fetch('http://localhost:5000/api/customers', {
        method: 'POST', headers,
        body: JSON.stringify({ fullname: 'Khách hàng ' + randomStr, phone_number: Math.floor(Math.random()*1000000000).toString() })
    });
    data = await res.json();
    console.log('Tạo Customer response:', data);
    const customerId = data.customerId || data.insertId || data.id || data.data?.id;

    res = await fetch('http://localhost:5000/api/products', {
        method: 'POST', headers,
        body: JSON.stringify({ 
            name: 'Massage ' + randomStr, 
            price: 500000, 
            is_product: 0, 
            is_treatment_combo: 1, 
            default_sessions: 10 
        })
    });
    data = await res.json();
    console.log('Tạo Product response:', data);
    const productId = data.productId || data.insertId || data.id || data.data?.id;

    console.log('\n--- BƯỚC 3: TEST FLOW INVOICE & TREATMENT ---');

    console.log('[+] Tạo Hóa đơn mới...');
    res = await fetch('http://localhost:5000/api/invoices', {
        method: 'POST', headers,
        body: JSON.stringify({
            customer_id: customerId,
            branch_id: branchId,
            discount_percent: 0,
            discount_amount: 0,
            paid_amount: 500000,
            wallet_used: 0,
            payment_method: 'Tiền mặt',
            note: 'Test create invoice real api',
            items: [
                {
                    product_id: productId,
                    quantity: 1,
                    discount_percent: 0,
                    discount_amount: 0,
                    consultants: []
                }
            ]
        })
    });
    data = await res.json();
    console.log('Kết quả POST /api/invoices:', data);
    const invoiceId = data.invoiceId;
    if (!invoiceId) return;

    res = await fetch('http://localhost:5000/api/treatments?customerId=' + customerId, { headers });
    data = await res.json();
    const treatment = data.data.find(t => t.invoice_id === invoiceId);
    if (!treatment) return;
    console.log('=> Thẻ liệu trình tự sinh ID là:', treatment.id);

    console.log('\n[+] Thực hiện trừ 1 buổi liệu trình...');
    res = await fetch('http://localhost:5000/api/treatments/execute', {
        method: 'POST', headers,
        body: JSON.stringify({
            treatment_id: treatment.id,
            branch_id: branchId,
            staffs: [{ staff_id: staffId, commission_amount: 50000 }]
        })
    });
    data = await res.json();
    console.log('Kết quả POST /api/treatments/execute:', data);
    
    if (res.status !== 201 && res.status !== 200) return;

    res = await fetch('http://localhost:5000/api/treatments/' + treatment.id, { headers });
    data = await res.json();
    console.log('Số buổi còn lại:', data.data.remaining_sessions);
    
    const historyId = data.data.histories[0].id;

    console.log('\n[+] Thử xóa Hóa đơn (Chặn)...');
    res = await fetch('http://localhost:5000/api/invoices/' + invoiceId, { method: 'DELETE', headers });
    data = await res.json();
    console.log('Kết quả DELETE /api/invoices/' + invoiceId + ':', res.status, data.message);

    console.log('\n[+] Hoàn tác trừ buổi liệu trình...');
    res = await fetch('http://localhost:5000/api/treatments/execute/' + historyId, { method: 'DELETE', headers });
    data = await res.json();
    console.log('Kết quả DELETE /api/treatments/execute/' + historyId + ':', data.message);

    console.log('\n[+] Thử xóa lại Hóa đơn...');
    res = await fetch('http://localhost:5000/api/invoices/' + invoiceId, { method: 'DELETE', headers });
    data = await res.json();
    console.log('Kết quả DELETE /api/invoices/' + invoiceId + ':', res.status, data.message);

    console.log('\n--- KẾT THÚC TEST ---');
}

runTests().catch(console.error);
