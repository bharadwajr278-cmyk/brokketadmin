const crypto = require('node:crypto');

const COOKIE_NAME = 'brokket_session';
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left = '', right = '') {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function createSession(secret, authentication = {}) {
  const tokenExpiry = Date.parse(authentication.accessTokenExpiry || '');
  const maximumExpiry = Date.now() + SESSION_SECONDS * 1000;
  const exp = Number.isFinite(tokenExpiry) ? Math.min(tokenExpiry, maximumExpiry) : maximumExpiry;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    exp,
    userId: authentication.userId,
    role: authentication.role,
    accessToken: authentication.accessToken,
    refreshToken: authentication.refreshToken,
  }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(value => value.toString('base64url')).join('.');
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function getSession(request) {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  const token = readCookie(request, COOKIE_NAME);
  if (!secret || !token) return null;
  const [ivValue, tagValue, encryptedValue] = token.split('.');
  if (!ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]);
    const session = JSON.parse(plaintext.toString('utf8'));
    if (session.v !== 1 || Number(session.exp) <= Date.now() || !session.userId || !session.accessToken) return null;
    return session;
  } catch {
    return null;
  }
}

function isAuthenticated(request) {
  return Boolean(getSession(request));
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

module.exports = { createSession, getSession, isAuthenticated, safeEqual, sessionCookie };
