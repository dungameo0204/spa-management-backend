const assert = require('node:assert/strict');
const { normalizeContactContent, appendContactEntry, assertExtraNoteNotProvided } = require('../src/utils/appointmentContactNote');
assert.equal(normalizeContactContent({ content: ' Tiếng Việt\r\nDòng hai\rDòng ba ' }), 'Tiếng Việt\nDòng hai\nDòng ba');
for (const content of [null, undefined, 1, {}, '', ' \n', '\0', 'ế'.repeat(3334)]) {
    assert.throws(() => normalizeContactContent({ content }));
}
assert.deepEqual(appendContactEntry(null, '28/10/2026', 'Lần 1'), { entry: '28/10/2026: Lần 1', extra_note: '28/10/2026: Lần 1' });
assert.equal(appendContactEntry('Cũ', '28/10/2026', 'Mới').extra_note, 'Cũ\n28/10/2026: Mới');
assert.throws(() => appendContactEntry('x'.repeat(65530), '28/10/2026', 'Mới'));
for (const extra_note of [null, '', 'Overwrite']) assert.throws(() => assertExtraNoteNotProvided({ extra_note }));
assertExtraNoteNotProvided({ note: 'Unchanged' });
assert.throws(() => assertExtraNoteNotProvided({ contact_notes: [] }));
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {} };
const { formatNotes } = require('../src/services/appointmentContactNoteService');
assert.equal(formatNotes([]), null);
assert.equal(formatNotes([{ contact_date: null, content: 'Legacy\nUnchanged' }, { contact_date: '28/10/2026', content: 'Mới\nDòng hai' }]), 'Legacy\nUnchanged\n28/10/2026: Mới\nDòng hai');
assert.throws(() => formatNotes([{ contact_date: null, content: 'ế'.repeat(21846) }]));
console.log('PASS: contact content validation, UTF-8 limits, multiline and append-only guards.');