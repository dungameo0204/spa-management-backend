const assert = require('node:assert/strict');
const { normalizeIds, validateGraph, check, acquire, release } = require('../src/services/productComponentService');
async function main() {
    for (const bad of [null, '[]', {}, [1, 1], ['1'], [0], [-1], [1.5], [true], [2147483648], Array.from({ length: 201 }, (_, i) => i + 1)]) {
        assert.throws(() => normalizeIds(bad), e => e.status === 400);
    }
    assert.deepEqual(normalizeIds([3, 1, 2]), [3, 1, 2]);
    assert.deepEqual(normalizeIds([]), []);
    const products = [1, 2, 3, 4].map(id => ({ id, is_product: 0, deleted_at: null }));
    const edge = (parent_product_id, child_product_id) => ({ parent_product_id, child_product_id, deleted_at: null });
    validateGraph(products, [edge(1, 2), edge(1, 3), edge(4, 2)]);
    for (const edges of [[edge(1, 1)], [edge(1, 2), edge(2, 1)], [edge(1, 2), edge(2, 3), edge(3, 1)]]) {
        assert.throws(() => validateGraph(products, edges), e => e.status === 400);
    }
    assert.throws(() => validateGraph(products, [edge(1, 99)]), /chưa bị xóa/);
    let rows = products.map(p => ({ ...p }));
    let edges = [edge(1, 2), edge(2, 3)];
    const connection = { query: async sql => [sql.includes('product_service_components') ? edges.map(e => ({ ...e })) : rows.map(p => ({ ...p }))] };
    await assert.rejects(check(connection, 'test', 3, { ids: [1] }), /vòng lặp/);
    await assert.rejects(check(connection, 'test', 2, { action: 'delete' }), /gói khác/);
    await assert.rejects(check(connection, 'test', 3, { isProduct: 1 }), /bán lẻ/);
    await check(connection, 'test', 1, { ids: [], isProduct: 1 });
    rows[0].deleted_at = '2026-01-01';
    rows[1].deleted_at = '2026-01-01';
    edges = [edge(1, 2)];
    await assert.rejects(check(connection, 'test', 1, { action: 'restore' }), /chưa bị xóa/);
    await assert.rejects(check(connection, 'test', 2, { isProduct: 1 }), /bán lẻ/);
    const calls = [];
    await acquire({ query: async (sql, params) => { calls.push({ sql, params }); return [[{ acquired: 1 }]]; } }, 'test');
    await release({ query: async (sql, params) => { calls.push({ sql, params }); } }, 'test');
    assert.equal(calls[0].params[0], calls[1].params[0]);
    await assert.rejects(acquire({ query: async () => [[{ acquired: 0 }]] }, 'test'), e => e.status === 409);
    console.log('PASS: strict child IDs, DAG/shared children, self/indirect cycles, type/delete/restore guards and graph lock scope.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });