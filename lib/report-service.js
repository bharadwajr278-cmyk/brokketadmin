const { getSession } = require('./auth');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseJson(text) {
  let value = text;
  for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt += 1) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value && typeof value === 'object' ? value : null;
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 25000) });
      if (response.ok || response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`Upstream request failed (${response.status})`);
    } catch (error) { lastError = error; }
    if (attempt < attempts) await delay(400 * (2 ** (attempt - 1)));
  }
  throw lastError;
}

async function serviceLogin() {
  const loginUrl = process.env.BROKKET_AUTH_URL;
  const phone = String(process.env.BROKKET_REPORT_PHONE || '').replace(/\D/g, '');
  const password = process.env.BROKKET_REPORT_PASSWORD;
  if (!loginUrl || !phone || !password) throw new Error('Scheduled-report service credentials are not configured.');
  const response = await fetchWithRetry(loginUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, countryCode: process.env.BROKKET_REPORT_COUNTRY_CODE || '+91', password }),
    cache: 'no-store',
  });
  const body = parseJson(await response.text());
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const backendSessionId = cookies.map(cookie => /^JSESSIONID=([^;]+)/i.exec(cookie)?.[1]).find(Boolean);
  if (!response.ok || String(body?.code) !== '1000' || !body?.data?.accessToken || !body?.data?.id || !backendSessionId) {
    throw new Error('Scheduled-report service login failed.');
  }
  return { userId: String(body.data.id), accessToken: String(body.data.accessToken), backendSessionId };
}

async function reportingSession(request, scheduled = false) {
  const browserSession = !scheduled && request ? getSession(request) : null;
  if (browserSession) return browserSession;
  return serviceLogin();
}

