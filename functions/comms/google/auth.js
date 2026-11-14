/**
 * Cloudflare Pages Function: /comms/google/auth
 * Redirects to Google OAuth via the worker directly (not via Pages URL to avoid loop)
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Call worker directly — NOT via prism.identitypartners.uk (would loop)
  const workerUrl = 'https://prism-api.identitypartners.workers.dev' + url.pathname + url.search;
  
  try {
    const response = await fetch(workerUrl, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    });
    return response;
  } catch (e) {
    return new Response('OAuth error: ' + e.message, { status: 500 });
  }
}
