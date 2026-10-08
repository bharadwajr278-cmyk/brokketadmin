module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const backend = process.env.BROKKET_API_BASE_URL;
  if (!backend) {
    return response.status(500).json({
      success: false,
      message: 'Dashboard API is not configured.',
    });
  }

  const { path: pathValue, ...query } = request.query;
  const pathParts = Array.isArray(pathValue) ? pathValue : [pathValue].filter(Boolean);
  if (!pathParts.length || pathParts.some((part) => part.includes('..'))) {
    return response.status(400).json({ success: false, message: 'Invalid API path' });
  }

  const target = new URL(`${backend.replace(/\/$/, '')}/${pathParts.map(encodeURIComponent).join('/')}`);
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) target.searchParams.append(key, String(item));
    }
  }

  const headers = { Accept: 'application/json' };
  if (process.env.BROKKET_API_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.BROKKET_API_BEARER_TOKEN}`;
  }
  if (process.env.BROKKET_API_KEY) {
    headers['x-api-key'] = process.env.BROKKET_API_KEY;
  }

  try {
    const upstream = await fetch(target, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    return response.status(upstream.status).send(body);
  } catch (error) {
    console.error('Backend request failed:', error.message);
    return response.status(502).json({
      success: false,
      message: 'The Brokket data service is temporarily unavailable.',
    });
  }
};
