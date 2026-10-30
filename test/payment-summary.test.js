const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePaymentSummary, unwrapPayload } = require('../lib/payment-summary');

test('normalizes the same payment counts shown by Brokket CRM', () => {
  const result = normalizePaymentSummary(
    { data: { totals: { payingCustomers: 27, grossRevenue: 11081 } } },
    { data: { allCount: 29, successfulCount: 27, successfulAmount: 11081, failedCount: 2, timedOutCount: 0, refundsCount: 0 } },
  );
  assert.deepEqual(result, {
    all: 29, successful: 27, failed: 2, timedOut: 0, refunds: 0,
    customers: 27, successfulAmount: 11081, refundedAmount: 0,
  });
});

test('unwraps nested and string API payloads without inventing counts', () => {
  assert.deepEqual(unwrapPayload({ data: JSON.stringify({ data: { allCount: 3 } }) }), { allCount: 3 });
  assert.equal(normalizePaymentSummary({}, {}).successful, 0);
});
