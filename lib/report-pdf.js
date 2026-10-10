const PDFDocument = require('pdfkit');

const C = { ink: '#0b1917', muted: '#6f7d79', lime: '#b7ef35', blue: '#64a8ff', violet: '#856ee8', line: '#dfe6df', paper: '#f5f7f3', red: '#d65b55', white: '#ffffff' };
const number = value => new Intl.NumberFormat('en-IN').format(Number(value) || 0);
const money = value => `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
const n = value => Number(value) || 0;

function change(current, previous) {
  const c = n(current), p = n(previous);
  if (!p) return c ? 'New' : '0.0%';
  const value = (c - p) / Math.abs(p) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function valueAt(source, path, fallback = null) {
  return path.split('.').reduce((value, key) => value?.[key], source) ?? fallback;
}

function generateSummary(data) {
  const c = data.current, p = data.previous;
  const metrics = [
    ['New users', valueAt(c, 'overview.newUsersInRange'), valueAt(p, 'overview.newUsersInRange')],
    ['New listings', valueAt(c, 'overview.newListingsInRange'), valueAt(p, 'overview.newListingsInRange')],
    ['Successful login users', valueAt(c, 'logins.uniqueActiveUsers'), valueAt(p, 'logins.uniqueActiveUsers')],
    ['Mandate/Requirement likes', valueAt(c, 'likes.totalLikesInRange'), valueAt(p, 'likes.totalLikesInRange')],
    ['Interactions', valueAt(c, 'activity.totalInteractions'), valueAt(p, 'activity.totalInteractions')],
    ['Revenue', valueAt(c, 'subscriptions.revenueInRange'), valueAt(p, 'subscriptions.revenueInRange')],
  ];
  const ranked = metrics.filter(([, current, previous]) => current != null && previous != null).map(([label, current, previous]) => ({ label, current: n(current), delta: n(previous) ? (n(current) - n(previous)) / Math.abs(n(previous)) * 100 : null }));
  const improved = ranked.filter(item => item.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const declined = ranked.filter(item => item.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const lines = [`${number(valueAt(c, 'overview.newUsersInRange'))} new users, ${number(valueAt(c, 'overview.newListingsInRange'))} new listings and ${number(valueAt(c, 'logins.uniqueActiveUsers'))} unique successful login users were recorded.`];
  if (improved) lines.push(`Strongest day-over-day improvement: ${improved.label} (${improved.delta.toFixed(1)}%).`);
  if (declined) lines.push(`Largest decline requiring attention: ${declined.label} (${declined.delta.toFixed(1)}%).`);
  if (c.errors?.length) lines.push(`${c.errors.length} data source section(s) were unavailable and are disclosed in the Data Quality section.`);
  return lines;
}

function createPdf(dataset) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 38, bufferPages: true, info: { Title: `Brokket Daily Performance Report - ${dataset.reportDate}`, Author: 'Brokket CEO Dashboard' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    const width = doc.page.width - 76;
    const pageBottom = () => doc.page.height - 52;
    const ensure = height => { if (doc.y + height > pageBottom()) doc.addPage(); };
    const section = (index, title, subtitle = '') => {
      ensure(58); doc.moveDown(0.5); doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text(`${String(index).padStart(2, '0')} · ${title.toUpperCase()}`, 38);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(19).text(title, 38, doc.y + 5);
      if (subtitle) doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(subtitle, 38, doc.y + 3);
      doc.moveDown(0.6);
    };
    const cards = rows => {
      const columns = 3, gap = 8, cardWidth = (width - gap * (columns - 1)) / columns, cardHeight = 62;
      rows.forEach((row, index) => {
        if (index % columns === 0) ensure(cardHeight + 10);
        const x = 38 + (index % columns) * (cardWidth + gap), y = doc.y;
        doc.roundedRect(x, y, cardWidth, cardHeight, 8).fillAndStroke(index === 0 ? C.ink : C.white, index === 0 ? C.ink : C.line);
        doc.fillColor(index === 0 ? '#aab7b2' : C.muted).font('Helvetica-Bold').fontSize(7).text(row.label.toUpperCase(), x + 11, y + 10, { width: cardWidth - 22 });
        doc.fillColor(index === 0 ? C.white : C.ink).font('Helvetica-Bold').fontSize(16).text(row.value, x + 11, y + 25, { width: cardWidth - 22 });
        if (row.note) doc.fillColor(index === 0 ? '#aab7b2' : C.muted).font('Helvetica').fontSize(7).text(row.note, x + 11, y + 47, { width: cardWidth - 22 });
        if (index % columns === columns - 1 || index === rows.length - 1) doc.y = y + cardHeight + 8;
      });
    };
    const comparisonChart = rows => {
      rows = rows.filter(row => row.current !== null && row.current !== undefined && row.previous !== null && row.previous !== undefined);
      if (!rows.length) { ensure(26); doc.fillColor(C.muted).font('Helvetica').fontSize(8).text('Comparison unavailable from the source APIs.'); doc.moveDown(0.6); return; }
      ensure(150); const x = 54, startY = doc.y + 8, labelWidth = 105, chartWidth = width - labelWidth - 35;
      const max = Math.max(1, ...rows.flatMap(row => [n(row.current), n(row.previous)]));
      rows.forEach((row, index) => {
        const y = startY + index * 24;
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(7).text(row.label, x, y + 3, { width: labelWidth - 6 });
        doc.roundedRect(x + labelWidth, y, Math.max(2, n(row.current) / max * chartWidth), 7, 3).fill(C.lime);
        doc.roundedRect(x + labelWidth, y + 10, Math.max(2, n(row.previous) / max * chartWidth), 5, 2).fill(C.blue);
        doc.fillColor(C.muted).font('Helvetica').fontSize(6).text(`${number(row.current)} | prev ${number(row.previous)} (${change(row.current, row.previous)})`, x + labelWidth + 3, y + 1, { width: chartWidth - 4, align: 'right' });
      });
      doc.y = startY + rows.length * 24 + 6;
    };
    const table = (headers, rows, widths) => {
      const total = widths.reduce((a, b) => a + b, 0); const scaled = widths.map(value => value / total * width); const rowHeight = 22;
      const drawRow = (values, header = false) => {
        ensure(rowHeight + (header ? 0 : 1)); const y = doc.y; let x = 38;
        if (header) doc.rect(38, y, width, rowHeight).fill(C.ink); else doc.rect(38, y, width, rowHeight).fillAndStroke(doc._rowShade ? '#f8faf7' : C.white, C.line);
        values.forEach((value, index) => { doc.fillColor(header ? C.white : C.ink).font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 7 : 7).text(String(value ?? '—'), x + 5, y + 7, { width: scaled[index] - 10, ellipsis: true }); x += scaled[index]; });
        doc.y = y + rowHeight; doc._rowShade = !doc._rowShade;
      };
      drawRow(headers, true); rows.forEach(row => { if (doc.y + rowHeight > pageBottom()) { doc.addPage(); drawRow(headers, true); } drawRow(row); });
      doc.moveDown(0.4);
    };

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.paper);
    doc.roundedRect(38, 38, width, 126, 15).fill(C.ink);
    doc.fillColor(C.lime).font('Helvetica-Bold').fontSize(10).text('BROKKET · EXECUTIVE INTELLIGENCE', 58, 58);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(27).text('Daily Performance Report', 58, 80);
    doc.fillColor('#aab7b2').font('Helvetica').fontSize(10).text(`Reporting date ${dataset.reportDate} · compared with ${dataset.previousDate}`, 58, 119);
    doc.fillColor('#aab7b2').fontSize(8).text(`Generated ${new Date(dataset.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 58, 139);
    doc.y = 184;
    section(1, 'Executive summary', 'Independent API snapshot for the reporting date');
    generateSummary(dataset).forEach(line => { doc.fillColor(C.ink).font('Helvetica').fontSize(10).text(`• ${line}`, { lineGap: 3 }); doc.moveDown(0.35); });

    const c = dataset.current, p = dataset.previous;
    section(2, 'Headline KPIs', 'Current day values with day-over-day change');
    cards([
      { label: 'Total users', value: number(valueAt(c, 'overview.totalUsers')), note: 'all time' }, { label: 'New users', value: number(valueAt(c, 'overview.newUsersInRange')), note: change(valueAt(c, 'overview.newUsersInRange'), valueAt(p, 'overview.newUsersInRange')) },
      { label: 'Unique logins', value: number(valueAt(c, 'logins.uniqueActiveUsers')), note: change(valueAt(c, 'logins.uniqueActiveUsers'), valueAt(p, 'logins.uniqueActiveUsers')) }, { label: 'Active listings', value: number(valueAt(c, 'overview.totalActiveListings')), note: 'all time' },
      { label: 'New listings', value: number(valueAt(c, 'overview.newListingsInRange')), note: change(valueAt(c, 'overview.newListingsInRange'), valueAt(p, 'overview.newListingsInRange')) }, { label: 'Tracked likes', value: number(valueAt(c, 'likes.totalLikesInRange')), note: change(valueAt(c, 'likes.totalLikesInRange'), valueAt(p, 'likes.totalLikesInRange')) },
    ]);
    comparisonChart([
      { label: 'New users', current: valueAt(c, 'overview.newUsersInRange'), previous: valueAt(p, 'overview.newUsersInRange') }, { label: 'Unique logins', current: valueAt(c, 'logins.uniqueActiveUsers'), previous: valueAt(p, 'logins.uniqueActiveUsers') },
      { label: 'New listings', current: valueAt(c, 'overview.newListingsInRange'), previous: valueAt(p, 'overview.newListingsInRange') }, { label: 'Tracked likes', current: valueAt(c, 'likes.totalLikesInRange'), previous: valueAt(p, 'likes.totalLikesInRange') },
    ]);

    section(3, 'App analytics', 'Amplitude daily active users, real-time users and downloads');
    cards([
      { label: 'Daily Active Users', value: c.amplitude ? number(c.amplitude.dau) : 'Unavailable', note: 'DAU' }, { label: 'Live users', value: c.amplitude?.liveUsers == null ? 'Unavailable' : number(c.amplitude.liveUsers), note: 'latest processed interval' },
      { label: 'Total downloads', value: c.amplitude?.totalDownloads == null ? 'Unavailable' : number(c.amplitude.totalDownloads), note: 'unique installs' }, { label: 'Android downloads', value: c.amplitude?.androidDownloads == null ? 'Unavailable' : number(c.amplitude.androidDownloads) },
      { label: 'iOS downloads', value: c.amplitude?.iosDownloads == null ? 'Unavailable' : number(c.amplitude.iosDownloads) }, { label: 'DAU vs previous', value: change(c.amplitude?.dau, p.amplitude?.dau), note: `previous ${number(p.amplitude?.dau)}` },
    ]);
    comparisonChart([
      { label: 'Daily active users', current: c.amplitude?.dau, previous: p.amplitude?.dau },
      { label: 'Total downloads', current: c.amplitude?.totalDownloads, previous: p.amplitude?.totalDownloads },
      { label: 'Android', current: c.amplitude?.androidDownloads, previous: p.amplitude?.androidDownloads },
      { label: 'iOS', current: c.amplitude?.iosDownloads, previous: p.amplitude?.iosDownloads },
    ]);

    section(4, 'Marketplace inventory', 'Listing mix, velocity and top contributors');
    cards(Object.entries(c.listingTypes || {}).map(([label, value]) => ({ label, value: number(value), note: 'new listings' })));
    const listingPoints = c.listingTrend || [];
    if (listingPoints.length) comparisonChart(listingPoints.slice(-6).map(point => ({ label: point.label, current: point.count, previous: 0 })));
    table(['Contributor', 'User', 'Listings'], (c.contributors || []).map(item => [item.fullName || 'Unnamed', `•••• ${String(item.username || '').slice(-4)}`, number(item.count)]), [3, 2, 1]);

    section(5, 'Demand & property activity', 'Intent signals, buyer actions and query cost');
    cards([
      { label: 'Mandate/Requirement likes', value: number(valueAt(c, 'likes.totalLikesInRange')), note: change(valueAt(c, 'likes.totalLikesInRange'), valueAt(p, 'likes.totalLikesInRange')) },
      { label: 'Called', value: c.activity ? number(c.activity.called) : 'Unavailable' }, { label: 'WhatsApped', value: c.activity ? number(c.activity.whatsapped) : 'Unavailable' },
      { label: 'Shared', value: c.activity ? number(c.activity.shared) : 'Unavailable' }, { label: 'All interactions', value: c.activity ? number(c.activity.totalInteractions) : 'Unavailable', note: change(c.activity?.totalInteractions, p.activity?.totalInteractions) },
      { label: 'Total query cost', value: c.activity ? money(c.activity.totalQueryCost) : 'Unavailable', note: change(c.activity?.totalQueryCost, p.activity?.totalQueryCost) },
    ]);
    comparisonChart([
      { label: 'Tracked likes', current: valueAt(c, 'likes.totalLikesInRange'), previous: valueAt(p, 'likes.totalLikesInRange') },
      { label: 'Calls', current: c.activity?.called, previous: p.activity?.called }, { label: 'WhatsApp', current: c.activity?.whatsapped, previous: p.activity?.whatsapped },
      { label: 'Shares', current: c.activity?.shared, previous: p.activity?.shared }, { label: 'Query cost', current: c.activity?.totalQueryCost, previous: p.activity?.totalQueryCost },
    ]);

    section(6, 'Subscriptions & revenue', 'Purchases, renewals, customers, plans and autopay');
    cards([
      { label: 'Active paid', value: number(valueAt(c, 'subscriptions.totalActiveSubscribers')) }, { label: 'Including trials', value: number(valueAt(c, 'subscriptions.totalActiveIncludingTrial')) },
      { label: 'Autopay on', value: number(valueAt(c, 'subscriptions.autopayOnCount')) }, { label: 'Customers who paid', value: number(valueAt(c, 'subscriptions.totalUniquePayingSubscribersAllTime')), note: 'unique all time' },
      { label: 'Payment transactions', value: number(valueAt(c, 'subscriptions.totalSubscriptionsSoldAllTime')), note: 'purchases + renewals' }, { label: 'Revenue', value: money(valueAt(c, 'subscriptions.revenueInRange')), note: change(valueAt(c, 'subscriptions.revenueInRange'), valueAt(p, 'subscriptions.revenueInRange')) },
    ]);
    comparisonChart([
      { label: 'New purchases', current: valueAt(c, 'subscriptions.newPurchasesInRange'), previous: valueAt(p, 'subscriptions.newPurchasesInRange') },
      { label: 'Renewals', current: valueAt(c, 'subscriptions.renewalsInRange'), previous: valueAt(p, 'subscriptions.renewalsInRange') },
      { label: 'Net revenue', current: valueAt(c, 'subscriptions.revenueInRange'), previous: valueAt(p, 'subscriptions.revenueInRange') },
    ]);
    table(['Plan', 'Code', 'Active', 'Tracked revenue'], (c.subscriptions?.byPlan || []).map(plan => [plan.planName || plan.planCode, plan.planCode, number(plan.activeSubscribers), money(plan.totalRevenueAllTime)]), [3, 1.5, 1.2, 2]);
    table(['Subscriber', 'Plan', 'Cycle', 'Autopay', 'Status', 'Expiry'], (c.roster?.content || []).map(item => [item.fullName || 'Unnamed', item.planName || item.planCode, item.subscriptionPlanType || '—', item.autopayOn ? 'On' : 'Off', item.recurringStatus || item.displayStatus || 'One-time', String(item.expiryDate || '—').slice(0, 10)]), [2.4, 1.8, 1.3, 1, 1.4, 1.4]);

    section(7, 'Content performance', 'Feed and media activity');
    cards([
      { label: 'Feed posts', value: number(valueAt(c, 'content.feedPostsInRange')), note: change(valueAt(c, 'content.feedPostsInRange'), valueAt(p, 'content.feedPostsInRange')) },
      { label: 'Picture posts', value: number(valueAt(c, 'content.picturesUploadedInRange')), note: change(valueAt(c, 'content.picturesUploadedInRange'), valueAt(p, 'content.picturesUploadedInRange')) },
      { label: 'Unique creators', value: number(valueAt(c, 'content.uniqueContentCreatorsInRange')), note: change(valueAt(c, 'content.uniqueContentCreatorsInRange'), valueAt(p, 'content.uniqueContentCreatorsInRange')) },
      { label: 'Circle activity', value: 'Unavailable', note: 'not exposed by API' }, { label: 'Clips', value: 'Unavailable', note: 'not exposed by API' }, { label: 'Blinks', value: 'Unavailable', note: 'not exposed by API' },
    ]);
    comparisonChart([
      { label: 'Feed posts', current: valueAt(c, 'content.feedPostsInRange'), previous: valueAt(p, 'content.feedPostsInRange') },
      { label: 'Picture posts', current: valueAt(c, 'content.picturesUploadedInRange'), previous: valueAt(p, 'content.picturesUploadedInRange') },
      { label: 'Unique creators', current: valueAt(c, 'content.uniqueContentCreatorsInRange'), previous: valueAt(p, 'content.uniqueContentCreatorsInRange') },
    ]);

    section(8, 'Geography', 'All valid city-attributed results; unknown/null/other excluded');
    const cityMaps = ['usersByCity', 'loginsByCity', 'listingsByCity', 'likesByCity'].map(key => Object.fromEntries((c[key] || []).filter(row => row.cityCode).map(row => [String(row.cityCode).toLowerCase(), row])));
    const codes = [...new Set(cityMaps.flatMap(map => Object.keys(map)))].filter(code => !['unknown', 'unk', 'null', 'other'].includes(code));
    const cityRows = codes.map(code => { const src = cityMaps.find(map => map[code])?.[code] || {}; return [src.cityName || code, number(cityMaps[0][code]?.count), number(cityMaps[1][code]?.count), number(cityMaps[2][code]?.count), number(cityMaps[3][code]?.count)]; }).sort((a, b) => n(b[1]) + n(b[2]) + n(b[3]) + n(b[4]) - n(a[1]) - n(a[2]) - n(a[3]) - n(a[4]));
    table(['City', 'New users', 'Logins', 'Listings', 'Likes'], cityRows, [2.5, 1.2, 1.2, 1.2, 1.2]);

    section(9, 'Data quality & delivery notes', 'No dummy, estimated or hardcoded metric values');
    const issues = [...(c.errors || []), ...(p.errors || [])];
    const notes = issues.length ? issues.map(issue => [issue.section, issue.message]) : [['All queried sections', 'Available at generation time']];
    notes.push(['Circle activity / Clips / Blinks', 'Not exposed by current dashboard APIs; intentionally not estimated.']);
    if (!c.amplitude?.downloadsAvailable) notes.push(['App downloads', 'Amplitude install event unavailable; no value reported.']);
    table(['Section', 'Status / explanation'], notes, [2, 5]);

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page); doc.fillColor(C.muted).font('Helvetica').fontSize(7).text(`Brokket confidential · ${dataset.reportDate}`, 38, doc.page.height - 30, { width: width / 2 });
      doc.text(`Page ${page + 1} of ${range.count}`, 38 + width / 2, doc.page.height - 30, { width: width / 2, align: 'right' });
    }
    doc.end();
  });
}

module.exports = { createPdf, generateSummary, change, number, money };
