const assert = require('node:assert/strict');
const { normalizeConfig } = require('../src/services/treatmentGroupService');
const { normalizeClosureSignature } = require('../src/utils/treatmentSignature');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M 10 20 L 50 60" stroke="black" fill="none"/></svg>';
assert.match(normalizeClosureSignature(svg), /viewBox="0 0 300 100"/);
assert.match(normalizeClosureSignature(svg), /<path/);
for (const value of [null, '', '<svg></svg>', svg.replace('<path', '<script'), svg.replace('stroke="black"', 'onclick="alert(1)"'), svg.replace('M 10 20 L 50 60', 'M 1 2 &evil;'), svg.replace('stroke="black"', 'stroke="url(http://evil)"'), 'x'.repeat(131073)]) {
    assert.throws(() => normalizeClosureSignature(value), e => e.status === 400);
}
assert.deepEqual(normalizeConfig({ total_sessions: null, children: [{ product_id: 1, total_sessions: 0 }, { product_id: 2, total_sessions: null }] }).children.map(c => c.total_sessions), [0, null]);
assert.deepEqual(normalizeConfig({ total_sessions: 1, children: [] }).children, []);
assert.equal(normalizeConfig({ total_sessions: null, children: [{ product_id: 1, total_sessions: 0 }] }).children[0].total_sessions, 0);
for (const config of [{}, { total_sessions: 0 },
    { total_sessions: 1, children: [{ product_id: 1, total_sessions: 1 }, { product_id: 1, total_sessions: 2 }] },
    { total_sessions: 1, children: [{ product_id: 1, total_sessions: -1 }] }, { total_sessions: 1, children: [{ product_id: 1, total_sessions: 2, price: 1 }] }]) {
    assert.throws(() => normalizeConfig(config), e => e.status === 400);
}
console.log('PASS: group counts/zero/lifetime, strict child payloads and narrow signature SVG validation.');