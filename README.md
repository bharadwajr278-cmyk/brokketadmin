# Brokket CEO Dashboard

Production-ready Node.js dashboard using the live Brokket CEO Dashboard API.

Configure these values in the production host's environment, not in Git:

```text
BROKKET_API_BASE_URL=https://test.api.propertymaster.com/api/v1/ceo-dashboard
BROKKET_API_BEARER_TOKEN=<optional bearer token>
BROKKET_API_KEY=<optional API key>
```

The frontend calls a same-origin authenticated proxy. The Vercel serverless function reads the backend URL and optional credentials from its environment and proxies requests without exposing configuration to browser code. This also avoids browser CORS restrictions.

## Vercel

Import this GitHub repository into Vercel and configure `BROKKET_API_BASE_URL` under Project Settings → Environment Variables. The `api/ceo-dashboard/[...path].js` serverless function keeps the backend URL and optional credentials out of the browser bundle.
