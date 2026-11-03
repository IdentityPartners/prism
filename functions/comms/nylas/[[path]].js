export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Only proxy the OAuth auth and callback routes to the worker
  // All other paths (e.g. /comms/nylas/connect/) are served as static files by Pages
  if (pathname === '/comms/nylas/auth' || pathname === '/comms/nylas/callback') {
    const workerUrl = "https://prism-api.identitypartners.workers.dev" + pathname + url.search;
    try {
      const response = await fetch(workerUrl, {
        method: request.method,
        headers: request.headers,
        redirect: "manual",
      });
      return response;
    } catch (e) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  }

  // For all other paths under /comms/nylas/, let Pages serve the static file
  return context.next();
}
