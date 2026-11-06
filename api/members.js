const { getSession } = require('../lib/auth');
const { normalizeMemberSummary } = require('../lib/member-summary');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function membersUrl(fromDate, toDate, size = 1) {
  const base = process.env.BROKKET_API_BASE_URL;
  if (!base) return null;
  const url = new URL('/admin/companies/all/members', base);
  url.searchParams.set('search', '');
  url.searchParams.set('fromDate', `${fromDate}T00:00:00`);
  url.searchParams.set('toDate', `${toDate}T23:59:59`);
  url.searchParams.set('filterType', 'JOINED');
  url.searchParams.set('page', '0');
  url.searchParams.set('size', String(size));
  url.searchParams.set('registrationFilter', 'ALL');
  url.searchParams.set('onboardingCityCode', '');
  return url;
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
  if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate) {
    return response.status(400).json({ success: false, message: 'Invalid member date range.' });
  }
  const url = membersUrl(fromDate, toDate);
  if (!url) return response.status(500).json({ success: false, message: 'Member API is not configured.' });

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ACCESS_TOKEN: session.accessToken,
        USER_ID: session.userId,
        Cookie: `JSESSIONID=${session.backendSessionId}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => null);
    if (upstream.status === 401) {
      return response.status(401).json({ success: false, message: 'Your backend session expired. Please sign in again.' });
    }
    const code = payload?.code;
    if (!upstream.ok || (code !== undefined && !['200', '1000'].includes(String(code)))) {
      return response.status(upstream.status || 502).json({ success: false, message: payload?.message || `Member request failed (${upstream.status})` });
    }
    return response.status(200).json({ success: true, data: normalizeMemberSummary(payload) });
  } catch (error) {
    console.error('CRM member count request failed:', error.message);
    return response.status(502).json({ success: false, message: 'CRM member service is unavailable.' });
  }
};
