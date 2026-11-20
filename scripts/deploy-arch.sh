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

cat > "$STAGE/_worker.js" <<'EOF'
// Argentica Pages worker — proxies /api/* to prism-api (which holds all secrets)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const target = 'https://prism-api.identitypartners.workers.dev' + url.pathname + (url.search || '');
      const h = new Headers(request.headers);
      h.delete('content-length'); // avoid stream/mismatch truncation to the API
      const body = (request.method !== 'GET' && request.method !== 'HEAD') ? await request.arrayBuffer() : undefined;
      return fetch(target, {
        method: request.method,
        headers: h,
        body,
      });
    }
    return env.ASSETS.fetch(request);
  },
};
EOF

npx -y wrangler@latest pages deploy "$STAGE" --project-name=arch --branch=main
