const { getSession } = require('../lib/auth');
const { buildRegistrationTrend, normalizeMemberSummary } = require('../lib/member-summary');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

function membersUrl(fromDate, toDate, page = 0, cityCode = '') {
  const base = process.env.BROKKET_API_BASE_URL;
  if (!base) return null;
  const url = new URL('/admin/companies/all/members', base);
  url.searchParams.set('search', '');
  url.searchParams.set('fromDate', `${fromDate}T00:00:00`);
  url.searchParams.set('toDate', `${toDate}T23:59:59`);
  url.searchParams.set('filterType', 'JOINED');
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('registrationFilter', 'ALL');
  url.searchParams.set('onboardingCityCode', cityCode);
  return url;
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const session = getSession(request);
  if (!session?.backendSessionId) {
    return response.status(401).json({ success: false, message: 'Please sign in again to load CRM member counts.' });
  }
  const fromDate = String(request.query.fromDate || '');
  const toDate = String(request.query.toDate || '');
  const groupBy = String(request.query.groupBy || 'day');
  const cityCode = String(request.query.cityCode || '').trim();
  if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate ||
      !['day', 'month'].includes(groupBy) || (cityCode && !/^[a-z0-9_-]{1,80}$/i.test(cityCode))) {
    return response.status(400).json({ success: false, message: 'Invalid member date range.' });
  }
  if (!membersUrl(fromDate, toDate, 0, cityCode)) return response.status(500).json({ success: false, message: 'Member API is not configured.' });

  try {
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ACCESS_TOKEN: session.accessToken,
        USER_ID: session.userId,
        Cookie: `JSESSIONID=${session.backendSessionId}`,
    };
    async function fetchPage(page) {
      const upstream = await fetch(membersUrl(fromDate, toDate, page, cityCode), {
        headers, cache: 'no-store', signal: AbortSignal.timeout(20000),
      });
      const payload = await upstream.json().catch(() => null);
      if (upstream.status === 401) throw Object.assign(new Error('Your backend session expired. Please sign in again.'), { status: 401 });
      const code = payload?.code;
      if (!upstream.ok || (code !== undefined && !['200', '1000'].includes(String(code)))) {
        throw Object.assign(new Error(payload?.message || `Member request failed (${upstream.status})`), { status: upstream.status || 502 });
      }
      return normalizeMemberSummary(payload);
    }
    const first = await fetchPage(0);
    if (first.totalPages > MAX_PAGES) throw new Error('CRM member result is too large to reconcile safely. Narrow the date range.');
    const remaining = await runLimited(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => index + 1), 4, fetchPage);
    const members = [first, ...remaining].flatMap(page => page.members);
    const { trend, unbucketed } = buildRegistrationTrend(members, fromDate, toDate, groupBy);
    const trendTotal = trend.reduce((total, point) => total + point.count, 0);
    return response.status(200).json({
      success: true,
      data: {
        totalMembers: first.totalMembers,
        filteredMembers: first.filteredMembers,
        filteredProperties: first.filteredProperties,
        trend,
        trendTotal,
        unbucketedMembers: unbucketed,
        trendComplete: trendTotal === first.filteredMembers && unbucketed === 0 && members.length === first.filteredMembers,
        source: 'Brokket Mini CRM · Joined members',
      },
    });
  } catch (error) {
    console.error('CRM member count request failed:', error.message);
    return response.status(error.status || 502).json({ success: false, message: error.message || 'CRM member service is unavailable.' });
  }
};
