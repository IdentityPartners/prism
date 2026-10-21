# Railway and Free Alternatives

## Railway (railway.app)
- PaaS for persistent Node.js/Python/Docker containers
- ~/month for 512MB container
- Use case: persistent Playwright server for canvas PNG generation
- Setup: Deploy playwright-service/ folder, set PORT=3000
- Worker calls: POST https://your-service.up.railway.app/screenshot

## Free Alternatives to Railway

### Render.com (render.com)
- Free tier: 750 hours/month (enough for 1 always-on service)
- Spins down after 15min inactivity (30s cold start)
- Good enough for non-time-critical canvas generation
- Deploy: Connect GitHub repo, select playwright-service/

### Fly.io (fly.io)
- Free tier: 3 shared-cpu-1x VMs (256MB RAM each)
- Always-on possible within free tier
- Better cold start than Render
- Deploy: fly launch --name argentica-playwright

### Koyeb (koyeb.com)
- Free tier: 2 nano instances (512MB RAM)
- Always-on, no spin-down
- Good reliability
- Deploy via GitHub or Docker

### Glitch.com
- Free, always-on for small apps
- Limited to Node.js
- 512MB RAM
- Good for lightweight Playwright tasks

## Recommendation
1. Start with Render.com (free, easy GitHub deploy)
2. Upgrade to Railway (/month) when canvas reliability matters
3. Fly.io is the best free option for always-on

## RAG / Vector Knowledge Framework

### Do NOT use LangChain for Argentica
- LangChain requires a Python/Node.js server process
- Cloudflare Workers cannot run LangChain
- Adds unnecessary complexity and dependencies

### What Argentica already has (correct approach)
- D1 (SQLite) stores document chunks + embeddings
- Gemini embedding-001 generates embeddings (free)
- Cosine similarity search in the Worker (pure JS, no framework)
- This is production-grade RAG without any framework

### If you want a vector database upgrade
- **Cloudflare Vectorize** - Native CF vector DB, integrates directly with Workers
  - Free tier: 5M vectors, 30M queried dimensions/month
  - Best choice: zero latency, same CF account
  - Enable: wrangler vectorize create argentica-rag --dimensions=768 --metric=cosine
- **Upstash Vector** - Serverless vector DB, HTTP API
  - Free tier: 10K vectors, 10K queries/day
  - Works from Workers via HTTP
- **Pinecone** - Industry standard, free tier available
  - Overkill for current scale

### Recommendation
Switch D1 RAG to Cloudflare Vectorize when you have 10K+ chunks.
Current D1 approach is fine for the Dosierofharms.md scale.
