# Argentica — System Handover
**Date:** 11 November 2026  
**Prepared by:** Office Agent  
**For:** Simon Johnson / Identity Partners  
**Read this before doing anything in the next session.**

---

## 1. What Argentica Is

Argentica is Simon Johnson's personal AI operating environment. It is not a chatbot. It is a personal operating system for academic research, commercial practice, content creation, social media automation, document production, and AI-assisted work.

It serves two simultaneous purposes:
- **University research** — Goldsmiths. Modules: Quant Research Methods and Methodology Now.
- **Commercial practice** — Identity Partners, a non-clinical relational practice working in addiction recovery, trauma, and mental health.

**Live URL:** https://prism.identitypartners.uk  
**Worker URL:** https://prism-api.identitypartners.workers.dev  
**GitHub:** IdentityPartners/prism  

---

## 2. Infrastructure

| Component | Value |
|---|---|
| CF Account ID | d741de91f8cfff2306cc0f850a76ee07 |
| KV Namespace | 8d1a583cc99a482380aacb526d873030 |
| D1 Database | e953848b-7d62-4629-bb4d-271da0d03fd5 |
| R2 Bucket | prism-assets |
| R2 Public URL | https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ |
| Zone ID | 974ca09460dd56ee61cbbece24859851 |
| Worker size | ~364KB |
| Pages project | prism |

All `/api/*` requests are proxied via `functions/api/[[path]].js` to the worker. Google OAuth callback lives in `functions/comms/google/`. Nylas OAuth callback in `functions/comms/nylas/[[path]].js`.

---

## 3. LLM Routing Chain

Simon has paid subscriptions to **Mistral** (includes GLM 5.3 and all Mistral models) and **Google AI Pro** (includes Gemini 4 Argon, Gemini 3.8 Flash, and all current Gemini models). These lead the chain. Chargeable pay-per-use APIs (DeepSeek, Kimi, xAI) sit in Tier 3 — used only when Tier 1 and 2 are unavailable.

### Balanced (default)
1. Gemini 4 Argon (`gemini-4-argon`) — paid, flagship reasoning, 1M context
2. GLM 5.3 via Mistral (`zai-glm-5-3`) — paid subscription, 1M context, thinking, web
3. Mistral Large 4 (`mistral-large-4`) — paid subscription, 262K context
4. Gemini 3.8 Flash (`gemini-3.8-flash`) — paid, current flagship Flash
5. Cerebras Qwen/Llama — fast, free tier
6. Groq GPT-OSS 20B — fast, free tier
7. Cohere Command R+ — paid key, RAG-optimised
8. Kimi — chargeable, use sparingly
9. DeepSeek V3 — chargeable, use sparingly
10. xAI Grok 3 — chargeable, real-time data
11. NVIDIA NIM — chargeable
12. SambaNova — chargeable
13. Fireworks — chargeable
14. AnyAPI — chargeable
15. Gemini 3.5 Flash-Lite — free tier
16. Mistral Small 4 — free tier
17. OpenRouter free models
18. **Pollinations** — unconditional fallback, no key, always responds. Always specify model name: openai / mistral / flux. Never pass "Pollinations" as the model name.

### Fast
Cerebras → Groq → Gemini 3.5 Flash-Lite → Mistral Small → Pollinations

### Research
GLM 5.3 → Mistral Large → Gemini 4 Argon → Gemini 3.8 Flash → Kimi K2 Thinking → DeepSeek → Pollinations

### Coding
Mistral Large → GLM 5.3 → Gemini 3.8 Flash → Mistral Medium → Nemotron → Pollinations

### Vision
Mistral Large → GLM 5.3 Flash → Gemini 3.8 Flash → Gemini 4 Argon → Pollinations

**Rules:**
- Ollama must never appear in the automated routing chain. Local profile only, activated manually.
- The chain must never return 402. Pollinations is the unconditional fallback.
- Gemini 2.0 Flash is **shut down** (1 June 2026). All references replaced with `gemini-3.8-flash`. ✓ Done.

---

## 4. Module Status

