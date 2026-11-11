// functions/api/[[path]].js
// Argentica API Proxy — routes requests to the correct worker by path prefix
// Auto-generated — do not edit manually

const WORKERS = {
  core:     'https://prism-core.identitypartners.workers.dev',
  research: 'https://prism-research.identitypartners.workers.dev',
  content:  'https://prism-content.identitypartners.workers.dev',
  study:    'https://prism-study.identitypartners.workers.dev',
  comms:    'https://prism-comms.identitypartners.workers.dev',
  system:   'https://prism-system.identitypartners.workers.dev',
};

// Route prefix → worker name (longest prefix wins)
const ROUTE_MAP = [
  ['/api/ingest-secrets', 'core'],
  ['/api/orchestrator', 'core'],
  ['/api/image-search', 'content'],
  ['/api/monetisation', 'content'],
  ['/api/workspaces', 'core'],
  ['/api/marketing', 'content'],
  ['/api/documents', 'study'],
  ['/api/workflows', 'study'],
  ['/api/requests', 'core'],
  ['/api/research', 'research'],
  ['/api/pipeline', 'content'],
  ['/api/linkedin', 'content'],
  ['/api/telegram', 'content'],
  ['/api/platform', 'content'],
  ['/api/document', 'study'],
  ['/api/onedrive', 'comms'],
  ['/api/calendar', 'comms'],
  ['/api/threads', 'core'],
  ['/api/devteam', 'core'],
  ['/api/outlook', 'comms'],
  ['/api/msgraph', 'comms'],
  ['/api/memory', 'core'],
  ['/api/events', 'core'],
  ['/api/search', 'research'],
  ['/api/canvas', 'content'],
  ['/api/images', 'content'],
  ['/api/social', 'content'],
  ['/api/buffer', 'content'],
  ['/api/agents', 'study'],
  ['/api/google', 'comms'],
  ['/api/gdrive', 'comms'],
  ['/api/twenty', 'comms'],
  ['/api/embed', 'core'],
  ['/api/study', 'core'],
  ['/api/image', 'content'],
  ['/api/video', 'content'],
  ['/api/music', 'content'],
  ['/api/voice', 'content'],
  ['/api/macro', 'study'],
  ['/api/agent', 'study'],
  ['/api/nylas', 'comms'],
  ['/api/azure', 'comms'],
  ['/api/chat', 'core'],
  ['/api/news', 'research'],
  ['/api/site', 'research'],
  ['/api/jobs', 'study'],
  ['/api/zoho', 'comms'],
  ['/api/live', 'system'],
  ['/api/whop', 'system'],
  ['/api/rag', 'core'],
  ['/api/rss', 'research'],
  ['/api/tts', 'content'],
  ['/api/stt', 'content'],
  ['/api/pdf', 'study'],
  ['/api/ocr', 'study'],
  ['/api/crm', 'comms'],
  ['/api/kv', 'core'],
  ['/api/mm', 'content'],
];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Find matching worker (longest prefix wins)
  let targetWorker = null;
  for (const [prefix, workerName] of ROUTE_MAP) {
    if (path.startsWith(prefix)) {
      targetWorker = WORKERS[workerName];
      break;
    }
  }

  if (!targetWorker) {
    return new Response(JSON.stringify({ error: 'No worker for path: ' + path }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Forward request to target worker
  const targetUrl = targetWorker + path + (url.search || '');
  const forwardedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });

  try {
    const response = await fetch(forwardedRequest);
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Worker unavailable: ' + e.message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
