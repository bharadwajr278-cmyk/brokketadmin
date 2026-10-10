const crypto = require('node:crypto');
const store = require('../lib/report-store');
const { runDailyReport } = require('../lib/report-runner');

function safeEqual(left = '', right = '') { const a = Buffer.from(String(left)), b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function currentIstDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(secret, supplied)) return response.status(401).json({ success: false, message: 'Unauthorized scheduler request.' });
  if (request.method === 'POST') {
    const input = request.body && typeof request.body === 'object' ? request.body : {};
    if (input.action !== 'settings') return response.status(400).json({ success: false, message: 'Unknown scheduler action.' });
    try {
      const settings = await store.saveSettings({ recipients: input.recipients, sendEmail: input.sendEmail });
      return response.status(200).json({ success: true, data: settings });
    } catch (error) {
      return response.status(400).json({ success: false, message: error.message || 'Could not save report settings.' });
    }
  }
  if (request.method !== 'GET') return response.status(405).json({ success: false, message: 'Method not allowed' });
  const date = currentIstDate();
  try {
    const force = String(request.query?.force || '') === '1';
    const existing = force ? null : (await store.listReports(90)).find(report => report.date === date && report.status === 'delivered');
    if (existing) return response.status(200).json({ success: true, skipped: true, message: `Report ${date} was already delivered.` });
    const report = await runDailyReport({ date, scheduled: true, email: true });
    return response.status(report.status === 'delivered' ? 200 : 207).json({ success: report.status === 'delivered', data: report });
  } catch (error) {
    console.error(JSON.stringify({ event: 'daily_report_cron_failed', date, message: error.message }));
    return response.status(500).json({ success: false, message: error.message || 'Scheduled report failed.' });
  }
};
