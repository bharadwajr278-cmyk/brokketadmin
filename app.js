const API = '/api/proxy';
const state = { data: null, live: false, groupBy: 'day', cityNames: {}, rosterPage: 0, rosterAutopay: '', customRange: null, lastPreset: '30' };
const fmt = n => new Intl.NumberFormat('en-IN').format(n ?? 0);
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n ?? 0);
const qs = s => document.querySelector(s);

function dateRange() {
  if (qs('#periodSelect').value === 'custom') {
    const today = istToday();
    return state.customRange ? { ...state.customRange } : { fromDate: today, toDate: today };
  }
  const days = Number(qs('#periodSelect').value);
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - days + 1);
  const iso = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return { fromDate: iso(from), toDate: iso(to) };
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
  scrollToCurrentSection();
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
function chart(svgId, a = [], b = null, compact = false) {
  const svg = qs(svgId), h = compact ? 180 : 260, w = 760, p = 30;
  if (!a.length || (b && !b.length)) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No activity in this range</text>';
    return;
  }
  const all = b ? [...a, ...b] : a;
  const max = Math.max(1, ...all) * 1.12;
  const pts = vals => vals.map((v, i) => [p + i * (w - p * 2) / Math.max(1, vals.length - 1), h - p - (v / max) * (h - p * 2)]);
  const path = vals => pts(vals).map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const area = vals => `${path(vals)} L${w-p},${h-p} L${p},${h-p} Z`;
  const grids = [0,.25,.5,.75,1].map(v => `<line class="grid-line" x1="${p}" y1="${p+v*(h-p*2)}" x2="${w-p}" y2="${p+v*(h-p*2)}"/><text class="axis-label" x="2" y="${p+v*(h-p*2)+4}">${Math.round(max*(1-v))}</text>`).join('');
  const step = Math.max(1, Math.ceil(a.length / 5));
  const labels = a.map((_,i) => i % step === 0 ? `<text class="axis-label" text-anchor="middle" x="${p+i*(w-p*2)/Math.max(1,a.length-1)}" y="${h-5}">${i+1}</text>` : '').join('');
  svg.innerHTML = `<defs><linearGradient id="limeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8df2d" stop-opacity=".18"/><stop offset="1" stop-color="#a8df2d" stop-opacity="0"/></linearGradient><linearGradient id="violetFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b87ff" stop-opacity=".22"/><stop offset="1" stop-color="#9b87ff" stop-opacity="0"/></linearGradient></defs>${grids}<path class="${b?'area-a':'area-like'}" d="${area(a)}"/><path class="${b?'line-a':'line-like'}" d="${path(a)}"/>${b?`<path class="line-b" d="${path(b)}"/>`:''}${labels}`;
}

function renderRevenueChart(points = []) {
  const svg = qs('#revenueChart'), w = 760, h = 210, p = 34;
  if (!points.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">No revenue activity in this range</text>';
    return;
  }
  const values = points.map(point => Number(point.amount) || 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), range = Math.max(1, max - min);
  const y = value => p + (max - value) / range * (h - p * 2);
  const baseline = y(0), slot = (w - p * 2) / values.length, barWidth = Math.max(5, Math.min(28, slot * 0.58));
  const bars = values.map((value, index) => {
    const top = Math.min(y(value), baseline), height = Math.max(2, Math.abs(y(value) - baseline));
    return `<rect class="revenue-bar ${value < 0 ? 'negative' : ''}" x="${(p + index * slot + (slot - barWidth) / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="4"><title>${points[index].label}: ${money(value)}</title></rect>`;
  }).join('');
  const step = Math.max(1, Math.ceil(points.length / 5));
  const labels = points.map((point,index) => index % step === 0 ? `<text class="axis-label" text-anchor="middle" x="${(p + index * slot + slot / 2).toFixed(1)}" y="${h - 6}">${point.label.slice(5)}</text>` : '').join('');
  svg.innerHTML = `<line class="grid-line" x1="${p}" y1="${baseline}" x2="${w-p}" y2="${baseline}"/>${bars}${labels}`;
}

