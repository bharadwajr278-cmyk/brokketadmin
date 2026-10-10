# Brokket CEO Dashboard

Production-ready Node.js dashboard using the live Brokket CEO Dashboard API v1.1.0.

The dashboard covers the original 15 growth, login, listing, likes and city endpoints plus the v1.1.0 subscription and content additions:

- subscription overview and net-revenue trend
- paginated active-subscriber roster with autopay filtering
- feed posts, picture-post approximation and unique content creators
- authenticated property actions (called, WhatsApped, shared and all interactions)
- selected-period query cost with a daily trend for up to the latest 7 days
- Amplitude daily active users and daily unique app installs split by Android and iOS

Configure these values in the production host's environment, not in Git:

```text
BROKKET_API_BASE_URL=https://test.api.propertymaster.com/api/v1/ceo-dashboard
BROKKET_AUTH_URL=https://test.api.propertymaster.com/api/user/login-with-password
BROKKET_API_KEY=<optional API key>
DASHBOARD_SESSION_SECRET=<long random secret>
DASHBOARD_ALLOWED_ROLES=ADMIN
AMPLITUDE_API_KEY=<Amplitude project API key>
AMPLITUDE_SECRET_KEY=<Amplitude project secret key>
AMPLITUDE_INSTALL_EVENT=app_install_event
AMPLITUDE_PLATFORM_PROPERTY=platform
REPORT_DEFAULT_RECIPIENT=bharadwajr278@gmail.com
RESEND_API_KEY=<Resend API key>
REPORT_EMAIL_FROM="Brokket CEO Dashboard <reports@your-verified-domain.com>"
CRON_SECRET=<long random secret>
BROKKET_REPORT_PHONE=<dedicated ADMIN reporting account phone>
BROKKET_REPORT_COUNTRY_CODE=+91
BROKKET_REPORT_PASSWORD=<dedicated ADMIN reporting account password>
```

The frontend signs in through a same-origin serverless endpoint using country code, phone and password. The backend response is reduced to the user ID, role and API tokens, encrypted into a Secure/HttpOnly/SameSite cookie, and never exposed to browser JavaScript. Dashboard API calls pass through the authenticated same-origin proxy, which forwards the session access token and user ID to the backend. Only roles listed in `DASHBOARD_ALLOWED_ROLES` can open the dashboard.

The property-activity endpoint additionally requires the backend `JSESSIONID`. It is captured during login, encrypted inside the same dashboard session cookie, and forwarded only by the server-side property-activity proxy.

Amplitude credentials are used only by the server-side `/api/amplitude` proxy with HTTP Basic authentication. They are never included in frontend JavaScript or returned to the browser.

## Automated daily reports

The **Daily Reports** dashboard section generates professional PDF snapshots, securely archives them in a private Vercel Blob store, tracks delivery status, and supports authenticated downloads and recipient configuration. The Vercel Cron route runs at `02:30 UTC` (`08:00 IST`) and reports the previous complete IST calendar day. The scheduler uses a dedicated ADMIN service account because browser sessions expire after eight hours.

Email delivery uses Resend with three automatic attempts. Configure a verified sender in `REPORT_EMAIL_FROM`; `onboarding@resend.dev` should only be used for initial tests permitted by your Resend account. PDF and API generation errors are logged as structured JSON in Vercel Functions logs and preserved in report metadata where possible.

Connect a **private** Vercel Blob store to the project. The generated PDFs are never exposed as public Blob URLs: downloads stream through the authenticated `/api/reports` endpoint. Circle activity, Clips, Blinks, and any other metric not exposed by the current APIs are disclosed as unavailable and are never estimated.

## Vercel

Import this GitHub repository into Vercel and configure `BROKKET_API_BASE_URL` under Project Settings → Environment Variables. The `api/ceo-dashboard/[...path].js` serverless function keeps the backend URL and optional credentials out of the browser bundle.
