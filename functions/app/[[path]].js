export async function onRequest(context) {
  // Serve the React app's index.html for all /app/* routes
  // This enables client-side routing (React Router)
  const url = new URL(context.request.url);
  
  // Serve static assets directly (JS, CSS, images)
  if (url.pathname.match(/\.(?:js|css|png|svg|ico|woff2?|ttf|json)$/)) {
    return context.next();
  }
  
  // For all other /app/* routes, serve the React index.html
  const indexUrl = new URL('/app/index.html', url.origin);
  const indexReq = new Request(indexUrl.toString(), context.request);
  return context.env.ASSETS.fetch(indexReq);
}
