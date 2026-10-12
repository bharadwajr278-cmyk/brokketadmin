const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { generateSummary, number } = require('./report-pdf');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  return [...new Set(values.map(item => String(item).trim().toLowerCase()).filter(Boolean))];
}

function resolveRecipients(requested = [], env = process.env) {
  const requestedEmails = parseEmails(requested);
  const configuredTo = parseEmails(env.REPORT_RECIPIENT);
  const configuredCc = parseEmails(env.REPORT_CC);
  const to = configuredTo.length ? configuredTo : requestedEmails.slice(0, 1);
  const cc = configuredCc.length ? configuredCc : requestedEmails.slice(1);
  const all = [...new Set([...to, ...cc])];
  const invalid = all.filter(email => !EMAIL_PATTERN.test(email));
  if (!all.length) throw Object.assign(new Error('Add at least one valid report recipient.'), { code: 'RECIPIENTS_EMPTY' });
  if (invalid.length) throw Object.assign(new Error(`Invalid report recipient: ${invalid.join(', ')}`), { code: 'RECIPIENT_INVALID' });
  return { to, cc: cc.filter(email => !to.includes(email)), all };
}

function textBody(dataset, summary) {
  return [
    'BROKKET · EXECUTIVE INTELLIGENCE',
    `Daily Performance Report · ${dataset.reportDate}`,
    '',
    'Executive summary',
    ...summary.map(line => `- ${line}`),
    '',
    `${number(dataset.current?.overview?.newUsersInRange)} new users`,
    `${number(dataset.current?.overview?.newListingsInRange)} new listings`,
    `${number(dataset.current?.activity?.totalInteractions)} buyer interactions`,
    '',
    'The complete confidential PDF report is attached.',
    'Values unavailable from source APIs are clearly disclosed and never estimated.',
  ].join('\n');
}

function htmlBody(dataset, summary) {
  return `<div style="font-family:Arial,sans-serif;color:#0b1917;max-width:680px;margin:auto"><div style="background:#0b1917;color:white;padding:24px;border-radius:14px"><div style="color:#c9ff4a;font-weight:700;font-size:12px">BROKKET · EXECUTIVE INTELLIGENCE</div><h1 style="margin:10px 0 4px">Daily Performance Report</h1><div>${dataset.reportDate}</div></div><h2>Executive summary</h2><ul>${summary.map(line => `<li style="margin:8px 0">${line}</li>`).join('')}</ul><p><strong>${number(dataset.current?.overview?.newUsersInRange)}</strong> new users · <strong>${number(dataset.current?.overview?.newListingsInRange)}</strong> new listings · <strong>${number(dataset.current?.activity?.totalInteractions)}</strong> buyer interactions</p><p>The complete confidential PDF report is attached.</p><p style="font-size:12px;color:#6f7d79">Generated automatically by the Brokket CEO Dashboard. Values unavailable from source APIs are clearly disclosed and never estimated.</p></div>`;
}

