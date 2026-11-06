function unwrapMemberPayload(payload) {
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

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeMemberSummary(payload) {
  const data = unwrapMemberPayload(payload) || {};
  const members = Array.isArray(data.members)
    ? data.members
    : Array.isArray(data.content) ? data.content : [];
  return {
    totalMembers: nonNegative(data.totalMembers),
    filteredMembers: nonNegative(data.activeMembers ?? data.filteredMembers ?? data.totalElements),
    totalProperties: nonNegative(data.totalProperties),
    filteredProperties: nonNegative(data.filteredProperties),
    totalAppUsage: nonNegative(data.totalAppUsage),
    filteredAppUsage: nonNegative(data.filteredAppUsage),
    totalPages: nonNegative(data.totalPages),
    hasNext: Boolean(data.hasNext),
    members,
  };
}

function registrationBuckets(fromDate, toDate, groupBy = 'day') {
  const buckets = [];
  if (groupBy === 'month') {
    const cursor = new Date(`${fromDate.slice(0, 7)}-01T00:00:00Z`);
    const end = new Date(`${toDate.slice(0, 7)}-01T00:00:00Z`);
    while (cursor <= end) {
      buckets.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return buckets;
  }
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    buckets.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function buildRegistrationTrend(members, fromDate, toDate, groupBy = 'day') {
  const labels = registrationBuckets(fromDate, toDate, groupBy);
  const counts = Object.fromEntries(labels.map(label => [label, 0]));
  let unbucketed = 0;
  for (const member of members || []) {
    const joined = String(member?.joiningDate || '');
    const label = groupBy === 'month' ? joined.slice(0, 7) : joined.slice(0, 10);
    if (Object.hasOwn(counts, label)) counts[label] += 1;
    else unbucketed += 1;
  }
  return { trend: labels.map(label => ({ label, count: counts[label] })), unbucketed };
}

module.exports = { buildRegistrationTrend, normalizeMemberSummary, registrationBuckets, unwrapMemberPayload };
