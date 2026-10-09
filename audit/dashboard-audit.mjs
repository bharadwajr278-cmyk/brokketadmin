const BASE = process.env.AUDIT_API_BASE || 'https://test.api.propertymaster.com/api/v1/ceo-dashboard';

const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);
const sumField = (rows, field) => sum((rows || []).map(row => row?.[field]));
const finite = value => typeof value === 'number' && Number.isFinite(value);

async function call(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null);
    return { path, url: url.toString(), status: response.status, ms: Date.now() - started, ok: response.ok && body?.success === true, body };
  } catch (error) {
    return { path, url: url.toString(), status: 0, ms: Date.now() - started, ok: false, error: error.message };
  }
}

function equality(checks, name, left, right, detail = '') {
  const bothNumeric = typeof left === 'number' && typeof right === 'number';
  checks.push({ name, pass: bothNumeric ? Number(left) === Number(right) : left === right, left, right, detail });
}

function condition(checks, name, pass, detail = '', values = {}) {
  checks.push({ name, pass: Boolean(pass), detail, ...values });
}

function data(result) {
  return result?.body?.data;
}

function auditCore(label, fromDate, toDate, results) {
  const get = path => data(results.find(result => result.path === path));
  const overview = get('overview') || {};
  const users = get('users/overview') || {};
  const registrations = get('users/registrations-trend') || [];
  const userCities = get('users/by-city') || [];
  const loginOverview = get('logins/overview') || {};
  const logins = get('logins/trend') || [];
  const loginCities = get('logins/by-city') || [];
  const listingOverview = get('listings/overview') || {};
  const listings = get('listings/trend') || [];
  const listingCities = get('listings/by-city') || [];
  const contributors = get('listings/top-contributors') || [];
  const likeOverview = get('likes/overview') || {};
  const likes = get('likes/trend') || [];
  const likeCities = get('likes/by-city') || [];
  const subscriptions = get('subscriptions/overview') || {};
  const revenue = get('subscriptions/revenue-trend') || [];
  const roster = get('subscriptions/roster') || {};
  const rosterOn = get('subscriptions/roster:on') || {};
  const rosterOff = get('subscriptions/roster:off') || {};
  const content = get('content/overview') || {};
  const checks = [];

  condition(checks, 'All endpoint calls succeeded', results.every(result => result.ok), '', {
    failed: results.filter(result => !result.ok).map(result => ({ path: result.path, status: result.status, message: result.body?.message || result.error }))
  });
  for (const [name, payload] of [['overview', overview], ['users', users], ['logins', loginOverview], ['listings', listingOverview], ['likes', likeOverview], ['subscriptions', subscriptions], ['content', content]]) {
    if (payload.fromDate !== undefined) equality(checks, `${name} fromDate echo`, payload.fromDate, fromDate);
    if (payload.toDate !== undefined) equality(checks, `${name} toDate echo`, payload.toDate, toDate);
  }

  equality(checks, 'Overview total users = user overview', overview.totalUsers, users.totalUsers);
  equality(checks, 'Overview new users = user overview', overview.newUsersInRange, users.newUsersInRange);
  equality(checks, 'Overview active users = user overview', overview.activeUsersInRange, users.activeUsersInRange);
  equality(checks, 'Overview active users = login unique users', overview.activeUsersInRange, loginOverview.uniqueActiveUsers);
  equality(checks, 'User registrations = registration trend sum', users.newUsersInRange, sumField(registrations, 'count'));
  equality(checks, 'User registrations = by-city sum', users.newUsersInRange, sumField(userCities, 'count'));

  equality(checks, 'Login attempts = successful + failed', loginOverview.totalAttempts, (Number(loginOverview.successfulLogins) || 0) + (Number(loginOverview.failedLogins) || 0));
  const expectedLoginRate = Number(loginOverview.totalAttempts) ? Number(loginOverview.successfulLogins) / Number(loginOverview.totalAttempts) * 100 : null;
  condition(checks, 'Login success rate formula', expectedLoginRate === null ? loginOverview.successRatePercent == null : Math.abs(Number(loginOverview.successRatePercent) - expectedLoginRate) < 0.0001, '', { displayed: loginOverview.successRatePercent, calculated: expectedLoginRate });
  equality(checks, 'Successful logins = login trend sum', loginOverview.successfulLogins, sumField(logins, 'count'));
  equality(checks, 'Successful logins = login by-city sum', loginOverview.successfulLogins, sumField(loginCities, 'count'));

  equality(checks, 'Overview active listings = listing overview', overview.totalActiveListings, listingOverview.totalActiveListings);
  equality(checks, 'Overview new listings = listing overview', overview.newListingsInRange, listingOverview.newListingsInRange);
  equality(checks, 'New listings = transaction-type sum', listingOverview.newListingsInRange, sum(Object.values(listingOverview.byTransactionType || {})));
  equality(checks, 'New listings = listing trend sum', listingOverview.newListingsInRange, sumField(listings, 'count'));
  equality(checks, 'New listings = listing by-city sum', listingOverview.newListingsInRange, sumField(listingCities, 'count'));
  condition(checks, 'Top contributor counts do not exceed listings', contributors.every(row => Number(row.count) <= Number(listingOverview.newListingsInRange)), '', { contributors });

  equality(checks, 'Overview likes = like overview', overview.newLikesInRange, likeOverview.totalLikesInRange);
  equality(checks, 'New likes = like trend sum', likeOverview.totalLikesInRange, sumField(likes, 'count'));
  equality(checks, 'New likes = like by-city sum', likeOverview.totalLikesInRange, sumField(likeCities, 'count'));

  const paidPlanTotal = sum((subscriptions.byPlan || []).filter(plan => String(plan.planCode).toUpperCase() !== 'TRIAL').map(plan => plan.activeSubscribers));
  equality(checks, 'Active paid = non-trial plan active sum', subscriptions.totalActiveSubscribers, paidPlanTotal);
  equality(checks, 'Including trial = all plan active sum', subscriptions.totalActiveIncludingTrial, sumField(subscriptions.byPlan, 'activeSubscribers'));
  equality(checks, 'Including trial = autopay on + off', subscriptions.totalActiveIncludingTrial, (Number(subscriptions.autopayOnCount) || 0) + (Number(subscriptions.autopayOffCount) || 0));
  equality(checks, 'Including trial = roster total', subscriptions.totalActiveIncludingTrial, roster.totalElements);
  equality(checks, 'Roster on + off = full roster', roster.totalElements, (Number(rosterOn.totalElements) || 0) + (Number(rosterOff.totalElements) || 0));
  equality(checks, 'Revenue in range = revenue trend sum', subscriptions.revenueInRange, sumField(revenue, 'amount'));
  condition(checks, 'Subscription headline numeric fields are finite', ['totalActiveSubscribers','totalActiveIncludingTrial','autopayOnCount','autopayOffCount','newPurchasesInRange','renewalsInRange','totalSubscriptionsSoldAllTime','totalUniquePayingSubscribersAllTime','totalRevenueAllTime','revenueInRange'].every(field => finite(subscriptions[field])), '', { subscriptions });

  condition(checks, 'Picture posts do not exceed feed posts', Number(content.picturesUploadedInRange) <= Number(content.feedPostsInRange), '', { feedPosts: content.feedPostsInRange, pictures: content.picturesUploadedInRange });
  condition(checks, 'Unique creators do not exceed feed posts', Number(content.uniqueContentCreatorsInRange) <= Number(content.feedPostsInRange), '', { feedPosts: content.feedPostsInRange, creators: content.uniqueContentCreatorsInRange });

  for (const [name, rows] of [['registrations', registrations], ['logins', logins], ['listings', listings], ['likes', likes], ['revenue', revenue]]) {
    const labels = rows.map(row => row.label);
    condition(checks, `${name} trend labels unique`, new Set(labels).size === labels.length, '', { labels });
    condition(checks, `${name} trend labels sorted`, labels.every((value, index) => index === 0 || labels[index - 1] < value), '', { labels });
  }

  for (const [name, rows] of [['users', userCities], ['logins', loginCities], ['listings', listingCities], ['likes', likeCities]]) {
    const codes = rows.map(row => String(row.cityCode ?? '').trim().toLowerCase());
    condition(checks, `${name} city codes unique`, new Set(codes).size === codes.length, '', { duplicates: codes.filter((code, index) => codes.indexOf(code) !== index) });
    condition(checks, `${name} city rows have no null/unknown code`, codes.every(code => code && !['unknown','unk','null'].includes(code)), '', { invalidRows: rows.filter((row, index) => !codes[index] || ['unknown','unk','null'].includes(codes[index])) });
  }

  return { label, fromDate, toDate, results, checks, failedChecks: checks.filter(check => !check.pass) };
}

