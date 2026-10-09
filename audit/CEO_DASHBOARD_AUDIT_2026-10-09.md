# Brokket CEO Dashboard Data Accuracy Audit

**Audit date:** 9 October 2026 (Asia/Kolkata)  
**Dashboard:** `https://brokketadmin-dashboard.vercel.app`  
**Backend audited:** `https://test.api.propertymaster.com/api/v1/ceo-dashboard`  
**Audit mode:** Read-only. No database or API records were created, updated, or deleted.

## 1. Executive conclusion

The dashboard is **not yet reliable enough for executive decision-making**. Most endpoint totals reconcile internally, but several material figures and visualizations are incorrect or misleading.

The most serious issues are:

1. **Active users are displayed as zero although the login API reports 1,028 unique active users for the same 30-day period.**
2. **The listings transaction-type breakdown is incomplete and nondeterministic.** Identical requests alternated between `Sale=374` and `Sale=847/848`, while the headline total remained 1,282/1,283.
3. **Subscription definitions conflict.** The API reports 249 active paid subscribers, while non-trial plan rows total 4,581.
4. **The registrations-vs-logins chart compares arrays by position after discarding their date labels.** For the audited 30-day period, registrations contain 30 buckets starting 10 September, while logins contain 11 buckets starting 29 September. The two lines therefore do not share the same x-axis dates.
5. **The “likes / new listing” figure is hard-coded to 1.76.** It does not respond to the selected period or live API data.
6. **Historical subscription revenue is incomplete by design but is presented as “All-time revenue.”** The backend documentation states that pre-ledger renewals and refunds cannot be reconstructed.
7. **App downloads, Circle activity, Clips, and Blinks are not supplied by the current API and are not present on the dashboard.**

## 2. Scope and methodology

The audit covered:

- all 19 documented CEO Dashboard endpoints;
- the 1-day, 7-day, 30-day, 90-day, and 365-day ranges ending 9 October 2026;
- day and month grouping;
- all-city and selected-city behavior;
- listing transaction-type filters;
- overview-to-detail, overview-to-trend, overview-to-city, and revenue-to-ledger-trend reconciliation;
- frontend mappings, derived calculations, date logic, charts, percentages, and failure handling;
- repeated identical requests to test determinism;
- API validation for malformed dates, reversed ranges, and invalid transaction types.

The automated audit performed 61 primary reconciliation and quality checks for the 30-day window. **54 passed and 7 failed.** Additional frontend review identified further presentation and coverage defects.

### Important limitation

No read-only database connection, database export, or backend aggregation source code was available. Therefore this audit independently validates the dashboard against the public test API and reconciles API families against each other, but it **cannot certify raw-document accuracy, detect every duplicate source record, or prove that the test API matches the production database**.

## 3. Audited 30-day snapshot

The figures below are a live snapshot for **10 September through 9 October 2026**. The API changed slightly during the audit as new records arrived.

| Metric | Audited value | Reconciliation result |
|---|---:|---|
| Total users | 11,098 | Matches user overview |
| New registrations | 2,244 | Matches registration trend total |
| Active users in overview | 0 | **Fails:** login API reports 1,028 unique active users |
| Login attempts | 1,181 | 1,099 successful + 82 failed |
| Login success rate | 93.0567% | Formula is correct; dashboard rounds to 93.1% |
| New listings | 1,283 | Matches listing trend and city totals |
| Active listings | 11,066 | Matches listing overview |
| Listing type total | 909 in the stable filtered result | **Fails:** 374 listings are not represented |
| Tracked likes | 141 | Matches likes overview, trend, and by-city totals |
| Active paid subscribers | 249 | **Fails:** non-trial plan rows total 4,581 |
| Active including trial | 5,016 | Matches roster total and autopay on/off total |
| New subscription purchases | 25 | Internally consistent with ledger scope |
| Renewals | 0 | Internally consistent with ledger scope |
| Revenue in range | ₹44,885 | Matches revenue-trend total |
| Reported all-time revenue | ₹117,670 | Internally consistent, but historically incomplete |
| All-time unique paying users | 22 | Returned by API but not displayed on dashboard |
| Feed posts | 163 | Internally valid |
| Picture posts | 87 | Approximation: posts containing at least one image |
| Unique content creators | 69 | Internally valid |

## 4. Findings

### C-01 - Active-user KPI is wrong

