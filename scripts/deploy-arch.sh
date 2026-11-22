#!/usr/bin/env bash
# Deploy the Argentica UI to the Cloudflare Pages project "arch"
# (arch.identitypartners.uk) without touching the prism Pages project.
#
# Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.

set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -r argentica "$STAGE/"
mkdir -p "$STAGE/shared"
cp shared/argentica.css shared/argentica.js "$STAGE/shared/"
cp -r shared/assets "$STAGE/shared/"
cp index.html _headers "$STAGE/"
cp favicon.ico favicon-16.png favicon-32.png apple-touch-icon.png "$STAGE/" 2>/dev/null || true
cp shared/assets/favicon-192.png shared/assets/favicon-512.png "$STAGE/" 2>/dev/null || true

cp argentica/login.html "$STAGE/login.html" 2>/dev/null || cp argentica/../login.html "$STAGE/login.html" 2>/dev/null || true

cat > "$STAGE/_worker.js" <<'EOF'
// Argentica Pages worker — proxies /api/* to prism-api (secrets) and gates the whole site behind the password lock.
const PRISM = 'https://prism-api.identitypartners.workers.dev';
function authCookie(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)arg_auth=([a-f0-9]{64})/);
  return m ? m[1] : null;
}
function isPublicPath(path) {
  return path === '/' || path === '/login.html' || path === '/login' || path === '/favicon.ico' ||
    path === '/favicon-16.png' || path === '/favicon-32.png' || path === '/apple-touch-icon.png' ||
    path === '/favicon-192.png' || path === '/favicon-512.png' ||
    path.startsWith('/shared/') ||   // login page styles use these too
    path.startsWith('/api/auth/');
}
async function proxy(request, url, extraHeaders) {
  const target = PRISM + url.pathname + (url.search || '');
  const h = new Headers(request.headers);
  h.delete('content-length');
  const body = (request.method !== 'GET' && request.method !== 'HEAD') ? await request.arrayBuffer() : undefined;
  const resp = await fetch(target, { method: request.method, headers: h, body, redirect: 'manual' });
  if (!extraHeaders) return resp;
  const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  for (const [k, v] of Object.entries(extraHeaders)) out.headers.append(k, v);
  return out;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/api/')) {
      // login/logout set/clear the trusted-device cookie here, HttpOnly
      if (path === '/api/auth/login' && request.method === 'POST') {
        const r = await proxy(request, url);
        if (r.ok) {
          try {
            const body = await r.json();
            if (body && body.success && body.token) {
              return new Response(JSON.stringify({ success: true, firstTime: !!body.firstTime }), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Set-Cookie': 'arg_auth=' + body.token + '; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Lax',
                  'Access-Control-Allow-Origin': request.headers.get('Origin') || ''
                }
              });
            }
          } catch (e) {}
        }
        return r;
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        await proxy(request, url);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'arg_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' }
        });
      }
      if (!isPublicPath(path)) {
        const tok = authCookie(request);
        let ok = false;
        if (tok) { try { ok = (await fetch(PRISM + '/api/auth/check', { headers: { 'X-Arg-Auth': tok } })).ok; } catch (e) {} }
        if (!ok) return new Response(JSON.stringify({ error: 'auth required' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      return proxy(request, url);
    }
    // page/asset requests
    if (!isPublicPath(path)) {
      const tok = authCookie(request);
      let ok = false;
      if (tok) { try { ok = (await fetch(PRISM + '/api/auth/check', { headers: { 'X-Arg-Auth': tok } })).ok; } catch (e) {} }
      if (!ok) {
        return new Response(null, { status: 302, headers: { Location: '/login.html' } });
      }
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
      out.headers.append('Set-Cookie', 'arg_auth=' + tok + '; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Lax');
      return out;
    }
    return env.ASSETS.fetch(request);
  },
};
EOF

npx -y wrangler@latest pages deploy "$STAGE" --project-name=arch --branch=main