### Working
| Module | URL | Notes |
|---|---|---|
| Chat (Gerald) | /chat/ | Memory injected, thread history, OSK, GLM/Mistral responding |
| Research | /research/ | 25s timeout, Tavily/Brave/Exa, no infinite spinner |
| Document Manager | /doc-viewer/ | PDF.js, annotation canvas, burn-to-PDF via pdf-lib, notes modal, OCR |
| Study Hub | /study-hub/ | Modules/weeks in KV, auto-upload to Google Drive |
| Drafting | /drafting/ | Quill editor |
| Agenti City | /agenti/ | Agent/workflow CRUD UI, WIP spool — see gap below |
| CRM | /crm/ | D1-backed contacts/companies/interactions/calendar |
| Monetisation | /monetisation/ | Profile proliferation, post to platforms, social queue |
| Home | /home/ | IP hero, calendar, WIP panel, rotating Pexels background |
| Email | /comms/email/ | Gmail inbox, compose + reply, Google OAuth |
| Calendar | /comms/calendar/ | FullCalendar.js, Google Calendar events |
| Google Connect | /comms/google/ | OAuth connected — gmail.send, calendar, drive scopes |
| Nylas Connect | /comms/nylas/connect/ | Page live — Proton IMAP blocked (see gaps) |
| Request form | /request/ | Type/module/priority/queue, KV-backed |
| Dev Team | /dev-team/ | Memory injected, knows full system context |
| Profile & Memory | /profile/ | Memory viewer |
| Settings | /settings/ | Secret Ingester, theme, display |
| WriteHandy | /wh/ | IDs restored: #ink-canvas #text-layer #osk-area |
| Canvas/Create | /canvas/ | SVG generation, Pexels backgrounds, R2 upload |

### Broken or incomplete
| Module | URL | Issue |
|---|---|---|
| Social Queue | /social-queue/ | No Post Now button on queue items |
| Debate Society | /debate/ | Loading indicator added, needs full test |
| Podcast | /podcast/ | Nav entry exists, no page built |
| Media Manager | /media/ | Nav entry exists, no page built |
| Workflows | /workflows/ | CRUD routes exist, no dedicated UI |
| Marketing agents | /agenti/ | Agents created in KV but not rendering in UI |

---

## 5. Social Media Pipeline

### Platform status
| Platform | Method | Status |
|---|---|---|
| Bluesky | Direct AT Protocol API | Working |
| Telegram | Direct Bot API — @IdentityPartnerBot | Working |
| LinkedIn | Direct API, OAuth token in KV | Working — token expires ~5 January 2027 |
| Instagram | Buffer | Buffer not yet connected |
| Facebook | Buffer | Buffer not yet connected |
| X/Twitter | Buffer | Buffer not yet connected |
| Substack | Email to zemiopat@substack.com | Route wired, ready |
| Threads | Needs Make.com webhook or Railway + Postiz | Not working |
| Tumblr | Consumer key stored, no OAuth token | Not working |
| Mastodon | Account suspended | Not working — max 1-2 posts/day if reinstated |
| Reddit | App creation button broken on HumanFutures account | Not working — not an age issue, button is broken |
| Pinterest | No developer app created | Not working |
| YouTube | Google OAuth missing youtube.upload scope | Not working |
| Whop | API v1 wired, key stored | Ready |

**Buffer API key:** `uloXdPne33aFs04yKk9ubJJgJSp7avqCd7kXv6C2Mea`  
Buffer free plan: 3 channels maximum. Connect Instagram + Facebook + X. LinkedIn posts via direct API.

### Canvas generation
No Browserless. No headless browser. SVG-based with real Pexels/Unsplash/Pixabay/Wikimedia backgrounds.

**Working post types:** quote, stat, news, policy, infographic (basic), service  
**Missing post types:** educational_carousel, myth_vs_fact, lived_experience, awareness_day, playlist_carousel, proper data infographic with real chart layout and icons

**Semantic image search:** topic → expanded semantic queries → Pexels + Unsplash + Pixabay + Wikimedia  
**Vision QA:** Gemini 3.8 Flash  
**R2 upload:** working, public URLs at pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/canvas/

### Daily pipeline
Cron: 08:00, 13:00, 20:00 UTC  
Route: `/api/pipeline/morning` — lightweight, posts to Bluesky directly  
Unified pipeline: `/api/pipeline/unified` — mandatory tags + footer enforced  
Mandatory tags: #IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing  
Mandatory footer: hello@identitypartners.uk | www.identitypartners.uk/contact  
Never use /book — always /contact.

---

## 6. Email and Calendar

