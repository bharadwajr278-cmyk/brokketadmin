const { createSession, isAuthenticated, safeEqual, sessionCookie } = require('../lib/auth');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'GET') {
    return response.status(200).json({ authenticated: isAuthenticated(request) });
  }

  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', sessionCookie('', 0));
    return response.status(200).json({ success: true });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const expectedNumber = process.env.DASHBOARD_LOGIN_NUMBER;
  const expectedPassword = process.env.DASHBOARD_LOGIN_PASSWORD;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
  if (!expectedNumber || !expectedPassword || !sessionSecret) {
    return response.status(500).json({ success: false, message: 'Dashboard login is not configured.' });
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
  const number = String(body.number || '').replace(/\D/g, '');
  const valid = safeEqual(number, String(expectedNumber).replace(/\D/g, '')) &&
    safeEqual(String(body.password || ''), expectedPassword);

  if (!valid) {
    return response.status(401).json({ success: false, message: 'Invalid number or password.' });
  }

  response.setHeader('Set-Cookie', sessionCookie(createSession(sessionSecret)));
  return response.status(200).json({ success: true });
};
