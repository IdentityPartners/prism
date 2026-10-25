// Pass-through: let Cloudflare Pages serve static files normally
export async function onRequest(context) {
  return context.next();
}
