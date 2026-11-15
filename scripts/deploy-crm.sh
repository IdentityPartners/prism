#!/usr/bin/env bash
# Deploy the Argentica CRM to the Cloudflare Pages project "ipcrm"
# (crm.identitypartners.uk). Root lands on the CRM; the full app is served too.
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

cat > "$STAGE/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=/argentica/comms/crm/">
<title>Identity Partners — CRM</title>
</head>
<body></body>
</html>
EOF

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

npx -y wrangler@latest pages deploy "$STAGE" --project-name=ipcrm --branch=main