async function comprehensiveRange(label, fromDate, toDate) {
  const common = { fromDate, toDate };
  const requests = [
    ['overview', common], ['users/overview', common], ['users/registrations-trend', { ...common, groupBy: 'day' }], ['users/by-city', common],
    ['logins/overview', common], ['logins/trend', { ...common, groupBy: 'day' }], ['logins/by-city', common],
    ['listings/overview', common], ['listings/trend', { ...common, groupBy: 'day' }], ['listings/by-city', common], ['listings/top-contributors', { ...common, limit: 5 }],
    ['likes/overview', common], ['likes/trend', { ...common, groupBy: 'day' }], ['likes/by-city', common],
    ['subscriptions/overview', common], ['subscriptions/revenue-trend', { ...common, groupBy: 'day' }], ['subscriptions/roster', { page: 0, size: 1 }],
    ['content/overview', common]
  ];
  const results = [];
  for (const [path, params] of requests) results.push(await call(path, params));
  const on = await call('subscriptions/roster', { autopay: 'on', page: 0, size: 1 });
  on.path = 'subscriptions/roster:on';
  results.push(on);
  const off = await call('subscriptions/roster', { autopay: 'off', page: 0, size: 1 });
  off.path = 'subscriptions/roster:off';
  results.push(off);
  return auditCore(label, fromDate, toDate, results);
}

