const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistrationTrend, normalizeMemberSummary } = require('../lib/member-summary');

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

test('builds an exact daily registration trend from CRM joining dates', () => {
  const result = buildRegistrationTrend([
    { joiningDate: '2026-11-05T09:10:00.000+05:30' },
    { joiningDate: '2026-11-05T23:59:59.000+05:30' },
    { joiningDate: '2026-11-06T00:00:01.000+05:30' },
  ], '2026-11-05', '2026-11-06', 'day');
  assert.deepEqual(result.trend, [
    { label: '2026-11-05', count: 2 },
    { label: '2026-11-06', count: 1 },
  ]);
  assert.equal(result.unbucketed, 0);
});

test('groups CRM registration records by month without estimating missing dates', () => {
  const result = buildRegistrationTrend([
    { joiningDate: '2026-10-31T23:59:59.000+05:30' },
    { joiningDate: '2026-11-01T00:00:01.000+05:30' },
    {},
  ], '2026-10-01', '2026-11-30', 'month');
  assert.deepEqual(result.trend, [
    { label: '2026-10', count: 1 },
    { label: '2026-11', count: 1 },
  ]);
  assert.equal(result.unbucketed, 1);
});