function ceoUrl(route, params = {}) {
  const base = process.env.BROKKET_API_BASE_URL;
  if (!base) throw new Error('Brokket dashboard API is not configured.');
  const url = new URL(`${base.replace(/\/$/, '')}/${route.replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => value !== undefined && value !== '' && url.searchParams.set(key, String(value)));
  return url;
}

async function ceo(session, route, date, extra = {}) {
  const response = await fetchWithRetry(ceoUrl(route, { fromDate: date, toDate: date, ...extra }), {
    headers: {
      Accept: 'application/json', Authorization: `Bearer ${session.accessToken}`, 'x-user-id': session.userId,
      ...(process.env.BROKKET_API_KEY ? { 'x-api-key': process.env.BROKKET_API_KEY } : {}),
    }, cache: 'no-store',
  });
  const body = parseJson(await response.text());
  if (!response.ok || !body?.success) throw new Error(body?.message || `${route} failed (${response.status})`);
  return body.data;
}

async function propertyActivity(session, date) {
  const base = process.env.BROKKET_API_BASE_URL;
  const url = new URL('/admin/api/v1/property-listings/property-activities', base);
  url.searchParams.set('page', '0'); url.searchParams.set('size', '1');
  const response = await fetchWithRetry(url, {
    method: 'POST', cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ACCESS_TOKEN: session.accessToken, USER_ID: session.userId, Cookie: `JSESSIONID=${session.backendSessionId}` },
    body: JSON.stringify({ fromDate: `${date}T00:00:00`, toDate: `${date}T23:59:59` }),
  });
  const body = parseJson(await response.text());
  if (!response.ok || String(body?.code) !== '200' || !body?.data?.summary) throw new Error(body?.message || `Property activity failed (${response.status})`);
  const summary = body.data.summary, counts = summary.countByActionType || {};
  return { called: Number(counts.CALLED) || 0, whatsapped: Number(counts.WHATSAPPED) || 0, shared: Number(counts.SHARED) || 0, clicked: Number(counts.CLICKED) || 0, totalInteractions: Number(summary.totalInteractions) || 0, totalQueryCost: Number(summary.totalQueryCost) || 0 };
}

async function amplitude(date) {
  const key = process.env.AMPLITUDE_API_KEY, secret = process.env.AMPLITUDE_SECRET_KEY;
  if (!key || !secret) throw new Error('Amplitude analytics is not configured.');
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  const headers = { Accept: 'application/json', Authorization: auth };
  const compact = date.replaceAll('-', '');
  const usersUrl = new URL('https://amplitude.com/api/2/users');
  Object.entries({ m: 'active', i: '1', start: compact, end: compact }).forEach(([k, v]) => usersUrl.searchParams.set(k, v));
  const downloadsUrl = new URL('https://amplitude.com/api/2/segmentation');
  Object.entries({ e: JSON.stringify({ event_type: process.env.AMPLITUDE_INSTALL_EVENT || 'app_install_event' }), g: JSON.stringify({ type: 'user', value: process.env.AMPLITUDE_PLATFORM_PROPERTY || 'platform' }), m: 'uniques', i: '1', start: compact, end: compact }).forEach(([k, v]) => downloadsUrl.searchParams.set(k, v));
  const realtimeUrl = new URL('https://amplitude.com/api/2/realtime');
  const [usersResponse, downloadsResponse, realtimeResponse] = await Promise.all([
    fetchWithRetry(usersUrl, { headers, cache: 'no-store' }), fetchWithRetry(downloadsUrl, { headers, cache: 'no-store' }), fetchWithRetry(realtimeUrl, { headers, cache: 'no-store' }),
  ]);
  const [users, downloads, realtime] = await Promise.all([usersResponse.json().catch(() => null), downloadsResponse.json().catch(() => null), realtimeResponse.json().catch(() => null)]);
  if (!usersResponse.ok) throw new Error(`Amplitude DAU failed (${usersResponse.status})`);
  const dau = Number(users?.data?.series?.[0]?.[0]) || 0;
  const labels = downloads?.data?.seriesLabels || [], series = downloads?.data?.series || [];
  const platform = pattern => labels.reduce((sum, label, index) => pattern.test(String(label)) ? sum + (Number(series[index]?.[0]) || 0) : sum, 0);
  const android = downloadsResponse.ok ? platform(/android/i) : null;
  const ios = downloadsResponse.ok ? platform(/ios|iphone|ipad/i) : null;
  const totalDownloads = downloadsResponse.ok ? series.reduce((sum, values) => sum + (Number(values?.[0]) || 0), 0) : null;
  const liveData = realtimeResponse.ok ? realtime?.data : null;
  const liveValues = liveData?.series?.[0] || [];
  const liveUsers = [...liveValues].reverse().find(value => Number.isFinite(Number(value)));
  return { dau, liveUsers: liveUsers === undefined ? null : Number(liveUsers), totalDownloads, androidDownloads: android, iosDownloads: ios, downloadsAvailable: downloadsResponse.ok };
}

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10);
}

async function safe(name, work, errors) {
  try { return await work(); } catch (error) { errors.push({ section: name, message: error.message }); return null; }
}

async function collectDailyReport(session, date) {
  if (!DATE_PATTERN.test(date)) throw new Error('Invalid reporting date.');
  const errors = [];
  const routes = {
    overview: ['overview'], users: ['users/overview'], registrations: ['users/registrations-trend', { groupBy: 'day' }],
    logins: ['logins/overview'], loginTrend: ['logins/trend', { groupBy: 'day' }], listings: ['listings/overview'],
    listingTrend: ['listings/trend', { groupBy: 'day' }], contributors: ['listings/top-contributors', { limit: 20 }],
    likes: ['likes/overview'], likesTrend: ['likes/trend', { groupBy: 'day' }], subscriptions: ['subscriptions/overview'],
    revenueTrend: ['subscriptions/revenue-trend', { groupBy: 'day' }], roster: ['subscriptions/roster', { page: 0, size: 100 }],
    content: ['content/overview'], usersByCity: ['users/by-city'], loginsByCity: ['logins/by-city'], listingsByCity: ['listings/by-city'], likesByCity: ['likes/by-city'],
  };
  const entries = await Promise.all(Object.entries(routes).map(async ([name, [route, extra]]) => [name, await safe(name, () => ceo(session, route, date, extra), errors)]));
  const data = Object.fromEntries(entries);
  const types = await Promise.all(['Sale', 'Rent', 'Mandate', 'Requirement'].map(type => safe(`listings-${type}`, () => ceo(session, 'listings/overview', date, { transactionType: type }), errors)));
  data.listingTypes = Object.fromEntries(['Sale', 'Rent', 'Mandate', 'Requirement'].map((type, index) => [type, Number(types[index]?.newListingsInRange) || 0]));
  data.activity = await safe('property activity', () => propertyActivity(session, date), errors);
  data.amplitude = await safe('app analytics', () => amplitude(date), errors);
  data.errors = errors;
  return data;
}

async function collectComparison(session, date) {
  const errors = [];
  const [overview, logins, likes, subscriptions, content, activity, app] = await Promise.all([
    safe('previous overview', () => ceo(session, 'overview', date), errors), safe('previous logins', () => ceo(session, 'logins/overview', date), errors),
    safe('previous likes', () => ceo(session, 'likes/overview', date), errors), safe('previous subscriptions', () => ceo(session, 'subscriptions/overview', date), errors),
    safe('previous content', () => ceo(session, 'content/overview', date), errors), safe('previous property activity', () => propertyActivity(session, date), errors),
    safe('previous app analytics', () => amplitude(date), errors),
  ]);
  return { overview, logins, likes, subscriptions, content, activity, amplitude: app, errors };
}

async function buildReportDataset(session, date) {
  const priorDate = previousDate(date);
  const [current, previous] = await Promise.all([collectDailyReport(session, date), collectComparison(session, priorDate)]);
  return { reportDate: date, previousDate: priorDate, generatedAt: new Date().toISOString(), current, previous };
}

module.exports = { reportingSession, buildReportDataset, previousDate };
