const { getSession } = require('../lib/auth');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAILY_POINTS = 7;

function activityUrl() {
  const dashboardBase = process.env.BROKKET_API_BASE_URL;
  if (!dashboardBase) return '';
  const url = new URL('/admin/api/v1/property-listings/property-activities', dashboardBase);
  url.searchParams.set('page', '0');
  url.searchParams.set('size', '1');
  return url;
}

function dateList(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];
  const all = [];
  for (let value = from; value <= to; value = new Date(value.getTime() + 86400000)) {
    all.push(value.toISOString().slice(0, 10));
  }
  return all;
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
  if (!session || !session.backendSessionId) {
    return response.status(401).json({ success: false, message: 'Please sign in again to load property activity.' });
  }
  const fromDate = String(request.query.fromDate || '');
  const toDate = String(request.query.toDate || '');
  const cityCode = String(request.query.cityCode || '').trim();
  if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || (cityCode && !/^[a-z0-9_-]{1,80}$/i.test(cityCode))) {
    return response.status(400).json({ success: false, message: 'Invalid property activity filters.' });
  }

  const url = activityUrl();
  if (!url) return response.status(500).json({ success: false, message: 'Property activity API is not configured.' });
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ACCESS_TOKEN: session.accessToken,
    USER_ID: session.userId,
    Cookie: `JSESSIONID=${session.backendSessionId}`,
  };
  const filter = (from, to) => ({
    fromDate: `${from}T00:00:00`,
    toDate: `${to}T23:59:59`,
    ...(cityCode ? { cityCode } : {}),
  });
  async function fetchSummary(body) {
    const upstream = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => null);
    if (upstream.status === 401) {
      const error = new Error('Your backend session expired. Please sign in again.');
      error.status = 401;
      throw error;
    }
    if (!upstream.ok || String(payload?.code) !== '200' || !payload?.data?.summary) {
      throw new Error(payload?.message || payload?.error || `Property activity request failed (${upstream.status})`);
    }
    return payload.data.summary;
  }

  try {
    const dates = dateList(fromDate, toDate);
    if (!dates.length) return response.status(400).json({ success: false, message: 'Invalid property activity date range.' });
    const trendDates = dates.slice(-MAX_DAILY_POINTS);
    const [summary, dailyCosts] = await Promise.all([
      fetchSummary(filter(fromDate, toDate)),
      runLimited(trendDates, 4, async date => {
        try {
          const day = await fetchSummary(filter(date, date));
          return { label: date, amount: Number(day.totalQueryCost) || 0, interactions: Number(day.totalInteractions) || 0 };
        } catch (error) {
          if (error.status === 401) throw error;
          return { label: date, amount: null, interactions: null };
        }
      }),
    ]);
    const counts = summary.countByActionType || {};
    return response.status(200).json({
      success: true,
      data: {
        called: Number(counts.CALLED) || 0,
        whatsapped: Number(counts.WHATSAPPED) || 0,
        shared: Number(counts.SHARED) || 0,
        clicked: Number(counts.CLICKED) || 0,
        totalInteractions: Number(summary.totalInteractions) || 0,
        totalQueryCost: Number(summary.totalQueryCost) || 0,
        dailyCosts: dailyCosts.filter(point => point.amount !== null),
        dailyCostIncomplete: dailyCosts.some(point => point.amount === null),
        trendLimited: dates.length > MAX_DAILY_POINTS,
        trendDays: MAX_DAILY_POINTS,
        trendFromDate: trendDates[0],
      },
    });
  } catch (error) {
    console.error('Property activity request failed:', error.message);
    return response.status(error.status || 502).json({ success: false, message: error.message || 'Property activity service is unavailable.' });
  }
};
