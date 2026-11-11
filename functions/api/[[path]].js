// functions/api/[[path]].js
// Argentica API Proxy — routes all requests to prism-api (has all secrets)
// Split workers (prism-core, prism-research, etc.) are ready for future migration
// when secrets are copied across via the Secret Ingester

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // All API requests go to prism-api which has all 106 secrets
  const targetUrl = 'https://prism-api.identitypartners.workers.dev' + path + (url.search || '');

  const forwardedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });

  try {
    const response = await fetch(forwardedRequest);
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Worker unavailable: ' + e.message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