**Severity:** Critical  
**Evidence:** For the same 30-day filter, `/overview` and `/users/overview` return `activeUsersInRange=0`, while `/logins/overview` returns `uniqueActiveUsers=1028`. Today alone, the APIs returned 0 active users versus 47 unique successful users.

**Dashboard impact:** The headline Active users tile and the “unique active users” text in the Login Success card both display the incorrect overview value. The frontend fetches the correct login value but never uses it for the unique-user display.

**Root cause:** Backend definitions/sources are inconsistent, and the frontend maps both displays to `overview.activeUsersInRange`.

**Recommended correction:**

- Define “active user” once: a distinct username with at least one successful `LOGIN` event in the selected range.
- Fix `/overview` and `/users/overview` to use the same source as `/logins/overview.uniqueActiveUsers`.
- Until the backend is corrected, display `loginOverview.uniqueActiveUsers` in the Login Success card and show a data-quality warning on the headline Active users KPI.

### C-02 - Listing transaction mix is incomplete and nondeterministic

**Severity:** Critical  
**Evidence:** A 30-day headline total of 1,283 reconciles to the listing trend. Direct type-filtered calls returned Sale 848, Rent 53, Mandate 2, Requirement 6, totaling 909. The remaining **374 listings (29.2%)** are not represented by a valid type. Ten identical unfiltered overview calls alternated between `Sale=374` and `Sale=847/848` while the headline total stayed fixed.

**Dashboard impact:** The Supply Mix donut and “listings added” count can show a different result after refresh and can understate supply by hundreds of listings.

**Likely root cause:** Legacy/null transaction types are being defaulted into a key that collides with the real Sale key, so one group overwrites the other depending on aggregation result order. This inference must be confirmed in backend source.

**Recommended correction:**

- Return explicit `Unknown`/`Unclassified` for null or legacy transaction types.
- Never map an unknown group to Sale.
- Make the aggregation deterministic and assert that `sum(byTransactionType) == newListingsInRange`.
- Backfill or classify the 374 untyped records after a separate data-governance review; do not alter them as part of this audit.

### C-03 - Subscription active-paid and plan totals conflict

**Severity:** Critical  
**Evidence:** `totalActiveSubscribers=249`, while non-trial `byPlan.activeSubscribers` values total 4,581. All plan rows total 5,016, exactly matching `totalActiveIncludingTrial` and the roster total.

**Dashboard impact:** “Active paid,” plan mix, and roster describe incompatible populations. A CEO cannot determine whether there are 249 paying subscribers or 4,581 non-trial active entitlements.

**Root cause:** The endpoint appears to mix distinct-user, entitlement, trial, and/or payment-status definitions. The documented example expects plan totals to reconcile to active paid subscribers, but the live response does not.

**Recommended correction:**

- Publish explicit definitions for `active paid user`, `active entitlement`, `trial entitlement`, and `unique paying user`.
- Return both distinct-user and entitlement counts if both are needed.
- Add backend reconciliation tests for plan sums, trial exclusions, and roster totals.
- Do not label entitlement rows as unique “subscribers” unless deduplicated by username.

### C-04 - Growth chart compares different dates at the same x positions

**Severity:** Critical  
**Evidence:** The frontend converts trend objects to count-only arrays and discards `label`. Registrations had 30 daily buckets from 10 September; logins had 11 buckets from 29 September. Each array is independently stretched across the full chart width and x-axis labels are generated as `1, 2, ...`, not actual dates.

**Dashboard impact:** Registration and login lines appear directly comparable but points at the same x-coordinate often represent different calendar dates. Monthly mode shows `1` and `2` instead of September and October.

**Root cause:** Frontend chart preparation removes API bucket labels and does not zero-fill a shared date domain.

**Recommended correction:** Join series by API label, build one shared date/month domain, zero-fill omitted buckets, and render the real labels.

### H-01 - Engagement ratio is hard-coded

**Severity:** High  
**Evidence:** The UI permanently renders `1.76 likes / new listing`. For the audited 30-day range, the live APIs imply either 141/1,283 = **0.11 tracked likes per all new listing**, or 141/8 = **17.63** if the denominator is limited to new Mandate/Requirement listings.

**Dashboard impact:** The metric does not change with period, market, or live data.

**Recommended correction:** Agree on the denominator, calculate it from current API responses, display the formula in a tooltip, and return `N/A` when the denominator is zero.

