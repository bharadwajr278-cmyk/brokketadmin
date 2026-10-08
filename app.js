const API = '/api/proxy';
const state = { data: null, live: false, groupBy: 'day' };
const fmt = n => new Intl.NumberFormat('en-IN').format(n ?? 0);
const qs = s => document.querySelector(s);

function dateRange() {
  const days = Number(qs('#periodSelect').value);
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - days + 1);
  const iso = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return { fromDate: iso(from), toDate: iso(to) };
}
function params(extra = {}) {
  const p = new URLSearchParams({ ...dateRange(), ...extra });
  const city = qs('#citySelect').value;
  if (city) p.set('cityCode', city);
  return p;
}
async function api(path, extra = {}) {
  const query = params(extra);
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
}
async function loadCities() {
  const cities = await api('/filters/cities');
  const select = qs('#citySelect');
  const selected = select.value;
  select.innerHTML = '<option value="">All cities</option>' +
    cities.map(c => `<option value="${c.cityCode}">${c.cityName}</option>`).join('');
  select.value = selected;
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
    const map=arr=>Object.fromEntries(arr.map(x=>[x.cityCode||'UNK',x])), uc=map(userCities), lc=map(loginCities), sc=map(listingCities), kc=map(likeCities);
    const codes=[...new Set([...Object.keys(uc),...Object.keys(lc),...Object.keys(sc),...Object.keys(kc)])];
    const maxima={users:Math.max(1,...userCities.map(x=>x.count)),logins:Math.max(1,...loginCities.map(x=>x.count)),listings:Math.max(1,...listingCities.map(x=>x.count)),likes:Math.max(1,...likeCities.map(x=>x.count))};
    state.data={overview,registrations:reg.map(x=>x.count),logins:logins.map(x=>x.count),likes:likes.map(x=>x.count),listings:listings.map(x=>x.count),listingOverview,contributors,cities:codes.slice(0,10).map(code=>{const row={code,name:(uc[code]||lc[code]||sc[code]||kc[code]).cityName||code,users:uc[code]?.count||0,logins:lc[code]?.count||0,listings:sc[code]?.count||0,likes:kc[code]?.count||0};row.score=Math.round(25*(row.users/maxima.users+row.logins/maxima.logins+row.listings/maxima.listings+row.likes/maxima.likes));return row})};
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
['#periodSelect','#citySelect','#typeSelect'].forEach(id=>qs(id).addEventListener('change',refresh));
qs('#refreshBtn').addEventListener('click',refresh);
qs('#scopeInfo').addEventListener('click',e=>e.currentTarget.setAttribute('aria-expanded',e.currentTarget.getAttribute('aria-expanded')!=='true'));
qs('.mobile-menu').addEventListener('click',()=>qs('.sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-item').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));a.classList.add('active');qs('.sidebar').classList.remove('open')}));
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
