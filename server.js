const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_PREFIX = '/api/ceo-dashboard';
const BACKEND = process.env.BROKKET_API_BASE_URL;

if (!BACKEND) {
  console.error('BROKKET_API_BASE_URL is required.');
  process.exit(1);
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

async function proxyApi(request, response, url) {
  const apiPath = url.pathname.slice(API_PREFIX.length);
  if (!apiPath || apiPath.includes('..')) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: false, message: 'Invalid API path' }));
    return;
  }

  const target = `${BACKEND}${apiPath}${url.search}`;
  try {
    const headers = { Accept: 'application/json' };
    if (process.env.BROKKET_API_BEARER_TOKEN) {
      headers.Authorization = `Bearer ${process.env.BROKKET_API_BEARER_TOKEN}`;
    }
    if (process.env.BROKKET_API_KEY) {
      headers['x-api-key'] = process.env.BROKKET_API_KEY;
    }

    const upstream = await fetch(target, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(502, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({
      success: false,
      message: 'The Brokket data service is temporarily unavailable.',
    }));
    console.error('Backend request failed:', error.message);
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname.startsWith(`${API_PREFIX}/`)) {
    await proxyApi(request, response, url);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const file = staticFiles.get(url.pathname);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  const [filename, contentType] = file;
  fs.readFile(path.join(__dirname, filename), (error, contents) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to load dashboard');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': filename === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Brokket CEO Dashboard running at http://${HOST}:${PORT}`);
});
