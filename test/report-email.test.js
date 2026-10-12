const test = require('node:test');
const assert = require('node:assert/strict');
const { sendDailyReport, resolveRecipients } = require('../lib/report-email');

const dataset = {
  reportDate: '2026-10-12',
  current: {
    overview: { newUsersInRange: 10, newListingsInRange: 4 },
    activity: { totalInteractions: 8 },
  },
};
const pdf = Buffer.from('%PDF-test');
const env = {
  REPORT_EMAIL_PROVIDER: 'gmail',
  GMAIL_ADDRESS: 'sender@gmail.com',
  GMAIL_APP_PASSWORD: 'super-secret-app-password',
  SMTP_EMAIL_FROM: 'tech@brokket.com',
  REPORT_RECIPIENT: 'bharadwajr278@gmail.com',
  REPORT_CC: 'tech@brokket.com',
};

function loggerCapture() {
  const entries = [];
  return {
    entries,
    logger: {
      info: value => entries.push(value),
      warn: value => entries.push(value),
      error: value => entries.push(value),
      log: value => entries.push(value),
    },
  };
}

test('Gmail uses authenticated From, explicit envelope, To and Cc, plus text and HTML', async () => {
  let options;
  let message;
  const result = await sendDailyReport({
    dataset, pdf, recipients: [], env,
    createTransport: input => ({ sendMail: async mail => {
      options = input; message = mail;
      return { messageId: '<id@gmail.com>', response: '250 2.0.0 OK', accepted: [env.REPORT_RECIPIENT, env.REPORT_CC], rejected: [] };
    } }),
    logger: loggerCapture().logger,
    delayImpl: async () => {},
    claimDelivery: async () => true,
  });
  assert.equal(options.auth.user, env.GMAIL_ADDRESS);
  assert.equal(message.from, env.GMAIL_ADDRESS);
  assert.equal(message.to, env.REPORT_RECIPIENT);
  assert.equal(message.cc, env.REPORT_CC);
  assert.deepEqual(message.envelope, { from: env.GMAIL_ADDRESS, to: [env.REPORT_RECIPIENT, env.REPORT_CC] });
  assert.match(message.text, /Executive summary/);
  assert.match(message.html, /<h2>Executive summary<\/h2>/);
  assert.equal(result.status, 'sent-to-mail-server');
});

test('empty recipient values are rejected', () => {
  assert.throws(() => resolveRecipients([], { REPORT_RECIPIENT: '', REPORT_CC: '' }), error => error.code === 'RECIPIENTS_EMPTY');
});

test('explicit manual recipients override environment defaults', () => {
  assert.deepEqual(resolveRecipients(['tech@brokket.com'], env), {
    to: ['tech@brokket.com'], cc: [], all: ['tech@brokket.com'],
  });
});

test('recipient-specific SMTP rejection is reported without claiming inbox delivery', async () => {
  const capture = loggerCapture();
  const result = await sendDailyReport({
    dataset, pdf, recipients: [], env,
    createTransport: () => ({ sendMail: async () => ({
      messageId: '<partial@gmail.com>', response: '250 accepted primary',
      accepted: [env.REPORT_RECIPIENT], rejected: [env.REPORT_CC],
    }) }),
    logger: capture.logger,
    delayImpl: async () => {},
    claimDelivery: async () => true,
  });
  assert.equal(result.status, 'partially-sent-to-mail-server');
  assert.deepEqual(result.accepted, [env.REPORT_RECIPIENT]);
  assert.equal(result.failures[0].recipient, env.REPORT_CC);
  assert.match(capture.entries.join('\n'), /daily_report_recipient_rejected/);
});

test('authentication failures are sanitized and secrets are never logged', async () => {
  const capture = loggerCapture();
  await assert.rejects(sendDailyReport({
    dataset, pdf, recipients: [], env,
    createTransport: () => ({ sendMail: async () => { throw Object.assign(new Error(`bad password ${env.GMAIL_APP_PASSWORD}`), { code: 'EAUTH' }); } }),
    logger: capture.logger,
    delayImpl: async () => {},
    claimDelivery: async () => true,
    releaseDelivery: async () => {},
  }), error => error.code === 'SMTP_AUTH_FAILED');
  const logs = capture.entries.join('\n');
  assert.doesNotMatch(logs, new RegExp(env.GMAIL_APP_PASSWORD));
  assert.match(logs, /SMTP_AUTH_FAILED/);
});

test('Gmail falls back to legacy SMTP credentials after new credential authentication failure', async () => {
  const attempts = [];
  const fallbackEnv = {
    ...env,
    SMTP_USER: 'legacy@gmail.com',
    SMTP_APP_PASSWORD: 'legacy-app-password',
  };
  const result = await sendDailyReport({
    dataset, pdf, recipients: ['tech@brokket.com'], env: fallbackEnv,
    createTransport: options => ({ sendMail: async message => {
      attempts.push({ options, message });
      if (options.auth.user === fallbackEnv.GMAIL_ADDRESS) throw Object.assign(new Error('auth failed'), { code: 'EAUTH' });
      return { messageId: '<legacy@gmail.com>', response: '250 OK', accepted: ['tech@brokket.com'], rejected: [] };
    } }),
    logger: loggerCapture().logger,
    delayImpl: async () => {},
    claimDelivery: async () => true,
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].options.auth.user, fallbackEnv.SMTP_USER);
  assert.equal(attempts[1].message.from, fallbackEnv.SMTP_USER);
  assert.deepEqual(attempts[1].message.envelope.to, ['tech@brokket.com']);
  assert.equal(result.status, 'sent-to-mail-server');
});

test('delivery claim prevents a retry from sending the same report twice', async () => {
  const claims = new Set();
  let sends = 0;
  const claimDelivery = async key => claims.has(key) ? false : (claims.add(key), true);
  const createTransport = () => ({ sendMail: async () => {
    sends += 1;
    return { messageId: '<once@gmail.com>', response: '250 OK', accepted: [env.REPORT_RECIPIENT, env.REPORT_CC], rejected: [] };
  } });
  const shared = { dataset, pdf, recipients: [], env, createTransport, logger: loggerCapture().logger, delayImpl: async () => {}, claimDelivery };
  const first = await sendDailyReport(shared);
  const second = await sendDailyReport(shared);
  assert.equal(first.status, 'sent-to-mail-server');
  assert.equal(second.status, 'duplicate-prevented');
  assert.equal(sends, 1);
});
