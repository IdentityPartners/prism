export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const workerUrl = "https://prism-api.identitypartners.workers.dev" + url.pathname + url.search;
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