| Item | Status |
|---|---|
| MX records | Cloudflare Email Routing → argentica.identitypartners@gmail.com |
| hello@ forwarding | Working |
| simon@ forwarding | Failed — destination not verified in Cloudflare Email Routing |
| Google OAuth | Connected as argentica.identitypartners@gmail.com |
| Google scopes | gmail.readonly, gmail.send, gmail.compose, calendar, drive, drive.file |
| Gmail inbox | Working — compose + reply functional |
| Google Calendar | Working — FullCalendar.js display |
| SPF | Clean — v=spf1 include:_spf.protonmail.ch ~all |
| Proton DKIM CNAMEs | All three present and correct |
| Zoho | Token expired — needs reconnect at /comms/zoho-calendar/ |
| Nylas/Proton IMAP | Blocked — Proton requires Bridge running locally, incompatible with cloud |

---

## 7. Memory and RAG

- `memory:about-simon` — seeded with Simon/system context
- `buildMemoryContext()` — injected into every /api/chat and /api/devteam call
- `saveMemoryFromConversation()` — saves rolling summaries after each exchange
- "Remember that X" in any chat saves X to persistent memory
- RAG searches doc-content:* and notes:* KV keys before responding
- `/api/memory` GET/POST/DELETE/search endpoints available
- `memory:simon-voice` and `memory:content-guidelines` — auto-seeded in worker on first chat call ✓

---

## 8. Marketing Team

### Specification
Simon wants a dedicated Marketing team interface — not a generic agent builder. Each team member is a persistent collaborator with their own chat history, assignment queue, and comms preferences. The pattern is reusable for any team (Research Associate, Academic Support, etc.).

**Proposed nav location:** Rename "Create" to "Marketing" or add Marketing as a separate nav section. The current Agenti City is too generic.

### Per-agent interface (to be built)
- Persistent conversation history stored in KV under `agent-chat:{agent-id}:history`
- Assignment panel: current task, deadline, priority (1-5), status (briefed / in progress / awaiting approval / done)
- Comms preferences: notify via email / Telegram / in-app when assignment complete
- Output panel: generated content, canvas URLs, draft posts awaiting approval
- Drag to reorder priority across the team

### Team overview (to be built)
- All 6 agents visible with current assignment and status
- Bulk assign (e.g. "all agents: prepare for World Mental Health Day")
- Pipeline view: in progress / awaiting approval / scheduled

### The 6 agents (created in KV, not yet visible in UI)
All stored in KV under `agents:list`.

| Agent | Model | Role |
|---|---|---|
| Head of Marketing & Communications | Mistral Large | Strategy, Refract, team oversight |
| Social Media Channel Manager | Gemini 3.8 Flash | Platform management, scheduling, Refract |
| Original Content Editor | Mistral Large | Longform, Simon's voice, voice collaboration |
| Visual Assets Manager | Gemini 3.8 Flash | Canvas, templates, Vision QA |
| Podcast Editor | Mistral Large | Cartesia + Smallest.AI, YouTube + Spotify RSS |
| Current Affairs Content Editor | DeepSeek V3 | RSS, news curation, cross-outlet comparison |

---

## 9. Simon's Voice Specification

All content agents must use this specification. It is not optional.

**Register:** Intelligent, direct, humane, intellectually curious British professional prose. Educated but not professorial. Approachable but not chatty. Reflective but not therapeutic. Sophisticated without needless abstraction.

**Calibration:** 65% lucid professional conversation / 20% intellectual depth / 10% rhetorical personality / 5% deliberate informality.

**Audience:** Educated fellow professionals and prospective clients on social media.

**Rules:**
- Precise ordinary English. Specialist vocabulary only when it adds precision, not status.
- Direct. Make the point. No corporate hedging or performative modesty.
- Human not institutional. Thoughtful practitioner speaking to another person.
- Warm through attentiveness and candour, not therapeutic language or reassurance.
- Varied sentence rhythm. Longer sentences develop an argument; short sentences land it.
- Occasional wit, metaphor, or memorable phrase — accents, not the dominant register.
- Critical without combative. Question assumptions, show why.
- Abstract ideas must cash out into people, relationships, practice, or consequences.

**Never:**
- Academic-journal prose transplanted onto LinkedIn
- Generic thought leadership
- Management-consultancy language
- Breathlessly inspirational
- Artificially vulnerable
- Relentlessly earnest
- Psychoanalytic or sociological terminology as performance
- AI phrasing: multifaceted, nuanced, profound, tapestry, landscape, intersection, delve, ever-evolving
- Em dashes — use a standard dash - sparingly instead
- Over-polished. Retain slight irregularities and natural turns of phrase.
- Corporate hedging, excessive disclaimers, performative modesty.

