const PDFDocument = require('pdfkit');

// PDFKit loads these modules dynamically. Explicit references keep them in the
// Vercel function bundle without relying on symlinked includeFiles rules.
require('../node_modules/.pnpm/pdfkit@0.20.2/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs');
require('../node_modules/.pnpm/pdfkit@0.20.2/node_modules/pdfkit/js/standard-fonts/HelveticaBold.cjs');

const C = {
  ink: '#0b1917', muted: '#6f7d79', lime: '#b7ef35', blue: '#64a8ff',
  violet: '#856ee8', line: '#dfe6df', paper: '#f5f7f3', red: '#d65b55', white: '#ffffff',
};
const MARGIN = 38;
const BOTTOM = 52;
const safe = value => String(value ?? '-').replace(/[\u2010-\u2015]/g, '-').replace(/\u2022/g, '*');
const n = value => Number(value) || 0;
const number = value => new Intl.NumberFormat('en-IN').format(n(value));
const money = value => `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n(value))}`;
const queryCost = value => `INR ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n(value) / 10000000)} Cr`;

function change(current, previous) {
  const c = n(current), p = n(previous);
  if (!p) return c ? 'New' : '0.0%';
  const value = (c - p) / Math.abs(p) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function at(source, path, fallback = null) {
  return path.split('.').reduce((value, key) => value?.[key], source) ?? fallback;
}

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['content', 'data', 'series', 'items', 'rows']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

const CITY_KEY_ALIASES = new Map([
  ['gurgaon', 'gurugram'],
  ['newdelhi', 'delhi'],
]);

function cityToken(value) {
  const token = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bcity\b/g, '').replace(/[^a-z0-9]+/g, '');
  return CITY_KEY_ALIASES.get(token) || token;
}

function geographyRows(data) {
  const keys = ['usersByCity', 'loginsByCity', 'listingsByCity', 'likesByCity'];
  const excluded = new Set(['', 'unknown', 'unk', 'null', 'other']);
  const cities = new Map();
  keys.forEach((sourceKey, metricIndex) => {
    for (const row of rowsOf(data?.[sourceKey])) {
      const nameToken = cityToken(row?.cityName);
      const codeToken = cityToken(row?.cityCode);
      const key = !excluded.has(nameToken) ? nameToken : codeToken;
      if (excluded.has(key)) continue;
      const suppliedName = String(row?.cityName || '').trim();
      const fallbackName = String(row?.cityCode || key).trim().replace(/[_-]+/g, ' ').replace(/\bcity\b/gi, '').trim();
      const displayName = suppliedName && !excluded.has(cityToken(suppliedName)) ? suppliedName : fallbackName;
      if (!cities.has(key)) cities.set(key, { name: displayName || key, counts: [0, 0, 0, 0] });
      const city = cities.get(key);
      if (/^[a-z]/.test(city.name) && /^[A-Z]/.test(displayName)) city.name = displayName;
      city.counts[metricIndex] += n(row?.count);
    }
  });
  return [...cities.values()].map(city => [city.name, ...city.counts]).sort((a, b) => a[0].localeCompare(b[0]));
}

function pointValue(point) {
  for (const key of ['count', 'value', 'registrations', 'logins', 'newListings', 'totalLikes', 'netRevenue', 'revenue']) {
    if (point?.[key] != null) return n(point[key]);
  }
  return 0;
}

function pointLabel(point, index) {
  return safe(point?.label || point?.date || point?.day || point?.period || index + 1);
}

