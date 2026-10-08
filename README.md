# Brokket CEO Dashboard

Production-ready Node.js dashboard using the live Brokket CEO Dashboard API.

Configure these values in the production host's environment, not in Git:

```text
BROKKET_API_BASE_URL=<private HTTP API base URL>
BROKKET_API_BEARER_TOKEN=<optional bearer token>
BROKKET_API_KEY=<optional API key>
```

The frontend only calls the same-origin `/api/ceo-dashboard/*` route. The Vercel serverless function reads the private backend URL and optional credentials from its environment and proxies requests without exposing them to browser code. This also avoids browser CORS restrictions.

## Vercel

Import this GitHub repository into Vercel and configure `BROKKET_API_BASE_URL` under Project Settings → Environment Variables. The `api/ceo-dashboard/[...path].js` serverless function keeps the backend URL and optional credentials out of the browser bundle.
