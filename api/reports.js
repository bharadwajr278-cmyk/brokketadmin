const { Readable } = require('node:stream');
const { getSession } = require('../lib/auth');
const store = require('../lib/report-store');
const { runDailyReport } = require('../lib/report-runner');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function body(request) { if (request.body && typeof request.body === 'object') return request.body; try { return JSON.parse(String(request.body || '{}')); } catch { return {}; } }
function istToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!getSession(request)) return response.status(401).json({ success: false, message: 'Authentication required.' });
  try {
    if (request.method === 'GET' && request.query.download) {
      const result = await store.readReport(String(request.query.download));
      if (!result?.stream) return response.status(404).json({ success: false, message: 'Report not found.' });
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', result.blob.contentDisposition || `attachment; filename="${result.blob.pathname.split('/').at(-1)}"`);
      response.setHeader('Content-Length', String(result.blob.size));
      return Readable.fromWeb(result.stream).pipe(response);
    }
    if (request.method === 'GET') {
      const [settings, reports] = await Promise.all([store.getSettings(), store.listReports(90)]);
      return response.status(200).json({ success: true, data: { settings, reports, configuration: { storage: store.configured(), email: Boolean(process.env.RESEND_API_KEY), scheduler: Boolean(process.env.CRON_SECRET && process.env.BROKKET_REPORT_PHONE && process.env.BROKKET_REPORT_PASSWORD) } } });
    }
    if (request.method === 'POST') {
      const input = body(request);
      if (input.action === 'settings') return response.status(200).json({ success: true, data: await store.saveSettings(input) });
      if (input.action === 'generate') {
        const date = String(input.date || istToday());
        if (!DATE_PATTERN.test(date) || date > istToday()) return response.status(400).json({ success: false, message: 'Choose a valid reporting date that is not in the future.' });
        const report = await runDailyReport({ request, date, scheduled: false, email: input.email !== false });
        return response.status(200).json({ success: true, data: report });
      }
      return response.status(400).json({ success: false, message: 'Unknown report action.' });
    }
    response.setHeader('Allow', 'GET, POST'); return response.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'report_api_failed', message: error.message }));
    return response.status(500).json({ success: false, message: error.message || 'Report request failed.' });
  }
};
