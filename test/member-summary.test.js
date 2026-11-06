const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMemberSummary } = require('../lib/member-summary');

test('normalizes the Mini CRM filtered member count', () => {
  const result = normalizeMemberSummary({
    code: '200',
    data: {
      totalMembers: 14773,
      activeMembers: 304,
      totalProperties: 10453,
      filteredProperties: 31,
      members: [{ id: 1 }],
    },
  });
  assert.equal(result.totalMembers, 14773);
  assert.equal(result.filteredMembers, 304);
  assert.equal(result.filteredProperties, 31);
  assert.equal(result.members.length, 1);
});

test('does not turn missing member counts into NaN', () => {
  const result = normalizeMemberSummary({ data: {} });
  assert.equal(result.filteredMembers, 0);
  assert.equal(result.totalMembers, 0);
  assert.deepEqual(result.members, []);
});
