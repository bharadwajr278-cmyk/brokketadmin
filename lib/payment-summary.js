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

function normalizeSuccessfulPayments(payload) {
  const data = unwrapPayload(payload) || {};
  const rows = Array.isArray(data) ? data : (data.content || data.items || data.transactions || []);
  const content = rows.map(row => {
    const phone = String(row.phone || row.username || '').replace(/\D/g, '');
    return {
      fullName: String(row.fullName || row.name || row.username || 'Unnamed customer'),
      phoneLast4: phone.slice(-4),
      planName: String(row.planName || row.planCode || '—'),
      planCode: String(row.planCode || ''),
      billingType: String(row.billingType || row.subscriptionPlanType || '—'),
      amount: count(row.amount),
      occurredAt: row.occurredAt || row.paidAt || row.createdAt || null,
      renewal: Boolean(row.renewal),
    };
  });
  return { total: count(data.totalElements ?? data.total ?? content.length), content };
}

module.exports = { normalizePaymentSummary, normalizeSuccessfulPayments, unwrapPayload };
