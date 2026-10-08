# Brokket CEO Dashboard

Production-ready Node.js dashboard using the live Brokket CEO Dashboard API.

## Run

```bash
npm start
```

The server listens on `0.0.0.0:3000` by default. Set `PORT` to use another port.

Configure these values in the production host's environment, not in Git:

```text
BROKKET_API_BASE_URL=<private HTTP API base URL>
BROKKET_API_BEARER_TOKEN=<optional bearer token>
BROKKET_API_KEY=<optional API key>
```

The frontend only calls the same-origin `/api/ceo-dashboard/*` route. The Node server reads the private backend URL and optional credentials from its environment and proxies requests without exposing them to browser code. This also avoids browser CORS restrictions.

Deploy this application on an HTTP-capable Node.js host, set `BROKKET_API_BASE_URL`, and run `npm start`.
