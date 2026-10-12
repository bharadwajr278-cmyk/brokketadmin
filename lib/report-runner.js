const { reportingSession, buildReportDataset } = require('./report-service');
const { createPdf, generateSummary } = require('./report-pdf-v2');
const store = require('./report-store');
const { sendDailyReport } = require('./report-email');

async function runDailyReport({ request, date, scheduled = false, email = true }) {
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: 'daily_report_started', date, scheduled, startedAt }));
  const session = await reportingSession(request, scheduled);
  const dataset = await buildReportDataset(session, date);
  const pdf = await createPdf(dataset);
  const settings = await store.getSettings();
  let metadata = await store.saveReport(date, pdf, {
    status: 'generated', generatedAt: dataset.generatedAt, startedAt, scheduled, recipients: settings.recipients,
    summary: generateSummary(dataset), sourceErrors: dataset.current.errors || [], delivery: { status: email && settings.sendEmail ? 'pending' : 'not-requested', attempts: 0 },
  });
  if (email && settings.sendEmail) {
    try {
      const delivery = await sendDailyReport({
        dataset,
        pdf,
        recipients: settings.recipients,
        claimDelivery: store.acquireDeliveryLock,
        releaseDelivery: store.releaseDeliveryLock,
      });
      metadata = { ...metadata, status: delivery.status, recipients: delivery.recipients, delivery };
    } catch (error) {
      metadata = { ...metadata, status: 'delivery-failed', delivery: { status: 'failed', attempts: error.attempts || 3, failedAt: new Date().toISOString(), code: error.code || 'EMAIL_PROVIDER_ERROR', message: error.message } };
      console.error(JSON.stringify({ event: 'daily_report_delivery_failed', date, code: metadata.delivery.code, message: error.message }));
    }
    await store.updateReport(metadata);
  }
  console.log(JSON.stringify({ event: 'daily_report_completed', date, status: metadata.status, sourceErrors: metadata.sourceErrors.length }));
  return metadata;
}

module.exports = { runDailyReport };
