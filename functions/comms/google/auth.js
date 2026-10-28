/**
 * Cloudflare Pages Function: /comms/google/auth
 * Proxies the Google OAuth auth redirect to the worker.
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  const workerUrl = 'https://prism-api.identitypartners.workers.dev' + url.pathname + url.search;
  
  try {
    const response = await fetch(workerUrl, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    });
    return response;
  } catch (e) {
    return new Response('Auth error: ' + e.message, { status: 500 });
  }
}
