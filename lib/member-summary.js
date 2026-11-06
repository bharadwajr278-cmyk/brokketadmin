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

module.exports = { normalizeMemberSummary, unwrapMemberPayload };
