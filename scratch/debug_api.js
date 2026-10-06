const jwt = require('jsonwebtoken');
require('dotenv').config();

async function check() {
    let res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '3thang10', password: '123' })
    });
    let data = await res.json();
    const token = data.data.token;

    res = await fetch('http://localhost:5000/api/treatments/8', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    data = await res.json();
    console.log(data);
}
check();