function providerName(env = process.env) {
  const explicit = String(env.REPORT_EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if ((env.GMAIL_ADDRESS || env.SMTP_USER) && (env.GMAIL_APP_PASSWORD || env.SMTP_APP_PASSWORD)) return 'gmail';
  return 'resend';
}

function safeError(error) {
  const code = String(error?.code || error?.responseCode || 'EMAIL_PROVIDER_ERROR').toUpperCase();
  if (code === 'EAUTH' || code === '535') return { code: 'SMTP_AUTH_FAILED', message: 'Gmail SMTP authentication failed.' };
  if (code.includes('TIME') || code === 'ETIMEDOUT' || code === 'ESOCKET') return { code: 'SMTP_TIMEOUT', message: 'The email provider timed out or was unavailable.' };
  if (code === 'EENVELOPE' || code.includes('REJECT') || String(error?.responseCode || '').startsWith('5')) return { code: 'SMTP_REJECTED', message: 'The mail server rejected one or more recipients.' };
  if (code === 'SMTP_NOT_CONFIGURED' || code === 'RESEND_NOT_CONFIGURED') return { code, message: error.message };
  return { code, message: 'The email provider could not accept the report.' };
}

function log(logger, level, event) {
  const method = typeof logger?.[level] === 'function' ? level : 'log';
  if (typeof logger?.[method] === 'function') logger[method](JSON.stringify(event));
}

function deliveryKey(dataset, recipients, provider) {
  return crypto.createHash('sha256').update(JSON.stringify({
    date: dataset.reportDate,
    recipients: [...recipients].sort(),
    provider,
  })).digest('hex');
}

async function sendWithGmail({ env, createTransport, mail, recipients, attachment, logger }) {
  const address = String(env.GMAIL_ADDRESS || env.SMTP_USER || '').trim().toLowerCase();
  const password = String(env.GMAIL_APP_PASSWORD || env.SMTP_APP_PASSWORD || '');
  if (!address || !password) throw Object.assign(new Error('Gmail delivery is not configured. Add GMAIL_ADDRESS and GMAIL_APP_PASSWORD.'), { code: 'SMTP_NOT_CONFIGURED' });
  if (!EMAIL_PATTERN.test(address)) throw Object.assign(new Error('GMAIL_ADDRESS must be a valid email address.'), { code: 'SMTP_ADDRESS_INVALID' });
  const transporter = createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(env.SMTP_PORT) || 465,
    secure: String(env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
    auth: { user: address, pass: password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const result = await transporter.sendMail({
    ...mail,
    from: address,
    to: recipients.to.join(', '),
    cc: recipients.cc.length ? recipients.cc.join(', ') : undefined,
    envelope: { from: address, to: recipients.all },
    attachments: [attachment],
  });
  const rejected = parseEmails(result.rejected || []);
  const accepted = parseEmails(result.accepted?.length ? result.accepted : recipients.all.filter(email => !rejected.includes(email)));
  for (const recipient of rejected) log(logger, 'warn', { event: 'daily_report_recipient_rejected', provider: 'gmail-smtp', recipient, code: 'SMTP_REJECTED' });
  if (!accepted.length) throw Object.assign(new Error('The mail server rejected every report recipient.'), { code: 'SMTP_REJECTED', responseCode: result.responseCode });
  log(logger, 'info', { event: 'daily_report_mail_server_accepted', provider: 'gmail-smtp', messageId: result.messageId || null, response: result.response || null, accepted, rejected });
  return {
    provider: 'gmail-smtp',
    id: result.messageId || null,
    response: result.response || null,
    accepted,
    failures: rejected.map(recipient => ({ recipient, code: 'SMTP_REJECTED', message: 'Recipient was rejected by the SMTP server.' })),
  };
}

async function sendWithResend({ env, fetchImpl, mail, recipients, attachment, dedupeKey, logger }) {
  const apiKey = String(env.RESEND_API_KEY || '');
  const from = String(env.REPORT_EMAIL_FROM || '').trim();
  if (!apiKey || !from) throw Object.assign(new Error('Resend delivery is not configured. Add RESEND_API_KEY and a verified REPORT_EMAIL_FROM.'), { code: 'RESEND_NOT_CONFIGURED' });
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': dedupeKey },
    body: JSON.stringify({
      ...mail,
      from,
      to: recipients.to,
      cc: recipients.cc,
      attachments: [{ filename: attachment.filename, content: attachment.content.toString('base64') }],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('Resend did not accept the report.'), { code: `RESEND_${response.status}` });
  log(logger, 'info', { event: 'daily_report_mail_server_accepted', provider: 'resend', messageId: result.id || null, accepted: recipients.all });
  return { provider: 'resend', id: result.id || null, response: null, accepted: recipients.all, failures: [] };
}

async function sendDailyReport({
  dataset,
  pdf,
  recipients: requestedRecipients,
  env = process.env,
  createTransport = nodemailer.createTransport,
  fetchImpl = global.fetch,
  logger = console,
  delayImpl = delay,
  claimDelivery,
  releaseDelivery,
}) {
  const recipients = resolveRecipients(requestedRecipients, env);
  const provider = providerName(env);
  if (!['gmail', 'resend'].includes(provider)) throw Object.assign(new Error('REPORT_EMAIL_PROVIDER must be gmail or resend.'), { code: 'EMAIL_PROVIDER_INVALID' });
  const dedupeKey = deliveryKey(dataset, recipients.all, provider);
  if (claimDelivery && !await claimDelivery(dedupeKey, { date: dataset.reportDate, provider, recipients: recipients.all })) {
    log(logger, 'info', { event: 'daily_report_duplicate_prevented', date: dataset.reportDate, provider, recipients: recipients.all });
    return { status: 'duplicate-prevented', duplicatePrevented: true, dedupeKey, recipients: recipients.all, accepted: [], failures: [], attempts: 0 };
  }

  const summary = generateSummary(dataset);
  const mail = {
    subject: `Brokket Daily Performance Report · ${dataset.reportDate}`,
    text: textBody(dataset, summary),
    html: htmlBody(dataset, summary),
  };
  const attachment = { filename: `brokket-daily-performance-${dataset.reportDate}.pdf`, content: pdf, contentType: 'application/pdf' };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = provider === 'gmail'
        ? await sendWithGmail({ env, createTransport, mail, recipients, attachment, logger })
        : await sendWithResend({ env, fetchImpl, mail, recipients, attachment, dedupeKey, logger });
      const status = result.failures.length ? 'partially-sent-to-mail-server' : 'sent-to-mail-server';
      return { ...result, status, dedupeKey, recipients: recipients.all, attempts: attempt, sentAt: new Date().toISOString(), duplicatePrevented: false };
    } catch (error) {
      lastError = error;
      const safe = safeError(error);
      log(logger, 'error', { event: 'daily_report_send_attempt_failed', provider, attempt, code: safe.code, message: safe.message, recipients: recipients.all });
      if (attempt < 3) await delayImpl(750 * attempt);
    }
  }
  if (releaseDelivery) await releaseDelivery(dedupeKey).catch(() => {});
  const safe = safeError(lastError);
  throw Object.assign(new Error(safe.message), { code: safe.code, attempts: 3 });
}

module.exports = { sendDailyReport, resolveRecipients, providerName, safeError };
