const { getSession } = require('../lib/auth');
const { normalizeMemberSummary, registrationPeriods } = require('../lib/member-summary');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MAX_TREND_POINTS = 100;

function membersUrl(fromDate, toDate, cityCode = '') {
  const base = process.env.BROKKET_API_BASE_URL;
  if (!base) return null;
  const url = new URL('/admin/companies/all/members', base);
  url.searchParams.set('search', '');
  url.searchParams.set('fromDate', `${fromDate}T00:00:00`);
  url.searchParams.set('toDate', `${toDate}T23:59:59`);
  url.searchParams.set('filterType', 'JOINED');
  url.searchParams.set('page', '0');
  url.searchParams.set('size', '1');
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
  if (!membersUrl(fromDate, toDate, cityCode)) return response.status(500).json({ success: false, message: 'Member API is not configured.' });

  try {
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ACCESS_TOKEN: session.accessToken,
        USER_ID: session.userId,
        Cookie: `JSESSIONID=${session.backendSessionId}`,
    };
    async function fetchSummary(rangeFrom, rangeTo) {
      const upstream = await fetch(membersUrl(rangeFrom, rangeTo, cityCode), {
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
    const periods = registrationPeriods(fromDate, toDate, groupBy);
    if (periods.length > MAX_TREND_POINTS) throw Object.assign(new Error('Select Month view for date ranges longer than 100 days.'), { status: 400 });
    const [summary, points] = await Promise.all([
      fetchSummary(fromDate, toDate),
      runLimited(periods, 6, async period => {
        const point = await fetchSummary(period.fromDate, period.toDate);
        return { label: period.label, count: point.filteredMembers };
      }),
    ]);
    const trend = points;
    const trendTotal = trend.reduce((total, point) => total + point.count, 0);
    return response.status(200).json({
      success: true,
      data: {
        totalMembers: summary.totalMembers,
        filteredMembers: summary.filteredMembers,
        filteredProperties: summary.filteredProperties,
        trend,
        trendTotal,
        unbucketedMembers: 0,
        trendComplete: trendTotal === summary.filteredMembers,
        source: 'Brokket Mini CRM · Joined members',
      },
    });
  } catch (error) {
    console.error('CRM member count request failed:', error.message);
    return response.status(error.status || 502).json({ success: false, message: error.message || 'CRM member service is unavailable.' });
  }
};
