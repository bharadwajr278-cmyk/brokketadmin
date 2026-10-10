# CEO Dashboard audit — 10 October 2026

Scope: production dashboard API responses for 10 October 2026, dashboard calculations, Amplitude Dashboard REST API, property activity, subscriptions, and content. The production database was not directly accessible, so backend API responses are the source records used for reconciliation. No database records were modified.

## Executive result

- Growth, login, listing, likes, and content headline values reconcile with their corresponding trend/source responses for the audited date.
- Property action components reconcile: 7 called + 0 WhatsApped + 1 shared + 13 clicked = 21 total interactions.
- The Amplitude discrepancy is a definition and processing-stage mismatch. Amplitude Live Events is an immediate ingestion stream; `/api/2/realtime` returns processed analytics in fixed 5-minute intervals. The dashboard had labelled the latter “Users live now,” which implied equivalence and was misleading.
- Subscription data contains an unresolved backend inconsistency: 249 “active paid” users versus 4,581 non-trial active plan entitlements. The UI warns about this and does not silently merge the definitions.
- The app-install event remains unavailable from Amplitude (404). Download cards remain hidden instead of displaying zeros.

## Reconciliation evidence

| Area | Source value | Cross-check | Result |
|---|---:|---:|---|
| New registrations | 33 | registration trend sum 33 | Pass |
| Successful logins | 40 | login trend sum 40 | Pass |
| Login attempts | 44 | 40 success + 4 failed | Pass |
| Unique successful-login users | 40 | login overview 40 | Pass |
| New listings | 4 | listing trend sum 4; Sale 4 | Pass |
| Date-ranged likes | 0 | likes trend empty/zero | Pass |
| Feed posts | 4 | backend content overview | Source accepted |
| Picture posts | 4 | backend approximation: feed posts with image media | Qualified |
| Content creators | 2 | backend content overview | Source accepted |
| Property interactions | 21 | action components total 21 | Pass |
| Amplitude DAU | 56 | single daily series point 56 | Pass |
| Subscription revenue today | ₹0 | empty daily revenue trend | Pass |
| Recorded all-time payments | 42 | 23 distinct paying customers | Definitions consistent |

## Issues and corrections

### High — Live Events count did not match the dashboard

Root cause: the UI compared two different Amplitude products. Live Events displays a near-real-time ingestion stream; the supported Dashboard REST endpoint reports processed unique active users in fixed 5-minute buckets and may lag. At the audit point the API returned 3 for the 05:25 project-time bucket while the Live Events screenshot showed 18.

Correction:

- Renamed the KPI to **Amplitude active users · 5 min**.
- Added the exact interval timestamp and “processed” definition.
- Polls the live-only endpoint every 60 seconds without reloading the entire dashboard.
- Added an on-screen explanation of why Live Events can temporarily be higher.
- Kept Amplitude credentials server-side.

The exact Live Events badge is not exposed by the documented Dashboard REST API. Reproducing that badge would require an approved Amplitude API/export that exposes the ingestion stream; browser-session cookies must not be copied into production.

### High — Subscription active counts use incompatible definitions

Source response: 249 active paid users, but non-trial plan rows total 4,581 entitlements. These cannot both be presented as the same population.

Correction: the dashboard preserves the backend values but labels plan rows as entitlements and displays a data-quality warning. Backend owners must reconcile user-level paid status versus entitlement-row counting before either total is used for board reporting.

### High — Query-cost unit needs backend confirmation

Source response reports ₹948,092,015.50 for 21 interactions on the audited date. The dashboard does not recalculate this figure, so arithmetic is faithful to the source, but the unit/magnitude cannot be independently verified without the database schema or cost contract.

Correction: action totals now reconcile at render time and display a warning if component totals differ. Backend owners must confirm whether `totalQueryCost` is rupees, paise, credits, or another unit before the figure is used financially.

### Medium — Download event unavailable

Amplitude returns 404 for `app_install_event`; therefore Android/iOS download totals cannot be validated.

Correction: unavailable download metrics are hidden, not shown as zero. Configure the actual tracked install event name in `AMPLITUDE_INSTALL_EVENT` when known.

### Medium — Likes have limited scope

The backend date-ranged likes metric covers Mandate and Requirement content-action events only. Sale and Rent store lifetime counters without dated events.

Correction: the dashboard explicitly labels the KPI and denominator as Mandate/Requirement only.

## Remaining source-system actions

1. Provide a documented Amplitude endpoint/export for the exact Live Events badge if exact ingestion-stream parity is required.
2. Reconcile paid-user and plan-entitlement definitions in the subscription API.
3. Document and correct the unit of `totalQueryCost` in the backend contract.
4. Supply the actual Amplitude app-install event name, or instrument one consistently across Android and iOS.
5. Grant read-only database/reporting access if record-level validation (duplicates, missing rows, historical backfills) is required beyond API-level reconciliation.

## Graph and date-filter validation

Validated on 10 October 2026 against 1-day, 7-day, 30-day, and 12-month API ranges using both daily and monthly grouping.

- Registration trend sums reconcile with the new-user headline in every tested range.
- Successful-login trend sums reconcile with the login overview in every tested range.
- Listing trend sums reconcile with the listing overview in every tested range.
- Likes trend sums reconcile with the date-ranged likes headline in every tested range.
- Revenue trend sums reconcile with `revenueInRange`; for 11 September–10 October the sum is ₹45,585.
- Preset ranges now use Asia/Kolkata calendar dates and include today exactly once.
- Missing time buckets are rendered as zero instead of being skipped, so gaps are not visually compressed.
- Single-day line charts render a centered point rather than a misleading triangular area.
- Zero-value bars have zero height rather than appearing as small positive values.
- Daily/monthly subtitles update with the selected grouping.
- The headline previously labelled “Active users” is now “Users who logged in,” matching its backend definition: unique users with a successful login in the selected range.
- A runtime reconciliation guard now displays a dashboard warning if headline totals diverge from graph totals.
