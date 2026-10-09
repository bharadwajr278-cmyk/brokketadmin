const { createSession, getSession, sessionCookie } = require('../lib/auth');

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(String(body || '{}'));
  } catch {
    return {};
  }
}

function parseUpstream(text) {
  let value = text;
  for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value && typeof value === 'object' ? value : null;
}

function authenticationUrl() {
  if (process.env.BROKKET_AUTH_URL) return process.env.BROKKET_AUTH_URL;
  const dashboardBase = process.env.BROKKET_API_BASE_URL;
  if (!dashboardBase) return '';
  return new URL('/api/user/login-with-password', dashboardBase).toString();
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'GET') {
    const session = getSession(request);
    return response.status(200).json({
      authenticated: Boolean(session),
      user: session ? { id: session.userId, role: session.role } : null,
    });
  }

  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', sessionCookie('', 0));
    return response.status(200).json({ success: true });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
  const loginUrl = authenticationUrl();
  if (!loginUrl || !sessionSecret) {
    return response.status(500).json({ success: false, message: 'Dashboard authentication is not configured.' });
  }

  const body = parseBody(request.body);
  const phone = String(body.phone || body.number || '').replace(/\D/g, '');
  const countryCode = String(body.countryCode || '+91').trim();
  const password = String(body.password || '');
  if (!/^\d{7,15}$/.test(phone) || !/^\+\d{1,4}$/.test(countryCode) || !password) {
    return response.status(400).json({ success: false, message: 'Enter a valid phone number and password.' });
  }

  try {
    const upstream = await fetch(loginUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, countryCode, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const result = parseUpstream(await upstream.text());
    const authentication = result?.data;
    const allowedRoles = String(process.env.DASHBOARD_ALLOWED_ROLES || 'ADMIN')
      .split(',').map(role => role.trim().toUpperCase()).filter(Boolean);
    const role = String(authentication?.role || '').toUpperCase();
    const valid = upstream.ok && String(result?.code) === '1000' && authentication?.id &&
      authentication?.accessToken && allowedRoles.includes(role);

    if (!valid) {
      response.setHeader('Set-Cookie', sessionCookie('', 0));
      const unauthorizedRole = upstream.ok && authentication?.accessToken && !allowedRoles.includes(role);
      return response.status(401).json({
        success: false,
        message: unauthorizedRole ? 'This account is not authorized for the CEO dashboard.' : 'Invalid phone number or password.',
      });
    }

    const session = createSession(sessionSecret, {
      userId: String(authentication.id),
      role,
      accessToken: String(authentication.accessToken),
      refreshToken: authentication.refreshToken ? String(authentication.refreshToken) : undefined,
      accessTokenExpiry: authentication.accessTokenExpiry,
    });
    response.setHeader('Set-Cookie', sessionCookie(session));
    return response.status(200).json({
      success: true,
      user: { id: String(authentication.id), fullName: authentication.fullName || '', role },
    });
  } catch (error) {
    console.error('Authentication service request failed:', error.message);
    return response.status(502).json({ success: false, message: 'Authentication service is temporarily unavailable.' });
  }
};
