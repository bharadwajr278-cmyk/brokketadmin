const { getSession } = require('../lib/auth');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function amplitudeDate(value) {
  return value.replaceAll('-', '');
}

function points(labels = [], values = []) {
  return labels.map((label, index) => ({ label, count: Number(values[index]) || 0 }));
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, message: 'Method not allowed' });
  }
  if (!getSession(request)) return response.status(401).json({ success: false, message: 'Authentication required.' });

  const fromDate = String(request.query.fromDate || '');
  const toDate = String(request.query.toDate || '');
  if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate) {
    return response.status(400).json({ success: false, message: 'Invalid Amplitude date range.' });
  }
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return response.status(503).json({ success: false, message: 'Amplitude analytics is not configured.' });
  }

  const authorization = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
  const common = { start: amplitudeDate(fromDate), end: amplitudeDate(toDate), i: '1' };
  const usersUrl = new URL('https://amplitude.com/api/2/users');
  Object.entries({ ...common, m: 'active' }).forEach(([key, value]) => usersUrl.searchParams.set(key, value));
  const realtimeUrl = new URL('https://amplitude.com/api/2/realtime');
  const downloadsUrl = new URL('https://amplitude.com/api/2/segmentation');
  Object.entries({
    ...common,
    e: JSON.stringify({ event_type: process.env.AMPLITUDE_INSTALL_EVENT || 'app_install_event' }),
    g: JSON.stringify({ type: 'user', value: process.env.AMPLITUDE_PLATFORM_PROPERTY || 'platform' }),
    m: 'uniques',
  }).forEach(([key, value]) => downloadsUrl.searchParams.set(key, value));

  try {
    const headers = { Accept: 'application/json', Authorization: authorization };
    const [usersResponse, downloadsResponse, realtimeResponse] = await Promise.all([
      fetch(usersUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) }),
      fetch(downloadsUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) }),
      fetch(realtimeUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) }),
    ]);
    const [usersPayload, downloadsPayload, realtimePayload] = await Promise.all([
      usersResponse.json().catch(() => null), downloadsResponse.json().catch(() => null),
      realtimeResponse.json().catch(() => null),
    ]);
    if (!usersResponse.ok) {
      console.warn(`Amplitude upstream status: users=${usersResponse.status}, downloads=${downloadsResponse.status}`);
      const status = usersResponse.status === 429 ? 429 : 502;
      const message = status === 429 ? 'Amplitude rate limit reached. Try again shortly.' :
        usersResponse.status === 401 ? 'Amplitude credentials were rejected.' :
        `Amplitude users API request failed (${usersResponse.status}).`;
      return response.status(status).json({ success: false, message });
    }

    const userData = usersPayload?.data || {};
    const dau = points(userData.xValues || [], userData.series?.[0] || []);
    const downloadsAvailable = downloadsResponse.ok;
    if (!downloadsAvailable) console.warn(`Amplitude downloads unavailable: status=${downloadsResponse.status}`);
    const downloadData = downloadsAvailable ? (downloadsPayload?.data || {}) : {};
    const dates = downloadData.xValues || [];
    const labels = downloadData.seriesLabels || [];
    const series = downloadData.series || [];
    const platformSeries = labels.map((label, index) => ({ label: String(label || `Series ${index + 1}`), values: series[index] || [] }));
    const matching = pattern => platformSeries.filter(item => pattern.test(item.label)).reduce((values, item) =>
      dates.map((_, index) => (values[index] || 0) + (Number(item.values[index]) || 0)), []);
    const androidValues = matching(/android/i);
    const iosValues = matching(/ios|iphone|ipad/i);
    const allValues = dates.map((_, index) => platformSeries.reduce((total, item) => total + (Number(item.values[index]) || 0), 0));
    const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);
    const dauValues = dau.map(item => item.count);
    const realtimeData = realtimeResponse.ok ? (realtimePayload?.data || {}) : {};
    const todayIndex = (realtimeData.seriesLabels || []).findIndex(label => /today/i.test(String(label)));
    const todaySeries = realtimeData.series?.[todayIndex >= 0 ? todayIndex : 0] || [];
    const currentRealtimeIndex = todaySeries.findIndex(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
    const liveUsersAvailable = realtimeResponse.ok && currentRealtimeIndex >= 0;
    const liveUsers = liveUsersAvailable ? Number(todaySeries[currentRealtimeIndex]) : null;
    const liveUsersAsOf = liveUsersAvailable ? (realtimeData.xValues?.[currentRealtimeIndex] || '') : '';
    if (!realtimeResponse.ok) console.warn(`Amplitude realtime unavailable: status=${realtimeResponse.status}`);
    return response.status(200).json({
      success: true,
      data: {
        dau,
        liveUsers,
        liveUsersAsOf,
        liveUsersAvailable,
        liveUsersMessage: liveUsersAvailable ? '' : `Amplitude real-time users are unavailable (${realtimeResponse.status}).`,
        latestDau: dauValues.at(-1) || 0,
        averageDau: dauValues.length ? Math.round(sum(dauValues) / dauValues.length) : 0,
        peakDau: Math.max(0, ...dauValues),
        downloads: points(dates, allValues),
        android: points(dates, androidValues),
        ios: points(dates, iosValues),
        totalDownloads: downloadsAvailable ? sum(allValues) : null,
        androidDownloads: downloadsAvailable ? sum(androidValues) : null,
        iosDownloads: downloadsAvailable ? sum(iosValues) : null,
        otherDownloads: downloadsAvailable ? Math.max(0, sum(allValues) - sum(androidValues) - sum(iosValues)) : null,
        downloadsAvailable,
        downloadsMessage: downloadsAvailable ? '' :
          `Amplitude event “${process.env.AMPLITUDE_INSTALL_EVENT || 'app_install_event'}” is unavailable (${downloadsResponse.status}).`,
      },
    });
  } catch (error) {
    console.error('Amplitude request failed:', error.message);
    return response.status(502).json({ success: false, message: 'Amplitude analytics is temporarily unavailable.' });
  }
};