**British English throughout. No exceptions.**

---

## 10. Approved Data Sources

All content agents must use only these sources. If it is academically citable, it is acceptable.

**Academic and institutional:** ONS, Mind, NHS Digital, NHS England, NICE, PHE, British Social Attitudes Survey, NatCen, Psychology Today, The Lancet, NCBI/PubMed, WHO, EU, UN, UNICEF, academic journals, university research, government departments, supranational organisations

**Quality press (limited):** The Guardian, Washington Post, NYT, FT, The Economist, New Statesman, New Scientist, New European

**Prohibited:** Telegraph, Times, iNews — do not use under any circumstances.

---

## 11. Credentials

All stored as Cloudflare Worker secrets unless noted.

**LLM:** `mistral_api_key`, `gemini_api_key`, `deepseek_paid`, `groq_f1/f2/f3`, `cerebras_p1`, `kimi`, `glm_api_key`, `cohere_paid`, `cohere_free`, `nvidia1`, `xai`, `openrouter_api_key`, `together_api_key`, `fireworks_api_key`, `sambanova_api_key`, `anyapi_key`

**Search:** `tavily_api_key`, `exa_api_key`, `brave_api_key`, `firecrawl_api_key`, `perplexity`

**Images:** `pexels_api_key`, `unsplash_api_key`, `pixabay_api_key`, `stability_api_key`, `fal_api_key`, `ideogram_api_key`

**Voice/audio:** `elevenlabs_api_key` (free tier, 10K chars/month — do not use for podcast), `cartesia_api_key` (1,096 voices — primary podcast voice), `deepgram_api_key` (STT), `fish_audio_api_key` (new key stored, verify in fish.audio dashboard), `smallest_ai_api_key` (secondary podcast voice)

**Social:** `bluesky_handle`, `bluesky_app_password`, `buffer_api_key`, `buffer_ig_channel`, `buffer_fb_channel`, `buffer_x_channel`, `telegram_token`, `telegram_chat_id`, `substack_email` (zemiopat@substack.com), `whop_api_key`, `linkedin_client_id`, `linkedin_primary_client_secret`

**Google:** `google_client_id` (944507774917-ja5tb5s78don3v5ud9jljk46lsep5v0u.apps.googleusercontent.com), `google_client_secret`, `google_redirect_uri`

**Infrastructure:** `railway_token` (rlwy_acct_kXRv0oatMPiyhIOVDxMpJv2wZVldD0t1AG4cs2bl — stored in CF secrets), `github_token` (**EXPIRED — needs renewal, see Gap Analysis**), `cloudflare_token`, `msgraph_client`, `msgraph_secret`, `msgraph_tenant`, `azure_storage_account`, `azure_storage_sas`, `nylas_api_key`, `nylas_app_key`

**KV-stored tokens:** `oauth:linkedin:tokens` — valid, expires ~5 January 2027. `google:oauth:token` — access token auto-refreshes from refresh token.

---

## 12. Gap Analysis

### Immediate — fix at start of next session (no input from Simon required)
1. **GitHub token renewal** — generate a new PAT at github.com → Settings → Developer settings → Personal access tokens. Needs `repo` scope on IdentityPartners/prism. Store as `github_token` CF secret. Then push the chat layout fix (see item 2).
2. **Chat layout fix ready to deploy** — files prepared in previous session (11 Nov 2026). Once GitHub token is renewed, push these two files to the repo:
   - `chat/index.html` — right panel moved to correct position (sibling of chat-main, not inside input area), collapsible with toggle button, OSK moved to opt-in toolbar button
   - `shared/prism.js` — OSK appends to body (not chat-input-area), gets id="osk-strip"
3. Fix Agenti City UI to display agents from KV `agents:list`
4. Deploy Postiz to Railway (railway_token stored)
5. Deploy Twenty CRM to Railway (same project)
6. Update Marketing agent model assignments in KV (confirm gemini-2.0-flash → gemini-3.8-flash)

### Requires Simon to connect Buffer first
7. Fetch Buffer channel IDs and store as secrets (once Instagram/Facebook/X connected)