### H-02 - “All-time revenue” is not complete all-time revenue

**Severity:** High  
**Evidence:** The API scope note states that renewal charges and refunds before the payment-ledger release were not recorded and cannot be reconstructed. The earliest revenue-trend bucket observed was 26 August 2026. The dashboard nevertheless labels ₹117,670 as “All-time revenue.”

**Dashboard impact:** Historical revenue is understated and the label overstates completeness.

**Recommended correction:** Rename to “Tracked revenue since ledger launch,” show the coverage start date prominently, and backfill from the payment provider/accounting source before using “all-time.”

### H-03 - Geography has severe missing attribution

**Severity:** High  
**Evidence for the audited 30-day snapshot:**

- users without a valid city: 1,250 of 2,241 (55.8%);
- login events without a valid city: 670 of 1,097 (61.1%);
- likes without a valid city: 135 of 141 (95.7%);
- duplicate/dirty login city variants include `faridabad`, `Faridabad `, and `faridabad `.

**Dashboard impact:** The frontend correctly excludes invalid/unknown rows and displays a note, but the Market Performance table is not representative of the full funnel. Its likes geography is especially unusable.

**Recommended correction:** Normalize city codes on write, backfill missing city attribution where defensible, retain an explicit Unknown row, and display coverage percentages beside the table.

### H-04 - Requested business domains are absent

**Severity:** High  
**Evidence:** The current API and dashboard contain no metrics for app downloads, Circle activity, Clips, or Blinks. The API reference explicitly says Clips/Blink daily-view tracking requires new frontend events. Circle and downloads have no documented endpoint.

**Dashboard impact:** The requested “entire CEO dashboard” scope cannot be audited or reported because the source data is not exposed.

**Recommended correction:** Define events and source systems, add ingestion coverage checks, and expose dedicated read-only endpoints before adding these KPIs.

### H-05 - Dashboard is connected to a test API, not a proven production source

**Severity:** High  
**Evidence:** Production Vercel is configured to call `test.api.propertymaster.com`.

**Dashboard impact:** Even a perfectly rendered dashboard cannot be certified against production business records unless this test host is confirmed to use the authoritative production database.

**Recommended correction:** Document the environment/data lineage. If executives expect production figures, use a secured production analytics endpoint or an approved read replica.

### M-01 - Undefined growth is displayed as +0.0%

**Severity:** Medium  
**Evidence:** The 365-day user growth API returns `null` because the preceding period has zero registrations. The frontend converts `null` to zero and displays `+0.0%`.

**Recommended correction:** Preserve null and display `N/A - no prior-period baseline`.

### M-02 - Listing velocity renders fabricated secondary bars

**Severity:** Medium  
**Evidence:** For every listing count, the frontend draws a second bar at exactly 58% of the first from the same value. It is not a second API series.

**Dashboard impact:** Users can interpret two colored bars as two business categories or comparisons.

**Recommended correction:** Draw one bar per bucket, or label and source a real second series.

### M-03 - Momentum is a relative UI score, not a backend KPI

**Severity:** Medium  
**Evidence:** City momentum is calculated in the browser as an equal 25% weighting of each city’s users, logins, listings, and likes divided by the maximum city value in the current result set.

**Dashboard impact:** A city’s score can change when another city changes, even if the city itself does not. Missing-city exclusions also distort maxima.

**Recommended correction:** Either label it “Relative index” with the formula, or define a stable business metric in the backend.

### M-04 - “Live” means manual refresh, not real-time synchronization

**Severity:** Medium  
**Evidence:** Data loads at login, filter change, and refresh-button click. There is no timer, push channel, source watermark, or backend `asOf` timestamp. The footer uses browser completion time, not source freshness.

**Recommended correction:** Display a backend `dataAsOf` timestamp and either add an agreed refresh interval or rename the state to “Latest fetched.”

### M-05 - Picture count is an approximation

**Severity:** Medium  
**Evidence:** `picturesUploadedInRange` counts FEED posts with at least one image, not the number of images. A multi-image post counts once.

**Recommended correction:** Keep the current “Picture posts” wording, surface the scope note next to the tile, and add per-media event tracking if true upload counts are required.

### M-06 - Registrations and listing dates have structural limitations

**Severity:** Medium  
**Evidence:** Registration dates are derived from Mongo ObjectId timestamps; re-inserted users appear newly registered. Listing dates are strings and depend on a fixed zero-padded format for correct range filtering.

