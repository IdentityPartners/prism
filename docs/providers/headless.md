# Headless Browser Options

## Recommended: Browserless.io
**Key:** 2VBTQS7DfiOtyfSdf0c5a562699c83d621a74432c634f555d
**Free tier:** 6 hours/month
**API:** https://chrome.browserless.io/screenshot?token={key}
{"html":"...","options":{"type":"png","clip":{"x":0,"y":0,"width":1080,"height":1080}},"waitForFunction":{"fn":"() => document.title === 'READY'","timeout":10000}}

## Lightpanda (lightpanda.io)
- Free tier available
- Lightweight, fast
- Good for scraping, less reliable for canvas rendering
- API similar to Browserless

## Browserbase (browserbase.com)
- Free tier: 1000 sessions/month
- Playwright-compatible API
- More reliable than Browserless for complex rendering
- Use: const bb = new Browserbase({apiKey: key}); const session = await bb.sessions.create();

## ZenRows (zenrows.com)
- Free tier: 1000 requests/month
- Primarily for web scraping with anti-bot bypass
- Not ideal for canvas rendering
- Better for data extraction from protected sites

## Railway (railway.app) - Persistent Playwright
- ~/month for 512MB container
- Run your own Playwright server
- Most reliable for canvas PNG generation
- No rate limits, no timeouts imposed by third party

## Free Alternatives to Railway
- **Render.com** - Free tier (spins down after 15min inactivity, ~30s cold start)
- **Fly.io** - Free tier (3 shared VMs, always-on possible)
- **Koyeb** - Free tier (2 nano instances, always-on)
- **Deno Deploy** - Free, but no Playwright support
- **Cloudflare Workers** - Cannot run Playwright (no persistent process)

## Recommendation for Argentica
1. Use Browserless.io for canvas generation (existing key, free tier)
2. If Browserless fails, fall back to pre-baked R2 templates
3. When budget allows, add Railway for reliable PNG generation