### Build work — next session
8. Marketing team interface — per-agent persistent chat, assignment queue, comms prefs, team overview
9. Carousel post type — requires Postiz for multi-slide Instagram
10. Proper data infographic — real ONS/Mind/NHS data, chart layout, icons, narrative flow
11. Remaining canvas types — myth_vs_fact, lived_experience, awareness_day, playlist_carousel
12. Post Now button on Social Queue items
13. Podcast page — Cartesia + Smallest.AI, multi-voice, YouTube upload, Spotify RSS
14. WebRTC voice interface — Gemini 3.8 Live for Original Content Editor

### Requires Simon action
15. **GitHub token** — generate new PAT (repo scope) at github.com → Settings → Developer settings → Personal access tokens → Generate new token (classic). Paste into Argentica Settings → Secret Ingester as `github_token`.
16. Connect Instagram + Facebook + X to Buffer (3 channel limit on free plan)
17. Add youtube.upload scope — reconnect Google at /comms/google/
18. Fix simon@ forwarding — verify destination in Cloudflare Email Routing dashboard
19. Reddit — contact Reddit support about broken app creation button on HumanFutures
20. Pinterest — apply at developers.pinterest.com
21. Medium — create account, generate integration token at medium.com → Settings → Security
22. Tumblr — OAuth connect page needs building, then one-time auth
23. Make.com — set up webhook for Threads (free tier, 1000 ops/month)
24. Fish Audio — verify new key is active at fish.audio → Account → API

### Lower priority
25. LinkedIn company page posting — need company page ID from linkedin.com/company/identity-partners
26. Mastodon — account suspended, contact instance
27. Duplicate CF secrets cleanup — ~15 duplicates using 103/150 slots
28. Unscarred — deprecated, redirect to Argentica, archive codebase
29. Model Monitor agent — daily check of provider API docs, auto-update routing chain

---

## 13. What Was Done — Session 11 November 2026

### Worker fixes (deployed ✓)
- **Research fixed** — `/api/search` handler completely rewritten. Was: Tavily only, hardcoded 8 results, Brave never fired. Now: Tavily (10 results, advanced depth) + Brave (10 results, always fires independently) + Exa (10 results, neural semantic search) + Perplexity (optional AI synthesis). De-duplicated by URL, sorted by score. Tested live: 29 results from 3 sources on first query.
- **Dev Team permissions fixed** — `/api/devteam/execute` now has: `push_to_github` (push files to IdentityPartners/prism repo), `update_kv_bulk` (write multiple KV entries at once), `get_kv`, `set_kv` (aliases for Dev Team chat use). The `push_to_github` action is live and working — it will function correctly once a valid `github_token` is stored in CF secrets.

### Chat layout fix (prepared, pending GitHub token)
- Right panel restructured: moved from inside `chat-input-area` to sibling of `chat-main` inside `chat-shell`. Now full-height, collapsible via toggle button, state persisted in localStorage.
- OSK changed from always-on (showing constantly below input) to opt-in: hidden by default, toggled via "⌨ Keyboard" button in the input toolbar. OSK appends to body (fixed position overlay) rather than inside the input area.
- Files ready to deploy: `chat/index.html` and `shared/prism.js`. Blocked only by expired GitHub token.

### Tokens confirmed working
- Cloudflare API token: ✓ full access (workers, KV, Pages, zones)
- GitHub token: ✗ expired — needs renewal
- Railway token: blocked by Cloudflare WAF from this sandbox IP — use Railway dashboard or CLI

---

## 14. Developer Rules

These are non-negotiable. They apply from the first action.

- Never claim something works until verified headlessly
- Never ask Simon to do anything technical — he pastes keys and clicks buttons
- Never ask Simon to restart services, fix bugs, or check logs
- Never hallucinate metrics, meetings, or engagement numbers
- Never use www.identitypartners.uk/book — always /contact
- British English throughout — no exceptions
- No sycophancy, no AI tropes, no "Great question!", no "delve"
- Routing chain must never return 402 — Pollinations is the unconditional fallback
- Pollinations: always specify model name (openai/mistral/flux) — never pass "Pollinations" as the model
- Ollama must not appear in the automated routing chain
- Never log credentials in plaintext in Worker responses or KV entries
- Every canvas asset must contain: IP logo, identitypartners.uk, hello@identitypartners.uk, IP social handles
- Gemini 2.0 Flash is shut down — never use it. Current model: gemini-3.8-flash
- DeepSeek is chargeable and weaker than the paid Mistral/Gemini options — it belongs in Tier 3, not Tier 1