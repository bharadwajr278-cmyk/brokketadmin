# Brokket CEO Dashboard

Production-ready Node.js dashboard using the live Brokket CEO Dashboard API v1.1.0.

The dashboard covers the original 15 growth, login, listing, likes and city endpoints plus the v1.1.0 subscription and content additions:

- subscription overview and net-revenue trend
- paginated active-subscriber roster with autopay filtering
- feed posts, picture-post approximation and unique content creators
- authenticated property actions (called, WhatsApped, shared and all interactions)
- selected-period query cost with a daily trend for up to the latest 7 days

Configure these values in the production host's environment, not in Git:

```text
BROKKET_API_BASE_URL=https://test.api.propertymaster.com/api/v1/ceo-dashboard
BROKKET_AUTH_URL=https://test.api.propertymaster.com/api/user/login-with-password
BROKKET_API_KEY=<optional API key>
DASHBOARD_SESSION_SECRET=<long random secret>
DASHBOARD_ALLOWED_ROLES=ADMIN
```

The frontend signs in through a same-origin serverless endpoint using country code, phone and password. The backend response is reduced to the user ID, role and API tokens, encrypted into a Secure/HttpOnly/SameSite cookie, and never exposed to browser JavaScript. Dashboard API calls pass through the authenticated same-origin proxy, which forwards the session access token and user ID to the backend. Only roles listed in `DASHBOARD_ALLOWED_ROLES` can open the dashboard.

The property-activity endpoint additionally requires the backend `JSESSIONID`. It is captured during login, encrypted inside the same dashboard session cookie, and forwarded only by the server-side property-activity proxy.

## Vercel

Import this GitHub repository into Vercel and configure `BROKKET_API_BASE_URL` under Project Settings → Environment Variables. The `api/ceo-dashboard/[...path].js` serverless function keeps the backend URL and optional credentials out of the browser bundle.
