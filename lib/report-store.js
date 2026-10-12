const { put, get, list, del } = require('@vercel/blob');

function configured() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID); }
function requireStore() { if (!configured()) throw new Error('Report storage is not configured. Add a Vercel Blob store to this project.'); }
async function readJson(pathname, fallback = null) {
  requireStore();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result?.stream) return fallback;
  return JSON.parse(Buffer.from(await new Response(result.stream).arrayBuffer()).toString('utf8'));
}
async function writeJson(pathname, value) {
  requireStore();
  return put(pathname, JSON.stringify(value, null, 2), { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });
}
async function getSettings() {
  const recipients = [...new Set([process.env.REPORT_RECIPIENT, process.env.REPORT_CC].flatMap(value => String(value || '').split(/[\n,;]+/)).map(value => value.trim().toLowerCase()).filter(Boolean))];
  const fallback = { recipients, sendEmail: true, scheduledHourIST: '18:30' };
  if (!configured()) return { ...fallback, storageConfigured: false };
  try { return { ...fallback, ...(await readJson('report-config/settings.json', {})), storageConfigured: true }; } catch { return { ...fallback, storageConfigured: true }; }
}
async function saveSettings(settings) {
  const normalized = { recipients: [...new Set((settings.recipients || []).map(value => String(value).trim().toLowerCase()).filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))], sendEmail: settings.sendEmail !== false, scheduledHourIST: '18:30', updatedAt: new Date().toISOString() };
  if (!normalized.recipients.length) throw new Error('Add at least one valid recipient email address.');
  await writeJson('report-config/settings.json', normalized); return { ...normalized, storageConfigured: true };
}
async function saveReport(date, pdf, metadata) {
  requireStore();
  const pathname = `reports/${date}/brokket-daily-performance-${date}.pdf`;
  await put(pathname, pdf, { access: 'private', contentType: 'application/pdf', allowOverwrite: true, addRandomSuffix: false });
  const saved = { ...metadata, date, pathname, size: pdf.length, updatedAt: new Date().toISOString() };
  await writeJson(`report-metadata/${date}.json`, saved); return saved;
}
async function updateReport(metadata) { await writeJson(`report-metadata/${metadata.date}.json`, { ...metadata, updatedAt: new Date().toISOString() }); return metadata; }
async function listReports(limit = 90) {
  if (!configured()) return [];
  const result = await list({ prefix: 'report-metadata/', limit: Math.min(1000, limit) });
  const reports = await Promise.all(result.blobs.filter(blob => blob.pathname.endsWith('.json')).map(blob => readJson(blob.pathname, null)));
  return reports.filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
}
async function readReport(pathname) {
  requireStore();
  if (!/^reports\/\d{4}-\d{2}-\d{2}\/brokket-daily-performance-\d{4}-\d{2}-\d{2}\.pdf$/.test(String(pathname))) throw new Error('Invalid report path.');
  return get(pathname, { access: 'private', useCache: true });
}
function deliveryLockPath(key) { return `report-delivery-locks/${String(key).replace(/[^a-f0-9]/gi, '')}.json`; }
function lockConflict(error) { return Number(error?.status || error?.statusCode) === 409 || /already exists|overwrite|conflict/i.test(String(error?.message || '')); }
async function acquireDeliveryLock(key, metadata) {
  requireStore();
  try {
    await put(deliveryLockPath(key), JSON.stringify({ ...metadata, claimedAt: new Date().toISOString() }), { access: 'private', contentType: 'application/json', allowOverwrite: false, addRandomSuffix: false });
    return true;
  } catch (error) {
    if (lockConflict(error)) return false;
    throw error;
  }
}
async function releaseDeliveryLock(key) { requireStore(); await del(deliveryLockPath(key)); }
module.exports = { configured, getSettings, saveSettings, saveReport, updateReport, listReports, readReport, acquireDeliveryLock, releaseDeliveryLock };
