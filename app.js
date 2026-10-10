const API = '/api/proxy';
const state = { data: null, live: false, groupBy: 'day', cityNames: {}, rosterPage: 0, rosterAutopay: '', customRange: null, lastPreset: '30' };
const fmt = n => new Intl.NumberFormat('en-IN').format(n ?? 0);
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n ?? 0);
const crore = n => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format((Number(n) || 0) / 10000000)} Cr`;
const qs = s => document.querySelector(s);

function dateRange() {
  if (qs('#periodSelect').value === 'custom') {
    const today = istToday();
    return state.customRange ? { ...state.customRange } : { fromDate: today, toDate: today };
  }
  const days = Number(qs('#periodSelect').value);
  const toDate = istToday();
  const from = new Date(`${toDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { fromDate: from.toISOString().slice(0, 10), toDate };
}

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function openCustomDatePanel() {
  const today = istToday();
  const range = state.customRange || { fromDate: today, toDate: today };
  qs('#customFromDate').max = today;
  qs('#customToDate').max = today;
  qs('#customFromDate').value = range.fromDate;
  qs('#customToDate').value = range.toDate;
  qs('#customDateError').textContent = '';
  qs('#customDatePanel').hidden = false;
}

function closeCustomDatePanel() {
  qs('#customDatePanel').hidden = true;
  if (!state.customRange && qs('#periodSelect').value === 'custom') qs('#periodSelect').value = state.lastPreset;
}
function params(extra = {}, options = {}) {
  const p = new URLSearchParams(options.dates === false ? extra : { ...dateRange(), ...extra });
  const city = qs('#citySelect').value;
  if (city && options.city !== false) p.set('cityCode', city);
  return p;
}
async function api(path, extra = {}, options = {}) {
  const query = params(extra, options);
  query.set('route', path.replace(/^\/+/, ''));
  const response = await fetch(`${API}?${query}`, {
    signal: AbortSignal.timeout(15000),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) {
    lockDashboard('Your session expired. Please sign in again.');
  }
  if (!response.ok || !body?.success) throw new Error(body?.message || `API request failed (${response.status})`);
  return body.data;
}

async function propertyActivityApi() {
  const query = params();
  const response = await fetch(`/api/property-activities?${query}`, {
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) lockDashboard(body?.message || 'Your session expired. Please sign in again.');
  if (!response.ok || !body?.success) throw new Error(body?.message || `Property activity request failed (${response.status})`);
  return body.data;
}

async function amplitudeApi() {
  const query = params({}, { city: false });
  const response = await fetch(`/api/amplitude?${query}`, {
    signal: AbortSignal.timeout(25000), cache: 'no-store', credentials: 'same-origin'
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) lockDashboard('Your session expired. Please sign in again.');
  if (!response.ok || !body?.success) throw new Error(body?.message || `Amplitude request failed (${response.status})`);
  return body.data;
}

async function amplitudeLiveApi() {
  const query = params({ liveOnly: '1' }, { city: false });
  const response = await fetch(`/api/amplitude?${query}`, {
    signal: AbortSignal.timeout(25000), cache: 'no-store', credentials: 'same-origin'
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) lockDashboard('Your session expired. Please sign in again.');
  if (!response.ok || !body?.success) throw new Error(body?.message || `Amplitude request failed (${response.status})`);
  return body.data;
}

function unlockDashboard() {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('authenticated');
  qs('#loginError').textContent = '';
}

function lockDashboard(message = '') {
  document.body.classList.remove('authenticated');
  document.body.classList.add('auth-pending');
  qs('#loginError').textContent = message;
  qs('#loginPassword').value = '';
  window.setTimeout(() => qs('#loginNumber').focus(), 50);
}

async function startDashboard() {
  const response = await fetch('/api/auth', { cache: 'no-store' });
  const session = await response.json().catch(() => ({}));
  if (!session.authenticated) {
    lockDashboard();
    return;
  }
  unlockDashboard();
  await loadCities().catch(() => {});
  await refresh();
  scheduleAutoRefresh();
  scrollToCurrentSection();
}

function scheduleAutoRefresh() {
  window.clearInterval(window.dashboardRefreshTimer);
  window.clearInterval(window.amplitudeLiveRefreshTimer);
  window.dashboardRefreshTimer = window.setInterval(() => {
    if (document.body.classList.contains('authenticated') && !qs('#refreshBtn').classList.contains('loading')) refresh();
  }, 5 * 60 * 1000);
  window.amplitudeLiveRefreshTimer = window.setInterval(() => {
    if (document.body.classList.contains('authenticated')) refreshAmplitudeLive();
  }, 60 * 1000);
}

function scrollToCurrentSection() {
  const target = window.location.hash && document.querySelector(window.location.hash);
  if (target) target.scrollIntoView({ block: 'start' });
}
async function loadCities() {
  const cities = await api('/filters/cities');
  state.cityNames = Object.fromEntries(cities.map(city => [normalizeCityCode(city.cityCode), city.cityName.trim()]));
  const select = qs('#citySelect');
  const selected = select.value;
  select.innerHTML = '<option value="">All cities</option>' +
    cities.map(c => `<option value="${c.cityCode}">${c.cityName}</option>`).join('');
  select.value = selected;
}

function normalizeCityCode(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function cleanCityName(value, code) {
  const canonical = state.cityNames[code];
  if (canonical) return canonical;
  const name = String(value || '').trim();
  if (name && !/^unknown$/i.test(name) && !/^null$/i.test(name)) return name;
  return code.split('_').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

function groupCityRows(rows = []) {
  const grouped = {};
  let excluded = 0;
  for (const row of rows) {
    const code = normalizeCityCode(row.cityCode);
    const count = Number(row.count) || 0;
    if (!code || ['unknown', 'unk', 'null', 'other'].includes(code)) {
      excluded += count;
      continue;
    }
    if (!grouped[code]) grouped[code] = { code, name: cleanCityName(row.cityName, code), count: 0 };
    grouped[code].count += count;
  }
  return { grouped, excluded };
}
function rangeBuckets() {
  const { fromDate, toDate } = dateRange();
  const buckets = [];
  if (state.groupBy === 'month') {
    const cursor = new Date(`${fromDate.slice(0, 7)}-01T00:00:00Z`);
    const end = toDate.slice(0, 7);
    while (cursor.toISOString().slice(0, 7) <= end) {
      buckets.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const cursor = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (cursor <= end) {
      buckets.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return buckets;
}

function dailyBuckets(fromDate, toDate) {
  const buckets = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    buckets.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function normalizeTemporalRows(rows = [], valueKey = 'count', domain = rangeBuckets()) {
  const byLabel = new Map();
  for (const row of rows) {
    const rawLabel = String(row?.label || '');
    const label = state.groupBy === 'month' && domain[0]?.length === 7 ? rawLabel.slice(0, 7) : rawLabel.slice(0, 10);
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) || 0) + (Number(row?.[valueKey]) || 0));
  }
  return domain.map(label => ({ label, [valueKey]: byLabel.get(label) || 0 }));
}

function pointX(index, length, start, end) {
  return length <= 1 ? (start + end) / 2 : start + index * (end - start) / (length - 1);
}

function bucketLabel(label) {
  if (state.groupBy === 'month') {
    return new Date(`${label}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return new Date(`${label}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function chart(svgId, aRows = [], bRows = null, compact = false) {
  const svg = qs(svgId), h = compact ? 180 : 260, w = 760, p = 30;
  if (!aRows.length && (!bRows || !bRows.length)) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No activity in this range</text>';
    return;
  }
  const domain = rangeBuckets();
  const values = rows => normalizeTemporalRows(rows, 'count', domain).map(row => row.count);
  const a = values(aRows), b = bRows ? values(bRows) : null;
  const all = b ? [...a, ...b] : a;
  const max = Math.max(1, ...all) * 1.12;
  const pts = vals => vals.map((v, i) => [pointX(i, vals.length, p, w - p), h - p - (v / max) * (h - p * 2)]);
  const path = vals => pts(vals).map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const area = vals => vals.length > 1 ? `${path(vals)} L${w-p},${h-p} L${p},${h-p} Z` : '';
  const grids = [0,.25,.5,.75,1].map(v => `<line class="grid-line" x1="${p}" y1="${p+v*(h-p*2)}" x2="${w-p}" y2="${p+v*(h-p*2)}"/><text class="axis-label" x="2" y="${p+v*(h-p*2)+4}">${Math.round(max*(1-v))}</text>`).join('');
  const step = Math.max(1, Math.ceil(domain.length / 5));
  const labels = domain.map((label,i) => i % step === 0 || i === domain.length - 1 ? `<text class="axis-label" text-anchor="middle" x="${pointX(i,domain.length,p,w-p)}" y="${h-5}">${bucketLabel(label)}</text>` : '').join('');
  const showCounts = domain.length <= 12;
  const points = (vals, series, name, offset) => pts(vals).map(([x,y],i) => {
    const labelY = Math.max(12, Math.min(h - 10, y + offset));
    return `<g><circle class="chart-point ${series}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${bucketLabel(domain[i])} · ${name}: ${fmt(vals[i])}</title></circle>${showCounts ? `<text class="chart-value ${series}" text-anchor="middle" x="${x.toFixed(1)}" y="${labelY.toFixed(1)}">${fmt(vals[i])}</text>` : ''}</g>`;
  }).join('');
  const areaMarkup = a.length > 1 ? `<path class="${b?'area-a':'area-like'}" d="${area(a)}"/>` : '';
  svg.innerHTML = `<defs><linearGradient id="limeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8df2d" stop-opacity=".18"/><stop offset="1" stop-color="#a8df2d" stop-opacity="0"/></linearGradient><linearGradient id="violetFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b87ff" stop-opacity=".22"/><stop offset="1" stop-color="#9b87ff" stop-opacity="0"/></linearGradient></defs>${grids}${areaMarkup}<path class="${b?'line-a':'line-like'}" d="${path(a)}"/>${points(a,b?'registration':'like',b?'Registrations':'Likes',-10)}${b?`<path class="line-b" d="${path(b)}"/>${points(b,'login','Logins',16)}`:''}${labels}`;
}

function renderRevenueChart(points = []) {
  const svg = qs('#revenueChart'), w = 760, h = 210, p = 34;
  if (!points.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No revenue activity in this range</text>';
    return;
  }
  points = normalizeTemporalRows(points, 'amount');
  const values = points.map(point => Number(point.amount) || 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), range = Math.max(1, max - min);
  const y = value => p + (max - value) / range * (h - p * 2);
  const baseline = y(0), slot = (w - p * 2) / values.length, barWidth = Math.max(1, Math.min(28, slot * 0.58));
  const bars = values.map((value, index) => {
    const top = Math.min(y(value), baseline), height = value ? Math.max(2, Math.abs(y(value) - baseline)) : 0;
    return `<rect class="revenue-bar ${value < 0 ? 'negative' : ''}" x="${(p + index * slot + (slot - barWidth) / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="4"><title>${points[index].label}: ${money(value)}</title></rect>`;
  }).join('');
  const step = Math.max(1, Math.ceil(points.length / 5));
  const labels = points.map((point,index) => index % step === 0 || index === points.length - 1 ? `<text class="axis-label" text-anchor="middle" x="${(p + index * slot + slot / 2).toFixed(1)}" y="${h - 6}">${bucketLabel(point.label)}</text>` : '').join('');
  svg.innerHTML = `<line class="grid-line" x1="${p}" y1="${baseline}" x2="${w-p}" y2="${baseline}"/>${bars}${labels}`;
}

function renderActivityCostChart(data) {
  const rawPoints = data.dailyCosts || [];
  const svg = qs('#activityCostChart'), w = 760, h = 210, p = 34;
  if (!rawPoints.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No query cost activity in this range</text>';
    qs('#latestDailyCost').textContent = '—';
    return;
  }
  const activityDomain = dailyBuckets(data.trendFromDate || rawPoints[0].label, dateRange().toDate);
  const amounts = new Map(rawPoints.map(point => [String(point.label).slice(0, 10), point]));
  const points = activityDomain.map(label => ({ label, amount: Number(amounts.get(label)?.amount) || 0, interactions: Number(amounts.get(label)?.interactions) || 0 }));
  const values = points.map(point => Number(point.amount) || 0);
  const max = Math.max(1, ...values), slot = (w - p * 2) / values.length;
  const barWidth = Math.max(5, Math.min(28, slot * 0.58));
  const bars = values.map((value, index) => {
    const height = value ? Math.max(2, value / max * (h - p * 2)) : 0;
    const x = p + index * slot + (slot - barWidth) / 2;
    const y = h - p - height;
    return `<rect class="activity-cost-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="4"><title>${formatDate(points[index].label)} · ${crore(value)} · ${fmt(points[index].interactions)} interactions</title></rect>`;
  }).join('');
  const step = Math.max(1, Math.ceil(points.length / 5));
  const labels = points.map((point, index) => index % step === 0 || index === points.length - 1
    ? `<text class="axis-label" text-anchor="middle" x="${(p + index * slot + slot / 2).toFixed(1)}" y="${h - 6}">${point.label.slice(5)}</text>` : '').join('');
  const grids = [0, .5, 1].map(value => `<line class="grid-line" x1="${p}" y1="${p + value * (h - p * 2)}" x2="${w - p}" y2="${p + value * (h - p * 2)}"/>`).join('');
  svg.innerHTML = `${grids}${bars}${labels}`;
  qs('#latestDailyCost').textContent = crore(values[values.length - 1]);
}

function renderPropertyActivity(data) {
  qs('#activityCalled').textContent = fmt(data.called);
  qs('#activityWhatsapped').textContent = fmt(data.whatsapped);
  qs('#activityShared').textContent = fmt(data.shared);
  qs('#activityTotal').textContent = fmt(data.totalInteractions);
  qs('#activityCost').textContent = crore(data.totalQueryCost);
  const componentTotal = ['called', 'whatsapped', 'shared', 'clicked'].reduce((total, key) => total + (Number(data[key]) || 0), 0);
  const reconciles = componentTotal === Number(data.totalInteractions);
  qs('#activityError').hidden = reconciles;
  qs('#activityError').textContent = reconciles ? '' :
    `Data quality warning: action types total ${fmt(componentTotal)}, but the backend reports ${fmt(data.totalInteractions)} interactions.`;
  const scope = data.trendLimited
    ? `Daily cost from ${formatDate(data.trendFromDate)} · last ${data.trendDays} days of selected period`
    : 'Daily cost for the selected period';
  qs('#activityTrendScope').textContent = data.dailyCostIncomplete ? `${scope} · partial backend data` : scope;
  renderActivityCostChart(data);
}

function renderAmplitudeChart(selector, primary = [], secondary = null) {
  const svg = qs(selector), w = 760, h = 210, p = 34;
  if (!primary.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No Amplitude activity in this range</text>';
    return;
  }
  const { fromDate, toDate } = dateRange();
  const domain = dailyBuckets(fromDate, toDate);
  const normalizeDaily = rows => {
    const byDate = new Map(rows.map(point => [String(point.label).slice(0, 10), Number(point.count) || 0]));
    return domain.map(label => ({ label, count: byDate.get(label) || 0 }));
  };
  primary = normalizeDaily(primary);
  secondary = secondary ? normalizeDaily(secondary) : null;
  const labels = primary.map(point => point.label);
  const first = primary.map(point => Number(point.count) || 0);
  const second = secondary ? secondary.map(point => Number(point.count) || 0) : null;
  const max = Math.max(1, ...first, ...(second || []));
  const x = index => pointX(index, labels.length, p, w - p);
  const y = value => h - p - value / max * (h - p * 2);
  const path = values => values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const grids = [0, .5, 1].map(value => `<line class="grid-line" x1="${p}" y1="${p + value * (h - p * 2)}" x2="${w - p}" y2="${p + value * (h - p * 2)}"/>`).join('');
  const step = Math.max(1, Math.ceil(labels.length / 5));
  const axisLabels = labels.map((label, index) => index % step === 0 || index === labels.length - 1
    ? `<text class="axis-label" text-anchor="middle" x="${x(index).toFixed(1)}" y="${h - 6}">${String(label).slice(5)}</text>` : '').join('');
  const dots = (values, className, title) => values.map((value, index) =>
    `<circle class="chart-point ${className}" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3"><title>${formatDate(labels[index])} · ${title}: ${fmt(value)}</title></circle>`).join('');
  svg.innerHTML = `${grids}<path class="line-a" d="${path(first)}"/>${dots(first, 'registration', secondary ? 'Android' : 'Active users')}${second ? `<path class="line-b" d="${path(second)}"/>${dots(second, 'login', 'iOS')}` : ''}${axisLabels}`;
}

function renderDauChart(points = []) {
  const svg = qs('#dauChart'), w = 900, h = 300, left = 58, right = 28, top = 28, bottom = 46;
  if (!points.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No active-user activity in this range</text>';
    return;
  }
  const { fromDate, toDate } = dateRange();
  const domain = dailyBuckets(fromDate, toDate);
  const byDate = new Map(points.map(point => [String(point.label).slice(0, 10), Number(point.count) || 0]));
  points = domain.map(label => ({ label, count: byDate.get(label) || 0 }));
  const values = points.map(point => Number(point.count) || 0);
  const maxValue = Math.max(1, ...values);
  const ceiling = Math.max(100, Math.ceil(maxValue / 100) * 100);
  const x = index => pointX(index, points.length, left, w - right);
  const y = value => top + (ceiling - value) / ceiling * (h - top - bottom);
  const coordinates = values.map((value, index) => ({ x: x(index), y: y(value) }));
  const linePath = coordinates.reduce((path, point, index) => {
    if (!index) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const previous = coordinates[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C${midpoint.toFixed(1)},${previous.y.toFixed(1)} ${midpoint.toFixed(1)},${point.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, '');
  const baseY = h - bottom;
  const areaPath = points.length > 1 ? `${linePath} L${coordinates.at(-1).x.toFixed(1)},${baseY} L${coordinates[0].x.toFixed(1)},${baseY} Z` : '';
  const yTicks = [0, .25, .5, .75, 1].map(ratio => {
    const value = Math.round(ceiling * (1 - ratio));
    const lineY = top + ratio * (h - top - bottom);
    return `<line class="dau-grid" x1="${left}" y1="${lineY}" x2="${w - right}" y2="${lineY}"/><text class="dau-axis" text-anchor="end" x="${left - 12}" y="${lineY + 4}">${fmt(value)}</text>`;
  }).join('');
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const xTicks = points.map((point, index) => index % labelStep === 0 || index === points.length - 1
    ? `<text class="dau-axis" text-anchor="middle" x="${x(index).toFixed(1)}" y="${h - 12}">${formatDate(point.label).replace(/\s\d{4}$/, '')}</text>` : '').join('');
  const peakIndex = values.indexOf(maxValue), latestIndex = values.length - 1;
  const markers = coordinates.map((point, index) => `<circle class="dau-hit" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="10"><title>${formatDate(points[index].label)} · ${fmt(values[index])} active users</title></circle>`).join('');
  const badge = (index, label, className) => {
    const point = coordinates[index], badgeY = Math.max(18, point.y - 18);
    return `<g class="dau-marker ${className}"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6"/><circle class="pulse" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="11"/><text text-anchor="middle" x="${point.x.toFixed(1)}" y="${badgeY.toFixed(1)}">${label} · ${fmt(values[index])}</text></g>`;
  };
  svg.innerHTML = `<defs><linearGradient id="dauArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9f13b" stop-opacity=".38"/><stop offset=".6" stop-color="#64a8ff" stop-opacity=".09"/><stop offset="1" stop-color="#64a8ff" stop-opacity="0"/></linearGradient><filter id="dauGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${yTicks}${areaPath ? `<path class="dau-area" d="${areaPath}"/>` : ''}<path class="dau-line-glow" d="${linePath}"/><path class="dau-line" d="${linePath}"/>${markers}${badge(peakIndex, points.length === 1 ? 'Today' : 'Peak', 'peak')}${latestIndex !== peakIndex ? badge(latestIndex, 'Latest', 'latest') : ''}${xTicks}`;
}

function renderAmplitude(data) {
  renderAmplitudeLive(data);
  qs('#latestDau').textContent = fmt(data.latestDau);
  qs('#averageDau').textContent = fmt(data.averageDau);
  qs('#peakDau').textContent = fmt(data.peakDau);
  qs('#totalDownloads').textContent = data.downloadsAvailable ? fmt(data.totalDownloads) : '—';
  qs('#androidDownloads').textContent = data.downloadsAvailable ? fmt(data.androidDownloads) : '—';
  qs('#iosDownloads').textContent = data.downloadsAvailable ? fmt(data.iosDownloads) : '—';
  const liveNote = 'Live Events is an immediate ingestion stream; this card uses Amplitude’s supported analytics API and can lag that screen while the 5-minute interval is processed.';
  const downloadNote = !data.downloadsAvailable ? '' : data.otherDownloads
    ? `${fmt(data.otherDownloads)} daily unique installs were reported under platforms other than Android or iOS and are included only in the total.`
    : 'Download total reconciles to the Android and iOS daily series.';
  qs('#amplitudeScopeNote').textContent = [liveNote, downloadNote].filter(Boolean).join(' ');
  const downloadOnly = document.querySelectorAll('.download-only');
  downloadOnly.forEach(element => { element.hidden = !data.downloadsAvailable; });
  qs('#downloadAnalytics').hidden = !data.downloadsAvailable;
  qs('#analyticsKpis').classList.toggle('dau-only', !data.downloadsAvailable);
  qs('.analytics-layout').classList.toggle('dau-only', !data.downloadsAvailable);
  qs('#appAnalyticsTitle').textContent = data.downloadsAvailable ? 'Daily Active Users (DAU) & downloads' : 'Daily Active Users (DAU)';
  qs('#appAnalyticsNote').textContent = data.downloadsAvailable ? 'Amplitude · daily unique users and installs' : 'Amplitude · users active today and historical daily trend';
  const first = data.dau?.[0], last = data.dau?.at(-1);
  qs('#dauRangeSummary').textContent = first && last
    ? `${data.dau.length} daily points · ${formatDate(first.label)} to ${formatDate(last.label)}`
    : 'Unique active users per day';
  renderDauChart(data.dau);
  renderAmplitudeChart('#downloadsChart', data.downloadsAvailable ? data.android : [], data.downloadsAvailable ? data.ios : []);
  qs('#amplitudeError').hidden = true;
  qs('#amplitudeError').textContent = '';
}

function renderAmplitudeLive(data) {
  qs('#liveUsers').textContent = data.liveUsersAvailable ? fmt(data.liveUsers) : '—';
  qs('#liveUsersMeta').textContent = data.liveUsersAvailable
    ? `Latest processed 5-minute interval · ${data.liveUsersAsOf || 'time unavailable'} Amplitude project time · refreshes every 60s`
    : 'Amplitude real-time analytics source unavailable';
}

async function refreshAmplitudeLive() {
  try {
    renderAmplitudeLive(await amplitudeLiveApi());
  } catch (error) {
    qs('#liveUsers').textContent = '—';
    qs('#liveUsersMeta').textContent = 'Amplitude real-time analytics source unavailable';
  }
}

function renderSubscriptions(data) {
  const values = [
    ['#activeSubscribers', data.totalActiveSubscribers], ['#activeIncludingTrial', data.totalActiveIncludingTrial],
    ['#autopayOn', data.autopayOnCount], ['#autopayOff', data.autopayOffCount],
    ['#uniquePayers', data.totalUniquePayingSubscribersAllTime], ['#subscriptionsSold', data.totalSubscriptionsSoldAllTime],
    ['#newPurchases', data.newPurchasesInRange], ['#renewals', data.renewalsInRange]
  ];
  values.forEach(([id, value]) => qs(id).textContent = fmt(value));
  qs('#revenueInRange').textContent = money(data.revenueInRange);
  qs('#revenueAllTime').textContent = money(data.totalRevenueAllTime);
  qs('#planBreakdown').innerHTML = (data.byPlan || []).length ? data.byPlan.map(plan => `<div class="plan-row"><span><b>${plan.planName || plan.planCode}</b><small>${plan.planCode}</small></span><span><b>${fmt(plan.activeSubscribers)}</b><small>${money(plan.totalRevenueAllTime)}</small></span></div>`).join('') : '<p class="section-note">No active plan data</p>';
  qs('#autopayStatus').innerHTML = Object.entries(data.byAutopayStatus || {}).map(([status, count]) => `<span><i></i>${status}<b>${fmt(count)}</b></span>`).join('');
  const paidPlanTotal = (data.byPlan || []).filter(plan => String(plan.planCode).toUpperCase() !== 'TRIAL').reduce((total, plan) => total + (Number(plan.activeSubscribers) || 0), 0);
  const mismatch = paidPlanTotal !== Number(data.totalActiveSubscribers);
  qs('#subscriptionError').hidden = !mismatch;
  qs('#subscriptionError').textContent = mismatch
    ? `Data quality warning: Active paid is ${fmt(data.totalActiveSubscribers)}, but non-trial plan entitlements total ${fmt(paidPlanTotal)}. Treat plan counts as entitlements until the backend definitions are reconciled.`
    : '';
  qs('#subscriptionScopeNote').textContent = `All-city metric. ${data.scopeNote || ''}`;
}

function renderContent(data) {
  qs('#feedPosts').textContent = fmt(data.feedPostsInRange);
  qs('#picturePosts').textContent = fmt(data.picturesUploadedInRange);
  qs('#contentCreators').textContent = fmt(data.uniqueContentCreatorsInRange);
  qs('#contentScopeNote').textContent = data.scopeNote || '';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function renderRoster(data) {
  qs('#rosterRows').innerHTML = (data.content || []).length ? data.content.map(item => `<div class="roster-row" role="row"><span><b>${item.fullName || 'Unnamed subscriber'}</b><small>•••• ${String(item.username || '').slice(-4)}</small></span><span><b>${item.planName || item.planCode || '—'}</b><small>${item.trial ? 'Trial' : item.planCode || ''}</small></span><span>${item.subscriptionPlanType || '—'}</span><span><i class="status-pill ${item.autopayOn ? 'on' : 'off'}">${item.autopayOn ? 'ON' : 'OFF'}</i></span><span>${item.recurringStatus || item.displayStatus || 'One-time'}</span><span>${formatDate(item.expiryDate)}</span></div>`).join('') : '<div class="roster-empty">No active subscribers match this filter.</div>';
  qs('#rosterCount').textContent = `${fmt(data.totalElements)} subscribers`;
  qs('#rosterPage').textContent = `Page ${Number(data.page) + 1} of ${Math.max(1, Number(data.totalPages) || 1)}`;
  qs('#rosterPrev').disabled = Number(data.page) <= 0;
  qs('#rosterNext').disabled = Number(data.page) + 1 >= Number(data.totalPages);
}

async function loadRoster() {
  try {
    const data = await api('/subscriptions/roster', { autopay: state.rosterAutopay, page: state.rosterPage, size: 10 }, { dates: false, city: false });
    renderRoster(data);
  } catch (error) {
    qs('#rosterRows').innerHTML = `<div class="roster-empty">${error.message}</div>`;
    qs('#rosterCount').textContent = 'Roster unavailable';
    qs('#rosterPage').textContent = '—';
    qs('#rosterPrev').disabled = true;
    qs('#rosterNext').disabled = true;
  }
}

async function refreshAddendumData() {
  const [overviewResult, trendResult, contentResult, activityResult, amplitudeResult] = await Promise.allSettled([
    api('/subscriptions/overview', {}, { city: false }),
    api('/subscriptions/revenue-trend', { groupBy: state.groupBy }, { city: false }),
    api('/content/overview', {}, { city: false }),
    propertyActivityApi(),
    amplitudeApi()
  ]);
  if (overviewResult.status === 'fulfilled') {
    qs('#subscriptionError').hidden = true;
    renderSubscriptions(overviewResult.value);
  } else {
    ['#activeSubscribers','#activeIncludingTrial','#autopayOn','#autopayOff','#uniquePayers','#subscriptionsSold','#revenueInRange','#revenueAllTime','#newPurchases','#renewals'].forEach(id => qs(id).textContent = '—');
    qs('#planBreakdown').innerHTML = '';
    qs('#autopayStatus').innerHTML = '';
    qs('#subscriptionScopeNote').textContent = '';
    qs('#subscriptionError').hidden = false;
    qs('#subscriptionError').textContent = `Subscription metrics unavailable: ${overviewResult.reason.message}`;
  }
  if (trendResult.status === 'fulfilled') renderRevenueChart(trendResult.value);
  else renderRevenueChart([]);
  if (contentResult.status === 'fulfilled') {
    qs('#contentError').hidden = true;
    renderContent(contentResult.value);
  } else {
    ['#feedPosts','#picturePosts','#contentCreators'].forEach(id => qs(id).textContent = '—');
    qs('#contentScopeNote').textContent = '';
    qs('#contentError').hidden = false;
    qs('#contentError').textContent = `Content metrics unavailable: ${contentResult.reason.message}`;
  }
  if (activityResult.status === 'fulfilled') {
    qs('#activityError').hidden = true;
    renderPropertyActivity(activityResult.value);
  } else {
    ['#activityCalled','#activityWhatsapped','#activityShared','#activityTotal','#activityCost','#latestDailyCost'].forEach(id => qs(id).textContent = '—');
    qs('#activityCostChart').innerHTML = '';
    qs('#activityTrendScope').textContent = 'Daily query cost unavailable';
    qs('#activityError').hidden = false;
    qs('#activityError').textContent = `Property activity unavailable: ${activityResult.reason.message}`;
  }
  if (amplitudeResult.status === 'fulfilled') {
    renderAmplitude(amplitudeResult.value);
  } else {
    ['#liveUsers','#latestDau','#averageDau','#peakDau','#totalDownloads','#androidDownloads','#iosDownloads'].forEach(id => qs(id).textContent = '—');
    qs('#liveUsersMeta').textContent = 'Real-time source unavailable';
    qs('#dauChart').innerHTML = '';
    qs('#downloadsChart').innerHTML = '';
    qs('#amplitudeScopeNote').textContent = '';
    qs('#amplitudeError').hidden = false;
    qs('#amplitudeError').textContent = `App analytics unavailable: ${amplitudeResult.reason.message}`;
  }
  await loadRoster();
}
function renderBars(rows = []) {
  const el = qs('#listingBars');
  if (!rows.length) { el.innerHTML = '<p class="section-note">No activity in this range</p>'; return; }
  const recent = normalizeTemporalRows(rows).slice(-10);
  const values = recent.map(row => Number(row.count) || 0);
  const max = Math.max(1, ...values);
  el.innerHTML = recent.map((row,i) => `<div class="bar-unit" data-day="${bucketLabel(row.label)}"><span style="height:${values[i] ? Math.max(3,values[i]/max*100) : 0}%" title="${bucketLabel(row.label)} · ${fmt(values[i])} listings"></span></div>`).join('');
}
function renderMix(obj = {}, expectedTotal = 0) {
  const total = Object.values(obj).reduce((a,b) => a+b, 0), colors = ['#a8df2d','#64a8ff','#9b87ff','#ffad5b','#a6b0ac'];
  if (!total) { qs('#mixTotal').textContent=fmt(expectedTotal); qs('#mixLegend').innerHTML=''; qs('#supplyDataNote').textContent='No classified listing activity in this range.'; return; }
  let acc = 0;
  const stops = Object.values(obj).map((v,i) => { const start=acc; acc+=v/total*100; return `${colors[i]} ${start}% ${acc}%`; });
  const lead = Object.entries(obj).sort((a,b)=>b[1]-a[1])[0];
  qs('#supplyDonut').style.background = `conic-gradient(${stops.join(',')})`;
  qs('#supplyDonut').innerHTML = `<div><strong>${Math.round(lead[1]/total*100)}%</strong><span>${lead[0]}</span></div>`;
  qs('#mixLegend').innerHTML = Object.entries(obj).map(([k,v],i) => `<div class="mix-item"><i style="background:${colors[i]}"></i><span>${k}</span><b>${fmt(v)}</b></div>`).join('');
  qs('#mixTotal').textContent = fmt(expectedTotal || total);
  const unclassified = Number(obj.Unclassified) || 0;
  qs('#supplyDataNote').textContent = unclassified
    ? `${fmt(unclassified)} listings (${(unclassified / Math.max(1, expectedTotal) * 100).toFixed(1)}%) have no valid transaction type and are shown as Unclassified.`
    : 'Transaction-type totals reconcile to the listing headline.';
}
function renderContributors(items = []) {
  qs('#leaderboard').innerHTML = items.length ? items.slice(0,5).map((x,i) => {
    const name=x.fullName||'Unnamed contributor', initials=name.split(' ').map(s=>s[0]).slice(0,2).join('');
    return `<li><span class="rank">0${i+1}</span><span class="avatar">${initials}</span><span><strong>${name}</strong><small>•••• ${String(x.username||'').slice(-4)}</small></span><span class="contrib-count">${fmt(x.count)}</span></li>`;
  }).join('') : '<li>No contributors in this range</li>';
}
function renderCities(items = []) {
  qs('#cityRows').innerHTML = items.length ? items.map(x => `<div class="city-row" role="row"><span class="city-name"><i class="city-code">${x.code}</i><span class="city-label">${x.name}</span></span><span>${fmt(x.users)}</span><span>${fmt(x.logins)}</span><span>${fmt(x.listings)}</span><span>${fmt(x.likes)}</span><span class="momentum"><i class="momentum-bar"><i style="width:${x.score}%"></i></i><b>${x.score}</b></span></div>`).join('') : '<div class="city-row">No city activity in this range</div>';
  const excluded = state.data?.excludedCities;
  const totals = state.data?.cityTotals || {};
  const coverage = (value, total) => `${fmt(value)} (${(value / Math.max(1, total) * 100).toFixed(1)}%)`;
  const parts = excluded ? [
    excluded.users ? `${coverage(excluded.users, totals.users)} users` : '',
    excluded.logins ? `${coverage(excluded.logins, totals.logins)} logins` : '',
    excluded.listings ? `${coverage(excluded.listings, totals.listings)} listings` : '',
    excluded.likes ? `${coverage(excluded.likes, totals.likes)} likes` : ''
  ].filter(Boolean) : [];
  qs('#geoDataNote').textContent = parts.length
    ? `Data quality note: ${parts.join(', ')} without a valid city are excluded from this comparison.`
    : 'All records in this comparison have valid city information.';
}
function render() {
  const d=state.data,o=d.overview;
  [['#totalUsers',o.totalUsers],['#newUsers',o.newUsersInRange],['#activeUsers',d.uniqueActiveUsers],['#activeListings',o.totalActiveListings],['#newListings',o.newListingsInRange],['#newLikes',d.trackedLikesInRange],['#demandLikes',d.trackedLikesInRange],['#uniqueUsers',d.uniqueActiveUsers]].forEach(([id,v]) => qs(id).textContent=fmt(v));
  qs('#registrationCount').textContent=fmt(d.registrations.reduce((total,point)=>total+(Number(point.count)||0),0));
  qs('#loginCount').textContent=fmt(d.logins.reduce((total,point)=>total+(Number(point.count)||0),0));
  chart('#trendChart',d.registrations,d.logins);
  chart('#likesChart',d.likes,null,true);
  renderBars(d.listings);
  renderMix(d.listingOverview.byTransactionType, o.newListingsInRange);
  qs('#likesPerListing').textContent = Number(d.trackedListingsInRange)
    ? (Number(d.trackedLikesInRange) / Number(d.trackedListingsInRange)).toFixed(2)
    : 'N/A';
  qs('#likesScopeNote').textContent = d.likesScopeNote;
  const periodWord = state.groupBy === 'month' ? 'Monthly' : 'Daily';
  qs('#growthChartSubtitle').textContent = `${periodWord} registrations and successful logins`;
  qs('#listingChartSubtitle').textContent = `New listings by ${state.groupBy === 'month' ? 'month' : 'day'}`;
  qs('#likesChartSubtitle').textContent = `${periodWord} date-ranged likes`;
  renderContributors(d.contributors);
  renderCities(d.cities);
}

function renderReconciliationAudit({ overview, userOverview, loginOverview, registrationTrend, loginTrend, listingOverview, listingTrend, likeOverview, likeTrend }) {
  const sum = rows => (rows || []).reduce((total, row) => total + (Number(row.count) || 0), 0);
  const issues = [];
  if (Number(overview.newUsersInRange) !== Number(userOverview.newUsersInRange)) issues.push('overview and user registration totals differ');
  if (Number(overview.newUsersInRange) !== sum(registrationTrend)) issues.push('registration headline and graph differ');
  if (Number(loginOverview.successfulLogins) !== sum(loginTrend)) issues.push('successful-login headline and graph differ');
  if (!qs('#typeSelect').value && Number(listingOverview.newListingsInRange) !== sum(listingTrend)) issues.push('listing headline and graph differ');
  if (Number(likeOverview.totalLikesInRange) !== sum(likeTrend)) issues.push('likes headline and graph differ');
  const warning = qs('#dashboardAuditError');
  warning.hidden = !issues.length;
  warning.textContent = issues.length ? `Data reconciliation warning: ${issues.join('; ')}.` : '';
}
function clearDashboard(message) {
  ['#totalUsers','#newUsers','#activeUsers','#activeListings','#newListings','#newLikes','#demandLikes','#uniqueUsers','#growthRate','#successRate','#mixTotal','#registrationCount','#loginCount','#likesPerListing'].forEach(id => qs(id).textContent='—');
  ['#trendChart','#likesChart','#listingBars','#mixLegend','#leaderboard','#cityRows'].forEach(id => qs(id).innerHTML='');
  qs('#executiveInsight').textContent=message;
  qs('#dataMode').textContent='CONNECTION ERROR';
  qs('#serviceState').textContent='Live API unavailable';
  qs('#supplyDataNote').textContent='';
  qs('.status-dot').style.background='#d65b55';
}
async function refresh() {
  const btn=qs('#refreshBtn');
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  qs('#dataMode').textContent='LOADING';
  try {
    const [overview,userOverview,reg,loginOverview,logins,listingOverview,listings,contributors,likeOverview,likes,userCities,loginCities,listingCities,likeCities,saleListings,rentListings,mandateListings,requirementListings] = await Promise.all([
      api('/overview'),api('/users/overview'),api('/users/registrations-trend',{groupBy:state.groupBy}),api('/logins/overview'),api('/logins/trend',{groupBy:state.groupBy}),api('/listings/overview'),api('/listings/trend',{groupBy:state.groupBy,transactionType:qs('#typeSelect').value}),api('/listings/top-contributors',{limit:5}),api('/likes/overview'),api('/likes/trend',{groupBy:state.groupBy}),api('/users/by-city'),api('/logins/by-city'),api('/listings/by-city'),api('/likes/by-city'),api('/listings/overview',{transactionType:'Sale'}),api('/listings/overview',{transactionType:'Rent'}),api('/listings/overview',{transactionType:'Mandate'}),api('/listings/overview',{transactionType:'Requirement'})
    ]);
    const usersByCity=groupCityRows(userCities), loginsByCity=groupCityRows(loginCities), listingsByCity=groupCityRows(listingCities), likesByCity=groupCityRows(likeCities);
    const uc=usersByCity.grouped, lc=loginsByCity.grouped, sc=listingsByCity.grouped, kc=likesByCity.grouped;
    const codes=[...new Set([...Object.keys(uc),...Object.keys(lc),...Object.keys(sc),...Object.keys(kc)])];
    const maxima={users:Math.max(1,...Object.values(uc).map(x=>x.count)),logins:Math.max(1,...Object.values(lc).map(x=>x.count)),listings:Math.max(1,...Object.values(sc).map(x=>x.count)),likes:Math.max(1,...Object.values(kc).map(x=>x.count))};
    const cityRows=codes.map(code=>{const source=uc[code]||lc[code]||sc[code]||kc[code];const row={code,name:source.name,users:uc[code]?.count||0,logins:lc[code]?.count||0,listings:sc[code]?.count||0,likes:kc[code]?.count||0};row.score=Math.round(25*(row.users/maxima.users+row.logins/maxima.logins+row.listings/maxima.listings+row.likes/maxima.likes));row.volume=row.users+row.logins+row.listings+row.likes;return row}).sort((a,b)=>b.volume-a.volume).slice(0,10);
    const reliableMix={Sale:Number(saleListings.newListingsInRange)||0,Rent:Number(rentListings.newListingsInRange)||0,Mandate:Number(mandateListings.newListingsInRange)||0,Requirement:Number(requirementListings.newListingsInRange)||0};
    const classified=Object.values(reliableMix).reduce((total,value)=>total+value,0);
    const unclassified=Math.max(0,(Number(listingOverview.newListingsInRange)||0)-classified);
    if (unclassified) reliableMix.Unclassified=unclassified;
    listingOverview.byTransactionType=reliableMix;
    const cityTotals={users:userCities.reduce((t,x)=>t+(Number(x.count)||0),0),logins:loginCities.reduce((t,x)=>t+(Number(x.count)||0),0),listings:listingCities.reduce((t,x)=>t+(Number(x.count)||0),0),likes:likeCities.reduce((t,x)=>t+(Number(x.count)||0),0)};
    const trackedListingsInRange = reliableMix.Mandate + reliableMix.Requirement;
    state.data={overview,uniqueActiveUsers:loginOverview.uniqueActiveUsers,registrations:reg,logins,likes,listings,listingOverview,trackedListingsInRange,trackedLikesInRange:Number(likeOverview.totalLikesInRange)||0,likesScopeNote:likeOverview.scopeNote||'Covers date-ranged likes on Mandate and Requirement listings only.',contributors,cities:cityRows,cityTotals,excludedCities:{users:usersByCity.excluded,logins:loginsByCity.excluded,listings:listingsByCity.excluded,likes:likesByCity.excluded}};
    renderReconciliationAudit({ overview, userOverview, loginOverview, registrationTrend: reg, loginTrend: logins, listingOverview, listingTrend: listings, likeOverview, likeTrend: likes });
    const growthRate=userOverview.growthRatePercent, successRate=loginOverview.successRatePercent;
    qs('#growthRate').textContent=growthRate == null ? 'N/A' : `${Number(growthRate)>=0?'+':''}${Number(growthRate).toFixed(1)}%`;
    qs('#successRate').textContent=successRate == null ? 'N/A' : `${Number(successRate).toFixed(1)}%`;
    render();
    state.live=true;
    qs('#executiveInsight').textContent=`${fmt(overview.newUsersInRange)} new users and ${fmt(overview.newListingsInRange)} new listings in the selected period.`;
    qs('#dataMode').textContent='TEST API';
    qs('#serviceState').textContent='Test API · auto-refresh 5m';
    qs('.status-dot').style.background='#9de36d';
    showToast('Dashboard refreshed with live Brokket data');
  } catch (error) {
    state.data=null;
    state.live=false;
    clearDashboard(error.message);
    qs('#dashboardAuditError').hidden = true;
    showToast(error.message);
  }
  await refreshAddendumData();
  const now=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
  qs('#lastUpdated').textContent=`Fetched ${now} · Asia/Kolkata`;
  btn.classList.remove('loading');
}
function showToast(msg) {
  const t=qs('#toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer=setTimeout(()=>t.classList.remove('show'),3500);
}
document.querySelectorAll('.segmented button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.segmented button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.groupBy=b.dataset.group;refresh()}));
qs('#periodSelect').addEventListener('change', event => {
  if (event.target.value === 'custom') {
    openCustomDatePanel();
    return;
  }
  state.lastPreset = event.target.value;
  state.customRange = null;
  const customOption = event.target.querySelector('option[value="custom"]');
  customOption.textContent = 'Custom range…';
  refresh();
});
['#citySelect','#typeSelect'].forEach(id=>qs(id).addEventListener('change',refresh));
qs('#closeDatePanel').addEventListener('click', closeCustomDatePanel);
qs('#clearDateRange').addEventListener('click', () => {
  state.customRange = null;
  state.lastPreset = '30';
  qs('#periodSelect').value = '30';
  qs('#periodSelect').querySelector('option[value="custom"]').textContent = 'Custom range…';
  qs('#customDatePanel').hidden = true;
  refresh();
});
qs('#todayDateRange').addEventListener('click', () => {
  const today = istToday();
  qs('#customFromDate').value = today;
  qs('#customToDate').value = today;
  qs('#customDateError').textContent = '';
});
qs('#applyDateRange').addEventListener('click', () => {
  const fromDate = qs('#customFromDate').value;
  const toDate = qs('#customToDate').value;
  if (!fromDate || !toDate) {
    qs('#customDateError').textContent = 'Select both start and end dates.';
    return;
  }
  if (fromDate > toDate) {
    qs('#customDateError').textContent = 'Start date must be before or equal to end date.';
    return;
  }
  state.customRange = { fromDate, toDate };
  const option = qs('#periodSelect').querySelector('option[value="custom"]');
  option.textContent = `${fromDate} – ${toDate}`;
  qs('#periodSelect').value = 'custom';
  qs('#customDatePanel').hidden = true;
  refresh();
});
document.addEventListener('click', event => {
  if (!qs('.date-filter-wrap').contains(event.target) && !qs('#customDatePanel').hidden) closeCustomDatePanel();
});
qs('#autopayFilter').addEventListener('change', event => { state.rosterAutopay = event.target.value; state.rosterPage = 0; loadRoster(); });
qs('#rosterPrev').addEventListener('click', () => { if (state.rosterPage > 0) { state.rosterPage -= 1; loadRoster(); } });
qs('#rosterNext').addEventListener('click', () => { state.rosterPage += 1; loadRoster(); });
qs('#refreshBtn').addEventListener('click',refresh);
qs('#scopeInfo').addEventListener('click',e=>e.currentTarget.setAttribute('aria-expanded',e.currentTarget.getAttribute('aria-expanded')!=='true'));
qs('.mobile-menu').addEventListener('click',()=>qs('.sidebar').classList.toggle('open'));
function syncActiveNav() {
  const target = window.location.hash || '#overview';
  document.querySelectorAll('.nav-item').forEach(item => {
    const active = item.getAttribute('href') === target;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}
document.querySelectorAll('.nav-item').forEach(a=>a.addEventListener('click',()=>{syncActiveNav();qs('.sidebar').classList.remove('open')}));
window.addEventListener('hashchange', syncActiveNav);
syncActiveNav();
qs('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  qs('#loginError').textContent = '';
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        countryCode: qs('#loginCountryCode').value,
        phone: qs('#loginNumber').value,
        password: qs('#loginPassword').value
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to sign in.');
    unlockDashboard();
    await loadCities().catch(() => {});
    await refresh();
    scheduleAutoRefresh();
    scrollToCurrentSection();
  } catch (error) {
    qs('#loginError').textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});
qs('#logoutBtn').addEventListener('click', async () => {
  window.clearInterval(window.dashboardRefreshTimer);
  window.clearInterval(window.amplitudeLiveRefreshTimer);
  await fetch('/api/auth', { method: 'DELETE' }).catch(() => {});
  lockDashboard('You have signed out.');
});
startDashboard().catch(() => lockDashboard('Unable to verify your session. Please sign in.'));
