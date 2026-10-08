const crypto = require('node:crypto');

const COOKIE_NAME = 'brokket_session';
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left = '', right = '') {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSession(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function isAuthenticated(request) {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  const token = readCookie(request, COOKIE_NAME);
  if (!secret || !token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

module.exports = { createSession, isAuthenticated, safeEqual, sessionCookie };
