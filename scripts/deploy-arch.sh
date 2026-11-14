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

cat > "$STAGE/_worker.js" <<'EOF'
// Argentica Pages worker — proxies /api/* to prism-api (which holds all secrets)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const target = 'https://prism-api.identitypartners.workers.dev' + url.pathname + (url.search || '');
      return fetch(target, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
    }
    return env.ASSETS.fetch(request);
  },
};
EOF

npx -y wrangler@latest pages deploy "$STAGE" --project-name=arch --branch=main