async function summaryRange(label, fromDate, toDate) {
  const common = { fromDate, toDate };
  const requests = [
    ['overview', common], ['users/overview', common], ['users/registrations-trend', { ...common, groupBy: 'day' }],
    ['logins/overview', common], ['logins/trend', { ...common, groupBy: 'day' }],
    ['listings/overview', common], ['listings/trend', { ...common, groupBy: 'day' }],
    ['likes/overview', common], ['likes/trend', { ...common, groupBy: 'day' }],
    ['subscriptions/overview', common], ['subscriptions/revenue-trend', { ...common, groupBy: 'day' }], ['content/overview', common]
  ];
  const results = [];
  for (const [path, params] of requests) results.push(await call(path, params));
  return { label, fromDate, toDate, results };
}

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  comprehensive: await comprehensiveRange('30 days', '2026-09-10', '2026-10-09'),
  ranges: []
};
for (const range of [
  ['today', '2026-10-09', '2026-10-09'],
  ['7 days', '2026-10-03', '2026-10-09'],
  ['90 days', '2026-07-12', '2026-10-09'],
  ['365 days', '2025-10-10', '2026-10-09']
]) report.ranges.push(await summaryRange(...range));

function compactResults(results) {
  return Object.fromEntries(results.map(result => {
    const payload = result.body?.data;
    let summary = payload;
    if (Array.isArray(payload)) {
      summary = {
        rows: payload.length,
        sumCount: sumField(payload, 'count'),
        sumAmount: sumField(payload, 'amount'),
        first: payload[0],
        last: payload[payload.length - 1]
      };
    } else if (payload?.content) {
      summary = { ...payload, content: `[${payload.content.length} rows omitted]` };
    }
    return [result.path, {
    status: result.status,
    ms: result.ms,
    ok: result.ok,
    data: summary,
    error: result.body?.message || result.error
    }];
  }));
}

if (process.argv.includes('--compact')) {
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    base: report.base,
    comprehensive: {
      label: report.comprehensive.label,
      fromDate: report.comprehensive.fromDate,
      toDate: report.comprehensive.toDate,
      failedChecks: report.comprehensive.failedChecks,
      checksPassed: report.comprehensive.checks.filter(check => check.pass).length,
      checksTotal: report.comprehensive.checks.length,
      results: compactResults(report.comprehensive.results)
    },
    ranges: report.ranges.map(range => ({
      label: range.label,
      fromDate: range.fromDate,
      toDate: range.toDate,
      results: compactResults(range.results)
    }))
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
