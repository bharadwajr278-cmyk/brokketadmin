const { generateSummary, number } = require('./report-pdf');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendDailyReport({ dataset, pdf, recipients }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email delivery is not configured. Add RESEND_API_KEY.');
  const from = process.env.REPORT_EMAIL_FROM || 'Brokket CEO Dashboard <onboarding@resend.dev>';
  const summary = generateSummary(dataset);
  const message = {
    from, subject: `Brokket Daily Performance Report · ${dataset.reportDate}`,
    html: `<div style="font-family:Arial,sans-serif;color:#0b1917;max-width:680px;margin:auto"><div style="background:#0b1917;color:white;padding:24px;border-radius:14px"><div style="color:#c9ff4a;font-weight:700;font-size:12px">BROKKET · EXECUTIVE INTELLIGENCE</div><h1 style="margin:10px 0 4px">Daily Performance Report</h1><div>${dataset.reportDate}</div></div><h2>Executive summary</h2><ul>${summary.map(line => `<li style="margin:8px 0">${line}</li>`).join('')}</ul><p><strong>${number(dataset.current?.overview?.newUsersInRange)}</strong> new users · <strong>${number(dataset.current?.overview?.newListingsInRange)}</strong> new listings · <strong>${number(dataset.current?.activity?.totalInteractions)}</strong> buyer interactions</p><p>The complete confidential PDF report is attached.</p><p style="font-size:12px;color:#6f7d79">Generated automatically by the Brokket CEO Dashboard. Values unavailable from source APIs are clearly disclosed and never estimated.</p></div>`,
    attachments: [{ filename: `brokket-daily-performance-${dataset.reportDate}.pdf`, content: pdf.toString('base64') }],
  };
  const deliveries = [];
  const failures = [];
  for (const recipient of recipients) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(25000),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...message, to: [recipient] }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `Email provider failed (${response.status})`);
        deliveries.push({ recipient, id: result.id, attempts: attempt, sentAt: new Date().toISOString() });
        lastError = null;
        break;
      } catch (error) { lastError = error; if (attempt < 3) await delay(750 * attempt); }
    }
    if (lastError) failures.push({ recipient, attempts: 3, message: lastError.message });
  }
  if (!deliveries.length) throw new Error(failures.map(item => `${item.recipient}: ${item.message}`).join('; '));
  return { id: deliveries[0].id, attempts: Math.max(...deliveries.map(item => item.attempts)), sentAt: deliveries[0].sentAt, deliveries, failures };
}
module.exports = { sendDailyReport };