**Recommended correction:** Add canonical native date fields and migrate cautiously with validation totals.

### M-07 - Global filters do not apply uniformly

**Severity:** Medium  
**Evidence:** The city selector affects users, logins, listings, and likes, but intentionally does not affect subscriptions or content because those endpoints have no city filter. The UI does not make this boundary prominent.

**Recommended correction:** Label sections as “All cities” where the global Market filter does not apply.

### M-08 - Core refresh is all-or-nothing

**Severity:** Medium  
**Evidence:** One failed core request clears all core widgets even if the other 13 calls succeeded. Addendum sections use partial failure handling, but the main dashboard does not.

**Recommended correction:** Render endpoint families independently with per-section error and stale-data indicators.

## 5. Checks that passed

- New registration totals matched registration-trend sums.
- Registration day and month totals matched for the 30-day range.
- Login attempts equaled successful plus failed attempts.
- Login success-rate formula matched the API values.
- Successful-login totals matched login-trend and login-by-city sums.
- New-listing headline totals matched listing-trend and listing-by-city sums.
- Direct listing type filters reconciled individually with their trends.
- Tracked-like totals matched likes overview, trend, and by-city results.
- Subscription revenue-in-range matched the sum of revenue-trend buckets.
- Autopay-on plus autopay-off matched the full roster total.
- Roster filtered totals reconciled to the unfiltered roster.
- Content creators and picture posts did not exceed total feed posts.
- Day and month groupings produced the same totals for users, logins, listings, likes, and revenue.
- Invalid dates, reversed ranges, and invalid listing types correctly returned HTTP 400.
- API responses and the dashboard proxy use no-store/no-cache behavior.

## 6. Historical coverage and anomalies requiring source review

- Login trend data begins on 29 September 2026. The 30-, 90-, and 365-day login totals were identical during the audit. This suggests tracking/history starts on that date or earlier data is unavailable.
- Like-event history begins on 8 September 2026 and covers only Mandate/Requirement events.
- Revenue trend history begins on 26 August 2026 and is explicitly incomplete before ledger deployment.
- Registrations show a major spike of 1,586 on 5 August 2026.
- Listings show major spikes of 2,311 on 12 June, 1,344 on 18 June, and 1,386 on 5 August 2026.

These spikes may be valid campaigns or imports, but they are large enough to require raw-record checks for batch migration, re-insertion, or duplicate creation.

## 7. Database checks required to complete certification

To certify against original records, provide a read-only database user, sanitized export, or results from controlled queries covering:

- `User`: total documents, unique username/phone, ObjectId timestamp distribution, city-code completeness, duplicate identifiers;
- `LoginHistory`: successful/failed LOGIN events, unique usernames, earliest event, duplicate event IDs, and orphan usernames;
- `PropertyListing`: active rows, null/invalid transaction types, unique listing IDs, string-date validity, creator and city completeness;
- `ContentAction`: duplicate LIKE events, listing joins, action timestamps, and city attribution;
- `UserSubscriptionPlan`: active entitlements, distinct users, trial status, overlapping active plans, expiry consistency;
- `RecurringSubscription`: latest mandate per user/plan, duplicate mandates, status consistency;
- payment ledger: unique payment/refund IDs, purchase/renewal classification, amounts, refund linkage, and earliest tracked event;
- `SocialPost`: active FEED posts, media arrays, unique creators, and duplicate posts;
- the event/analytics stores intended to supply downloads, Circle, Clips, and Blinks.

The database work must run against a read replica or read-only account. No repair or backfill should be combined with the audit query session.

## 8. Recommended remediation order

1. Fix active-user source consistency and frontend mapping.
2. Fix nondeterministic/unclassified listing transaction aggregation.
3. Reconcile subscription user-vs-entitlement definitions.
4. Rebuild charts on shared labeled time domains.
5. Remove the hard-coded engagement ratio and static/decorative chart values.
6. Correct historical-revenue wording and add coverage timestamps.
7. Quantify and improve city attribution.
8. Add missing downloads/Circle/Clips/Blinks telemetry and endpoints.
9. Run the database-level audit with read-only access.
10. Add automated reconciliation tests to deployment gates.

## 9. Audit artifacts

- `audit/dashboard-audit.mjs` - reusable read-only API reconciliation script.
- This report - evidence summary, findings, and remediation plan.

