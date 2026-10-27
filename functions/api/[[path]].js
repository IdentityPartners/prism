/**
 * Cloudflare Pages Function: /api/* proxy to prism-api Worker
 * This file takes priority over static files and _redirects for /api/* paths.
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Build the worker URL — preserve the full /api/... path
  const workerUrl = 'https://prism-api.identitypartners.workers.dev' + url.pathname + url.search;
  
  // Forward the request to the worker
  const workerRequest = new Request(workerUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  });
  
  try {
    const response = await fetch(workerRequest);
    // Return the worker response with CORS headers preserved
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
