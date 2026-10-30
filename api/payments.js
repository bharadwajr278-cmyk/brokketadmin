const { getSession } = require('../lib/auth');
const { normalizePaymentSummary, unwrapPayload } = require('../lib/payment-summary');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function paymentUrl(path, fromDate, toDate) {
  const base = process.env.BROKKET_API_BASE_URL;
  if (!base) return null;
  const url = new URL(`/admin/api/v1/payments${path}`, base);
  if (fromDate) url.searchParams.set('from', fromDate);
  if (toDate) {
    // The payments service treats `to` as an exclusive midnight boundary.
    // Advance it one day so the dashboard's inclusive end date includes all
    // payments made during that date (especially today's transactions).
    const exclusiveTo = new Date(`${toDate}T00:00:00Z`);
    exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
    url.searchParams.set('to', exclusiveTo.toISOString().slice(0, 10));
  }
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
    return response.status(401).json({ success: false, message: 'Please sign in again to load CRM payment counts.' });
  }

  const fromDate = String(request.query.fromDate || '');
  const toDate = String(request.query.toDate || '');
  if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate) {
    return response.status(400).json({ success: false, message: 'Invalid payment date range.' });
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ACCESS_TOKEN: session.accessToken,
    USER_ID: session.userId,
    Cookie: `JSESSIONID=${session.backendSessionId}`,
  };

  async function fetchPaymentData(path) {
    const url = paymentUrl(path, fromDate, toDate);
    if (!url) throw Object.assign(new Error('Payment API is not configured.'), { status: 500 });
    const upstream = await fetch(url, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => null);
    if (upstream.status === 401) {
      throw Object.assign(new Error('Your backend session expired. Please sign in again.'), { status: 401 });
    }
    const code = payload?.code;
    if (!upstream.ok || (code !== undefined && !['200', '1000'].includes(String(code)))) {
      throw Object.assign(new Error(payload?.message || `Payment request failed (${upstream.status})`), { status: upstream.status || 502 });
    }
    return unwrapPayload(payload);
  }

  try {
    const [summary, tabs] = await Promise.all([
      fetchPaymentData('/summary'),
      fetchPaymentData('/transactions/tabs'),
    ]);
    return response.status(200).json({ success: true, data: normalizePaymentSummary(summary, tabs) });
  } catch (error) {
    console.error('Payment summary request failed:', error.message);
    return response.status(error.status || 502).json({ success: false, message: error.message || 'Payment service is unavailable.' });
  }
};
