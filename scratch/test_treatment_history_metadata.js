const assert = require('node:assert/strict');
const { normalizeSessionMetadata } = require('../src/utils/treatmentHistory');
const svg = '<svg width="300" height="100"><path d="M 10 20 L 50 60"/></svg>';
assert.deepEqual(normalizeSessionMetadata({}), { note: null, signature: null });
assert.deepEqual(normalizeSessionMetadata({ note: ' \n ', customer_signature_svg: null }), { note: null, signature: null });
assert.equal(normalizeSessionMetadata({ note: '  Ghi chú mỗi buổi\nDa hơi đỏ  ' }).note, 'Ghi chú mỗi buổi\nDa hơi đỏ');
assert.match(normalizeSessionMetadata({ customer_signature_svg: svg }).signature, /viewBox="0 0 300 100"/);
assert.equal(normalizeSessionMetadata({ note: 'a'.repeat(65535) }).note.length, 65535);
for (const data of [null, [], { note: false }, { note: {} }, { note: 123 }, { note: 'a'.repeat(65536) }, { note: 'đ'.repeat(32768) },
    { customer_signature_svg: '' }, { customer_signature_svg: {} }, { customer_signature_svg: '<svg onload="evil()"></svg>' },
    { customer_signed_at: null }, { customer_signed_at: '2000-01-01' }]) {
    assert.throws(() => normalizeSessionMetadata(data), error => error.status === 400);
}
console.log('PASS: session note UTF-8 limits, normalization, optional/safe SVG and server-owned signing time.');