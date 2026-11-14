/**
 * Cloudflare Pages Function: /comms/google/callback
 * Proxies the Google OAuth callback to the worker which handles token exchange.
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Forward to worker
  const workerUrl = 'https://prism-api.identitypartners.workers.dev' + url.pathname + url.search;
  
  try {
    const response = await fetch(workerUrl, {
      method: request.method,
      headers: request.headers,
    });
    return response;
  } catch (e) {
    return new Response('<h2>OAuth callback error: ' + e.message + '</h2>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