function renderSubscriptions(data) {
  const values = [
    ['#activeSubscribers', data.totalActiveSubscribers], ['#activeIncludingTrial', data.totalActiveIncludingTrial],
    ['#autopayOn', data.autopayOnCount], ['#autopayOff', data.autopayOffCount],
    ['#newPurchases', data.newPurchasesInRange], ['#renewals', data.renewalsInRange]
  ];
  values.forEach(([id, value]) => qs(id).textContent = fmt(value));
  qs('#revenueInRange').textContent = money(data.revenueInRange);
  qs('#revenueAllTime').textContent = money(data.totalRevenueAllTime);
  qs('#planBreakdown').innerHTML = (data.byPlan || []).length ? data.byPlan.map(plan => `<div class="plan-row"><span><b>${plan.planName || plan.planCode}</b><small>${plan.planCode}</small></span><span><b>${fmt(plan.activeSubscribers)}</b><small>${money(plan.totalRevenueAllTime)}</small></span></div>`).join('') : '<p class="section-note">No active plan data</p>';
  qs('#autopayStatus').innerHTML = Object.entries(data.byAutopayStatus || {}).map(([status, count]) => `<span><i></i>${status}<b>${fmt(count)}</b></span>`).join('');
  qs('#subscriptionScopeNote').textContent = data.scopeNote || '';
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
  const [overviewResult, trendResult, contentResult] = await Promise.allSettled([
    api('/subscriptions/overview', {}, { city: false }),
    api('/subscriptions/revenue-trend', { groupBy: state.groupBy }, { city: false }),
    api('/content/overview', {}, { city: false })
  ]);
  if (overviewResult.status === 'fulfilled') {
    qs('#subscriptionError').hidden = true;
    renderSubscriptions(overviewResult.value);
  } else {
    ['#activeSubscribers','#activeIncludingTrial','#autopayOn','#autopayOff','#revenueInRange','#revenueAllTime','#newPurchases','#renewals'].forEach(id => qs(id).textContent = '—');
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
  await loadRoster();
}
function renderBars(values = []) {
  const el = qs('#listingBars');
  if (!values.length) { el.innerHTML = '<p class="section-note">No activity in this range</p>'; return; }
  const max = Math.max(1, ...values);
  el.innerHTML = values.slice(-10).map((v,i) => `<div class="bar-unit" data-day="${i+1}"><span style="height:${Math.max(3,v/max*100)}%"></span><span style="height:${Math.max(2,v/max*58)}%"></span></div>`).join('');
}
function renderMix(obj = {}) {
  const total = Object.values(obj).reduce((a,b) => a+b, 0), colors = ['#a8df2d','#64a8ff','#9b87ff','#ffad5b'];
  if (!total) { qs('#mixTotal').textContent='0'; qs('#mixLegend').innerHTML=''; return; }
  let acc = 0;
  const stops = Object.values(obj).map((v,i) => { const start=acc; acc+=v/total*100; return `${colors[i]} ${start}% ${acc}%`; });
  const lead = Object.entries(obj).sort((a,b)=>b[1]-a[1])[0];
  qs('#supplyDonut').style.background = `conic-gradient(${stops.join(',')})`;
  qs('#supplyDonut').innerHTML = `<div><strong>${Math.round(lead[1]/total*100)}%</strong><span>${lead[0]}</span></div>`;
  qs('#mixLegend').innerHTML = Object.entries(obj).map(([k,v],i) => `<div class="mix-item"><i style="background:${colors[i]}"></i><span>${k}</span><b>${fmt(v)}</b></div>`).join('');
  qs('#mixTotal').textContent = fmt(total);
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
  const parts = excluded ? [
    excluded.users ? `${fmt(excluded.users)} users` : '',
    excluded.logins ? `${fmt(excluded.logins)} logins` : '',
    excluded.listings ? `${fmt(excluded.listings)} listings` : '',
    excluded.likes ? `${fmt(excluded.likes)} likes` : ''
  ].filter(Boolean) : [];
  qs('#geoDataNote').textContent = parts.length
    ? `Data quality note: ${parts.join(', ')} without a valid city are excluded from this comparison.`
    : 'All records in this comparison have valid city information.';
}
function render() {
  const d=state.data,o=d.overview;
  [['#totalUsers',o.totalUsers],['#newUsers',o.newUsersInRange],['#activeUsers',o.activeUsersInRange],['#activeListings',o.totalActiveListings],['#newListings',o.newListingsInRange],['#newLikes',o.newLikesInRange],['#demandLikes',o.newLikesInRange],['#uniqueUsers',o.activeUsersInRange]].forEach(([id,v]) => qs(id).textContent=fmt(v));
  chart('#trendChart',d.registrations,d.logins);
  chart('#likesChart',d.likes,null,true);
  renderBars(d.listings);
  renderMix(d.listingOverview.byTransactionType);
  renderContributors(d.contributors);
  renderCities(d.cities);
}
function clearDashboard(message) {
  ['#totalUsers','#newUsers','#activeUsers','#activeListings','#newListings','#newLikes','#demandLikes','#uniqueUsers','#growthRate','#successRate','#mixTotal'].forEach(id => qs(id).textContent='—');
  ['#trendChart','#likesChart','#listingBars','#mixLegend','#leaderboard','#cityRows'].forEach(id => qs(id).innerHTML='');
  qs('#executiveInsight').textContent=message;
  qs('#dataMode').textContent='CONNECTION ERROR';
  qs('#serviceState').textContent='Live API unavailable';
  qs('.status-dot').style.background='#d65b55';
}
async function refresh() {
  const btn=qs('#refreshBtn');
  btn.classList.add('loading');
  qs('#dataMode').textContent='LOADING';
  try {
    const [overview,userOverview,reg,loginOverview,logins,listingOverview,listings,contributors,likeOverview,likes,userCities,loginCities,listingCities,likeCities] = await Promise.all([
      api('/overview'),api('/users/overview'),api('/users/registrations-trend',{groupBy:state.groupBy}),api('/logins/overview'),api('/logins/trend',{groupBy:state.groupBy}),api('/listings/overview'),api('/listings/trend',{groupBy:state.groupBy,transactionType:qs('#typeSelect').value}),api('/listings/top-contributors',{limit:5}),api('/likes/overview'),api('/likes/trend',{groupBy:state.groupBy}),api('/users/by-city'),api('/logins/by-city'),api('/listings/by-city'),api('/likes/by-city')
    ]);
    const usersByCity=groupCityRows(userCities), loginsByCity=groupCityRows(loginCities), listingsByCity=groupCityRows(listingCities), likesByCity=groupCityRows(likeCities);
    const uc=usersByCity.grouped, lc=loginsByCity.grouped, sc=listingsByCity.grouped, kc=likesByCity.grouped;
    const codes=[...new Set([...Object.keys(uc),...Object.keys(lc),...Object.keys(sc),...Object.keys(kc)])];
    const maxima={users:Math.max(1,...Object.values(uc).map(x=>x.count)),logins:Math.max(1,...Object.values(lc).map(x=>x.count)),listings:Math.max(1,...Object.values(sc).map(x=>x.count)),likes:Math.max(1,...Object.values(kc).map(x=>x.count))};
    const cityRows=codes.map(code=>{const source=uc[code]||lc[code]||sc[code]||kc[code];const row={code,name:source.name,users:uc[code]?.count||0,logins:lc[code]?.count||0,listings:sc[code]?.count||0,likes:kc[code]?.count||0};row.score=Math.round(25*(row.users/maxima.users+row.logins/maxima.logins+row.listings/maxima.listings+row.likes/maxima.likes));row.volume=row.users+row.logins+row.listings+row.likes;return row}).sort((a,b)=>b.volume-a.volume).slice(0,10);
    state.data={overview,registrations:reg.map(x=>x.count),logins:logins.map(x=>x.count),likes:likes.map(x=>x.count),listings:listings.map(x=>x.count),listingOverview,contributors,cities:cityRows,excludedCities:{users:usersByCity.excluded,logins:loginsByCity.excluded,listings:listingsByCity.excluded,likes:likesByCity.excluded}};
    qs('#growthRate').textContent=`${userOverview.growthRatePercent>=0?'+':''}${userOverview.growthRatePercent}%`;
    qs('#successRate').textContent=`${loginOverview.successRatePercent}%`;
    render();
    state.live=true;
    qs('#executiveInsight').textContent=`${fmt(overview.newUsersInRange)} new users and ${fmt(overview.newListingsInRange)} new listings in the selected period.`;
    qs('#dataMode').textContent='LIVE DATA';
    qs('#serviceState').textContent='Live API';
    qs('.status-dot').style.background='#9de36d';
    showToast('Dashboard refreshed with live Brokket data');
  } catch (error) {
    state.data=null;
    state.live=false;
    clearDashboard(error.message);
    showToast(error.message);
  }
  await refreshAddendumData();
  const now=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
  qs('#lastUpdated').textContent=`Updated ${now} · Asia/Kolkata`;
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
      body: JSON.stringify({ number: qs('#loginNumber').value, password: qs('#loginPassword').value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to sign in.');
    unlockDashboard();
    await loadCities().catch(() => {});
    await refresh();
    scrollToCurrentSection();
  } catch (error) {
    qs('#loginError').textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});
qs('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth', { method: 'DELETE' }).catch(() => {});
  lockDashboard('You have signed out.');
});
startDashboard().catch(() => lockDashboard('Unable to verify your session. Please sign in.'));