function generateSummary(dataset) {
  const c = dataset.current, p = dataset.previous;
  const metrics = [
    ['New users', at(c, 'overview.newUsersInRange'), at(p, 'overview.newUsersInRange')],
    ['New listings', at(c, 'overview.newListingsInRange'), at(p, 'overview.newListingsInRange')],
    ['Successful login users', at(c, 'logins.uniqueActiveUsers'), at(p, 'logins.uniqueActiveUsers')],
    ['Mandate/Requirement likes', at(c, 'likes.totalLikesInRange'), at(p, 'likes.totalLikesInRange')],
    ['Interactions', at(c, 'activity.totalInteractions'), at(p, 'activity.totalInteractions')],
    ['Revenue', at(c, 'subscriptions.revenueInRange'), at(p, 'subscriptions.revenueInRange')],
  ];
  const ranked = metrics.filter(([, current, previous]) => current != null && previous != null)
    .map(([label, current, previous]) => ({ label, delta: n(previous) ? (n(current) - n(previous)) / Math.abs(n(previous)) * 100 : null }));
  const improved = ranked.filter(item => item.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const declined = ranked.filter(item => item.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const lines = [`${number(at(c, 'overview.newUsersInRange'))} new users, ${number(at(c, 'overview.newListingsInRange'))} new listings and ${number(at(c, 'logins.uniqueActiveUsers'))} unique successful login users were recorded.`];
  if (improved) lines.push(`Strongest day-over-day improvement: ${improved.label} (${improved.delta.toFixed(1)}%).`);
  if (declined) lines.push(`Largest decline requiring attention: ${declined.label} (${declined.delta.toFixed(1)}%).`);
  if (c.errors?.length) lines.push(`${c.errors.length} current-day source section(s) were unavailable and are disclosed in Data quality.`);
  return lines;
}

function createPdf(dataset) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: MARGIN, bufferPages: true,
      info: { Title: `Brokket Daily Performance Report - ${dataset.reportDate}`, Author: 'Brokket CEO Dashboard' },
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - MARGIN * 2;
    const pageBottom = () => doc.page.height - BOTTOM;
    let y = MARGIN;

    const resetPage = (add = true) => {
      if (add) doc.addPage();
      y = MARGIN;
    };
    const ensure = height => {
      if (y + height > pageBottom()) resetPage(true);
    };
    const text = (value, x, top, options = {}) => {
      doc.text(safe(value), x, top, { lineBreak: false, ...options });
    };
    const sectionHeading = (index, title, subtitle = '', newPage = false) => {
      if (newPage) resetPage(true); else ensure(64);
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
      text(`${String(index).padStart(2, '0')} | ${title.toUpperCase()}`, MARGIN, y, { width: contentWidth });
      y += 15;
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20);
      text(title, MARGIN, y, { width: contentWidth });
      y += 29;
      if (subtitle) {
        doc.fillColor(C.muted).font('Helvetica').fontSize(8);
        text(subtitle, MARGIN, y, { width: contentWidth });
        y += 18;
      }
    };
    const cards = items => {
      const columns = 3;
      const gap = 8;
      const cardWidth = (contentWidth - gap * 2) / 3;
      const cardHeight = 62;
      for (let start = 0; start < items.length; start += columns) {
        ensure(cardHeight + 9);
        const line = items.slice(start, start + columns);
        line.forEach((item, column) => {
          const x = MARGIN + column * (cardWidth + gap);
          const dark = start === 0 && column === 0;
          doc.roundedRect(x, y, cardWidth, cardHeight, 8).fillAndStroke(dark ? C.ink : C.white, dark ? C.ink : C.line);
          doc.fillColor(dark ? '#aab7b2' : C.muted).font('Helvetica-Bold').fontSize(7);
          text(safe(item.label).toUpperCase(), x + 11, y + 10, { width: cardWidth - 22 });
          doc.fillColor(dark ? C.white : C.ink).font('Helvetica-Bold').fontSize(16);
          text(item.value, x + 11, y + 26, { width: cardWidth - 22 });
          if (item.note) {
            doc.fillColor(dark ? '#aab7b2' : C.muted).font('Helvetica').fontSize(7);
            text(item.note, x + 11, y + 49, { width: cardWidth - 22 });
          }
        });
        y += cardHeight + 9;
      }
    };
    const comparison = items => {
      const list = items.filter(item => item.current != null && item.previous != null);
      if (!list.length) return;
      ensure(list.length * 25 + 16);
      const labelWidth = 105;
      const chartX = MARGIN + labelWidth;
      const chartWidth = contentWidth - labelWidth;
      const max = Math.max(1, ...list.flatMap(item => [n(item.current), n(item.previous)]));
      list.forEach(item => {
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(7);
        text(item.label, MARGIN, y + 2, { width: labelWidth - 6 });
        doc.roundedRect(chartX, y, Math.max(2, n(item.current) / max * chartWidth), 7, 3).fill(C.lime);
        doc.roundedRect(chartX, y + 11, Math.max(2, n(item.previous) / max * chartWidth), 5, 2).fill(C.blue);
        doc.fillColor(C.muted).font('Helvetica').fontSize(6);
        const currentLabel = item.format ? item.format(item.current) : number(item.current);
        const previousLabel = item.format ? item.format(item.previous) : number(item.previous);
        text(`${currentLabel} | prev ${previousLabel} | ${change(item.current, item.previous)}`, chartX + 3, y + 1, { width: chartWidth - 6, align: 'right' });
        y += 25;
      });
      y += 8;
    };
    const trend = (title, source, color = C.lime) => {
      const points = rowsOf(source).map((point, index) => ({ label: pointLabel(point, index), value: pointValue(point) }));
      if (!points.length) return;
      const shown = points.slice(-31);
      const height = 80;
      ensure(height + 34);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10);
      text(title, MARGIN, y, { width: contentWidth });
      y += 17;
      const chartTop = y;
      const max = Math.max(1, ...shown.map(point => point.value));
      const gap = 2;
      const barWidth = Math.max(2, (contentWidth - gap * (shown.length - 1)) / shown.length);
      shown.forEach((point, index) => {
        const barHeight = Math.max(1, point.value / max * height);
        const x = MARGIN + index * (barWidth + gap);
        doc.rect(x, chartTop + height - barHeight, barWidth, barHeight).fill(color);
      });
      doc.fillColor(C.muted).font('Helvetica').fontSize(6);
      text(`${shown[0].label}  |  peak ${number(max)}  |  ${shown.at(-1).label}: ${number(shown.at(-1).value)}`, MARGIN, chartTop + height + 5, { width: contentWidth });
      y = chartTop + height + 20;
    };
    const table = (headers, body, widths, options = {}) => {
      const rowHeight = options.rowHeight || 20;
      const total = widths.reduce((sum, value) => sum + value, 0);
      const scaled = widths.map(value => value / total * contentWidth);
      const draw = (values, header = false) => {
        const top = y;
        let x = MARGIN;
        doc.rect(MARGIN, top, contentWidth, rowHeight).fillAndStroke(header ? C.ink : (doc._shade ? '#f8faf7' : C.white), header ? C.ink : C.line);
        values.forEach((value, index) => {
          doc.fillColor(header ? C.white : C.ink).font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
          text(value, x + 5, top + 7, { width: scaled[index] - 10, ellipsis: true });
          x += scaled[index];
        });
        y += rowHeight;
        if (!header) doc._shade = !doc._shade;
      };
      const headerSpace = rowHeight * 2;
      ensure(headerSpace);
      draw(headers, true);
      body.forEach(row => {
        if (y + rowHeight > pageBottom()) {
          resetPage(true);
          draw(headers, true);
        }
        draw(row);
      });
      y += 10;
    };

    // Page 1: cover, executive summary and headline KPIs.
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.paper);
    doc.roundedRect(MARGIN, MARGIN, contentWidth, 126, 15).fill(C.ink);
    doc.fillColor(C.lime).font('Helvetica-Bold').fontSize(10);
    text('BROKKET | EXECUTIVE INTELLIGENCE', 58, 58, { width: contentWidth - 40 });
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(27);
    text('Daily Performance Report', 58, 82, { width: contentWidth - 40 });
    doc.fillColor('#aab7b2').font('Helvetica').fontSize(10);
    text(`Reporting date ${dataset.reportDate} | compared with ${dataset.previousDate}`, 58, 121, { width: contentWidth - 40 });
    doc.fontSize(8);
    text(`Generated ${new Date(dataset.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 58, 142, { width: contentWidth - 40 });
    y = 184;
    sectionHeading(1, 'Executive summary', 'Independent API snapshot for the reporting date');
    generateSummary(dataset).forEach(line => {
      doc.fillColor(C.ink).font('Helvetica').fontSize(10);
      const height = doc.heightOfString(`- ${safe(line)}`, { width: contentWidth, lineGap: 3 });
      ensure(height + 5);
      doc.text(`- ${safe(line)}`, MARGIN, y, { width: contentWidth, lineGap: 3 });
      y += height + 5;
    });

    const c = dataset.current;
    const p = dataset.previous;
    sectionHeading(2, 'Headline KPIs', 'Current values and day-over-day movement');
    cards([
      { label: 'Total users', value: number(at(c, 'overview.totalUsers')), note: 'all time' },
      { label: 'New users', value: number(at(c, 'overview.newUsersInRange')), note: change(at(c, 'overview.newUsersInRange'), at(p, 'overview.newUsersInRange')) },
      { label: 'Unique logins', value: number(at(c, 'logins.uniqueActiveUsers')), note: change(at(c, 'logins.uniqueActiveUsers'), at(p, 'logins.uniqueActiveUsers')) },
      { label: 'Active listings', value: number(at(c, 'overview.totalActiveListings')), note: 'all time' },
      { label: 'New listings', value: number(at(c, 'overview.newListingsInRange')), note: change(at(c, 'overview.newListingsInRange'), at(p, 'overview.newListingsInRange')) },
      { label: 'Tracked likes', value: number(at(c, 'likes.totalLikesInRange')), note: change(at(c, 'likes.totalLikesInRange'), at(p, 'likes.totalLikesInRange')) },
    ]);

    sectionHeading(3, 'Daily performance trends', 'Every date-based graph available from dashboard APIs', true);
    trend('Registrations', c.registrations, C.lime);
    trend('Successful logins', c.loginTrend, C.blue);
    trend('New listings', c.listingTrend, C.violet);
    trend('Mandate and Requirement likes', c.likesTrend, C.lime);
    trend('Net subscription revenue', c.revenueTrend, C.blue);

    sectionHeading(4, 'App analytics', 'Amplitude daily active users, processed live interval and app downloads', true);
    cards([
      { label: 'Daily active users', value: c.amplitude ? number(c.amplitude.dau) : 'Unavailable', note: 'DAU' },
      { label: 'Live users', value: c.amplitude?.liveUsers == null ? 'Unavailable' : number(c.amplitude.liveUsers), note: 'latest processed interval' },
      { label: 'Total downloads', value: c.amplitude?.totalDownloads == null ? 'Unavailable' : number(c.amplitude.totalDownloads), note: 'unique installs' },
      { label: 'Android downloads', value: c.amplitude?.androidDownloads == null ? 'Unavailable' : number(c.amplitude.androidDownloads) },
      { label: 'iOS downloads', value: c.amplitude?.iosDownloads == null ? 'Unavailable' : number(c.amplitude.iosDownloads) },
      { label: 'DAU vs previous', value: change(c.amplitude?.dau, p.amplitude?.dau), note: `previous ${number(p.amplitude?.dau)}` },
    ]);
    comparison([
      { label: 'Daily active users', current: c.amplitude?.dau, previous: p.amplitude?.dau },
      { label: 'Total downloads', current: c.amplitude?.totalDownloads, previous: p.amplitude?.totalDownloads },
      { label: 'Android downloads', current: c.amplitude?.androidDownloads, previous: p.amplitude?.androidDownloads },
      { label: 'iOS downloads', current: c.amplitude?.iosDownloads, previous: p.amplitude?.iosDownloads },
    ]);

    sectionHeading(5, 'Marketplace inventory', 'Listing mix, daily velocity and contributor table', true);
    cards(Object.entries(c.listingTypes || {}).map(([label, value]) => ({ label, value: number(value), note: 'new listings' })));
    comparison([
      { label: 'New listings', current: at(c, 'overview.newListingsInRange'), previous: at(p, 'overview.newListingsInRange') },
      ...Object.entries(c.listingTypes || {}).map(([label, value]) => ({ label, current: value, previous: 0 })),
    ]);
    table(['Contributor', 'User', 'Listings'], rowsOf(c.contributors).map(item => [item.fullName || 'Unnamed', `**** ${String(item.username || '').slice(-4)}`, number(item.count)]), [3, 2, 1]);

    sectionHeading(6, 'Demand and property activity', 'Intent signals, buyer actions and query cost', true);
    cards([
      { label: 'Mandate/Requirement likes', value: number(at(c, 'likes.totalLikesInRange')), note: change(at(c, 'likes.totalLikesInRange'), at(p, 'likes.totalLikesInRange')) },
      { label: 'Called', value: c.activity ? number(c.activity.called) : 'Unavailable' },
      { label: 'WhatsApped', value: c.activity ? number(c.activity.whatsapped) : 'Unavailable' },
      { label: 'Shared', value: c.activity ? number(c.activity.shared) : 'Unavailable' },
      { label: 'All interactions', value: c.activity ? number(c.activity.totalInteractions) : 'Unavailable', note: change(c.activity?.totalInteractions, p.activity?.totalInteractions) },
      { label: 'Total query cost', value: c.activity ? queryCost(c.activity.totalQueryCost) : 'Unavailable', note: change(c.activity?.totalQueryCost, p.activity?.totalQueryCost) },
    ]);
    comparison([
      { label: 'Tracked likes', current: at(c, 'likes.totalLikesInRange'), previous: at(p, 'likes.totalLikesInRange') },
      { label: 'Calls', current: c.activity?.called, previous: p.activity?.called },
      { label: 'WhatsApp', current: c.activity?.whatsapped, previous: p.activity?.whatsapped },
      { label: 'Shares', current: c.activity?.shared, previous: p.activity?.shared },
      { label: 'Query cost', current: c.activity?.totalQueryCost, previous: p.activity?.totalQueryCost, format: queryCost },
    ]);

    sectionHeading(7, 'Subscriptions and revenue', 'Purchases, renewals, unique customers, plans and autopay', true);
    cards([
      { label: 'Active paid', value: number(at(c, 'subscriptions.totalActiveSubscribers')) },
      { label: 'Including trials', value: number(at(c, 'subscriptions.totalActiveIncludingTrial')) },
      { label: 'Autopay on', value: number(at(c, 'subscriptions.autopayOnCount')) },
      { label: 'Customers who paid', value: number(at(c, 'subscriptions.totalUniquePayingSubscribersAllTime')), note: 'unique all time' },
      { label: 'Payment transactions', value: number(at(c, 'subscriptions.totalSubscriptionsSoldAllTime')), note: 'purchases + renewals' },
      { label: 'Revenue', value: money(at(c, 'subscriptions.revenueInRange')), note: change(at(c, 'subscriptions.revenueInRange'), at(p, 'subscriptions.revenueInRange')) },
    ]);
    comparison([
      { label: 'New purchases', current: at(c, 'subscriptions.newPurchasesInRange'), previous: at(p, 'subscriptions.newPurchasesInRange') },
      { label: 'Renewals', current: at(c, 'subscriptions.renewalsInRange'), previous: at(p, 'subscriptions.renewalsInRange') },
      { label: 'Net revenue', current: at(c, 'subscriptions.revenueInRange'), previous: at(p, 'subscriptions.revenueInRange') },
    ]);
    table(['Plan', 'Code', 'Active', 'Tracked revenue'], rowsOf(c.subscriptions?.byPlan).map(plan => [plan.planName || plan.planCode, plan.planCode, number(plan.activeSubscribers), money(plan.totalRevenueAllTime)]), [3, 1.5, 1.2, 2]);

    sectionHeading(8, 'Active subscriber roster', 'Complete source response captured for the reporting date', true);
    table(['Subscriber', 'Plan', 'Cycle', 'Autopay', 'Status', 'Expiry'], rowsOf(c.roster).map(item => [item.fullName || 'Unnamed', item.planName || item.planCode, item.subscriptionPlanType || '-', item.autopayOn ? 'On' : 'Off', item.recurringStatus || item.displayStatus || 'One-time', String(item.expiryDate || '-').slice(0, 10)]), [2.4, 1.8, 1.3, 1, 1.4, 1.4]);

    sectionHeading(9, 'Content performance', 'Feed posts, picture posts and distinct creators', true);
    cards([
      { label: 'Feed posts', value: number(at(c, 'content.feedPostsInRange')), note: change(at(c, 'content.feedPostsInRange'), at(p, 'content.feedPostsInRange')) },
      { label: 'Picture posts', value: number(at(c, 'content.picturesUploadedInRange')), note: change(at(c, 'content.picturesUploadedInRange'), at(p, 'content.picturesUploadedInRange')) },
      { label: 'Unique creators', value: number(at(c, 'content.uniqueContentCreatorsInRange')), note: change(at(c, 'content.uniqueContentCreatorsInRange'), at(p, 'content.uniqueContentCreatorsInRange')) },
      { label: 'Circle activity', value: 'Unavailable', note: 'not exposed by API' },
      { label: 'Clips', value: 'Unavailable', note: 'not exposed by API' },
      { label: 'Blinks', value: 'Unavailable', note: 'not exposed by API' },
    ]);
    comparison([
      { label: 'Feed posts', current: at(c, 'content.feedPostsInRange'), previous: at(p, 'content.feedPostsInRange') },
      { label: 'Picture posts', current: at(c, 'content.picturesUploadedInRange'), previous: at(p, 'content.picturesUploadedInRange') },
      { label: 'Unique creators', current: at(c, 'content.uniqueContentCreatorsInRange'), previous: at(p, 'content.uniqueContentCreatorsInRange') },
    ]);

    sectionHeading(10, 'Geography', 'All valid city-attributed results; unknown, null and other excluded', true);
    const cityRows = geographyRows(c).map(([name, ...counts]) => [name, ...counts.map(number)]);
    table(['City', 'New users', 'Logins', 'Listings', 'Likes'], cityRows, [2.5, 1.2, 1.2, 1.2, 1.2]);

    sectionHeading(11, 'Data quality and delivery notes', 'No dummy, estimated or hardcoded metric values', true);
    const issues = [...(c.errors || []), ...(p.errors || [])];
    const notes = issues.length ? issues.map(issue => [issue.section, issue.message]) : [['All queried sections', 'Available at generation time']];
    notes.push(['Circle activity / Clips / Blinks', 'Not exposed by current dashboard APIs; intentionally not estimated.']);
    if (!c.amplitude?.downloadsAvailable) notes.push(['App downloads', 'Amplitude install event unavailable; no value reported.']);
    table(['Section', 'Status / explanation'], notes, [2, 5], { rowHeight: 24 });

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      doc.fillColor(C.muted).font('Helvetica').fontSize(7);
      const footerY = doc.page.height - 50;
      text(`Brokket confidential | ${dataset.reportDate}`, MARGIN, footerY, { width: contentWidth / 2 });
      text(`Page ${page + 1} of ${range.count}`, MARGIN + contentWidth / 2, footerY, { width: contentWidth / 2, align: 'right' });
    }
    doc.end();
  });
}

module.exports = { createPdf, generateSummary, change, number, money, queryCost, geographyRows };
