function unwrapPayload(payload) {
  let value = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return value; }
      continue;
    }
    if (value && typeof value === 'object' && value.data !== undefined) {
      value = value.data;
      continue;
    }
    break;
  }
  return value;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizePaymentSummary(summaryPayload, tabsPayload) {
  const summary = unwrapPayload(summaryPayload) || {};
  const tabs = unwrapPayload(tabsPayload) || {};
  const totals = summary.totals || summary.summary || summary;

  return {
    all: count(tabs.allCount ?? totals.allCount ?? totals.totalPayments),
    successful: count(tabs.successfulCount ?? totals.successfulCount ?? totals.successfulPayments),
    failed: count(tabs.failedCount ?? totals.failedCount ?? totals.failedPayments),
    timedOut: count(tabs.timedOutCount ?? totals.timedOutCount ?? totals.timedOutPayments),
    refunds: count(tabs.refundsCount ?? totals.refundsCount ?? totals.refundCount),
    customers: count(totals.payingCustomers ?? tabs.customersCount ?? tabs.payingCustomers),
    successfulAmount: count(tabs.successfulAmount ?? totals.grossRevenue ?? totals.successfulAmount),
    refundedAmount: count(tabs.refundedAmount ?? totals.refundedAmount ?? totals.refundAmount),
  };
}

module.exports = { normalizePaymentSummary, unwrapPayload };
