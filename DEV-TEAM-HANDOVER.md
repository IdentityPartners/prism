# Argentica — Dev Team Handover (November 2026)

**Owner:** Simon Johnson, Identity Partners (non-coder; Simon reads outputs, not code)
**Live system:** https://arch.identitypartners.uk · worker `prism-api` (prism-api.identitypartners.workers.dev) · CF Pages project `arch` · KV/D1/R2 via worker bindings (PRISM_KV, PRISM_D1, PRISM_ASSETS)
**Repo:** `IdentityPartners/prism` (private). Everything must go through this repo.

This document gives a developer with repo access the same change capability as the vibe environment, plus the working memory of this build thread. Read §1 fully before your first change. See also `Argentica-System-Handover.md` (older, broader system overview).

## 1. Deploy pipeline (how to change the system)

- **Worker (`worker/index.js`, ~11.7k lines):** commit to `main` and push → GitHub Action "Argentica Deploy" deploys to Cloudflare with bindings within ~15 s. ALWAYS check `gh run list` for the run result and read `gh run view <id> --log` on failure. Verify every patch locally first: `node --check worker/index.js`.
- **Pages (all `argentica/**` HTML, `shared/argentica.css|js`, favicons):** `bash scripts/deploy-arch.sh` with env `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID=d741de91f8cfff2306cc0f850a76ee07`. The script stages `argentica/` + shared assets + a generated `_worker.js` that enforces the login gate (see §2) and proxies `/api/*` to the worker.
- **Patching method:** use small scripted replacements with uniqueness assertions (e.g. python `assert s.count(old)==1`), never hand-edits inside the large template literals. Beware backticks/`${}` when editing string content — a `\`` interpolation once broke deploy.
- **Pages cannot be curl-verified anonymously:** the login gate returns `login.html` (3304 bytes) for guests. Verify shipped page JS by extracting and `node --check`-ing inline scripts; rely on Simon for visual confirmation.
- **Worker routes ARE testable live:** POST to `https://prism-api.identitypartners.workers.dev/api/...` directly with `Content-Type: application/json` and a browser User-Agent (some external APIs 403 python default UA).

## 2. Auth gate

Pages `/_worker.js` gates everything except `/`, `/login.html`, `/shared/`, favicons, `/api/auth/*`. First login sets a master password (sha256, KV). Trusted-device cookie `arg_auth` HttpOnly, renews 90-day. `/api/auth/change` revokes all tokens. Never weaken the allowlist without asking Simon; he may later hold CRM data here.

## 3. Credentials & secret policy

All credentials live in **Cloudflare Worker secrets** or **KV** — never in code (GitGuardian alerts on literals; two incidents already remediated). Ingest with `POST /api/ingest-secrets {"secrets":[{name,value}]}`. **House rules from Simon:**
- Never delete a secret without asking first.
- Splits of pasted concatenated keys must be verified against the provider API before declaring success (a Pollinations mis-split cost a day).

**Secrets currently stored (names, not values):** fish_audio, smallest_ai, fal, stability (fresh 2026-11 key, intro credits), ideogram (valid, zero credits), imagerouter (valid, zero credits; free models are web-only), pollinations (valid, Quests + Paid balance), meta_user_token (60-day, daily cron renews; app 1685194906404728), meta_app_id/secret, linkedin_client_id `78x8tm6vggjuoe` + secret, resend (domain verified; sends as Identity Partners <hello@identitypartners.uk>), threads (KV `threads:oauth`, TJS token, 60-day clock + daily refresh attempt), tumblr key/secret + KV `tumblr:oauth` (40-min token auto-refresh), bluesky (KV none — secrets; session identifier must have `@` stripped — verified), telegram_bot_token (IdentityPartnerBot), buffer_api_key + channel IDs, deepgram, railway/browserless tokens (Raster QA via svgToPngUrl fallback chain), gemini keys, zoho/msgraph app-only (personal hotmail NOT readable).

**CF API token for Pages deploys** is held as worker secret `cf_token`; also present in vibe sandbox `/tmp/cf_token.txt`. If a new environment lacks it, retrieve via a temporary authenticated worker route (pattern used before: guarded burn-once route) or ask Simon for a fresh token.

## 4. Recent architecture state (Nov 2026)

- **Canvas Studio V2** (`argentica/create/index.html`): templates across top, template-shaped stage inputs, image dialogue (live sources / AI / upload), `/api/canvas/generate` accepts `imageDataUrl`/`imageUrl` override, image auto-fit pressure on news-reaction commentary. Result actions: Export PNG / Send to publishing / Save to asset library (`/api/assets/log`).
- **Image-gen chain** (`/api/image/generate`): gemini → fal → pollinations (authenticated gen.pollinations.ai, `pollinationsModel` selectable) → stability → ideogram → imagerouter, then unauthenticated Pollinations as never-fails last resort. Per-provider diagnostics in the 502 body (`failed` list + which keys exist).
- **Publishing groups (canon):** longform=substack only; pro=linkedin (orphan); shortform=x/threads/bluesky (280/300/500); images=instagram/facebook/tumblr. Format slots image/carousel/story/reel/auto. Listicle doctrine in agent prompt. Hashtag doctrine 2-4 relevant only.
- **Theme system:** KV `themes:weeks` `{week,name,secondary,exceptions}`; injected as ADVISORY-ONLY context in both agent prompts and autonomy drafts (Nov-23 fix after theme-bleed incident: never blended into news reactions; fact discipline — dates/deaths/attributions only from retrieved material).
- **Approve flow:** `/api/mm/approve` posts direct-first (IG/FB via Meta Graph, Buffer fallback), status 'posted' if ANY platform succeeded (per-platform results in `postResults`/`postErrors`, log in KV `mm:log` readable at `/api/mm/log`). Slot-past schedule bug fixed (immediate-post when slot time passed). **Telegram post-report** after every approve via IdentityPartnerBot — requires Simon (or anyone) to send the bot ANY message first (`/start`), after which the chat id is auto-cached in KV `telegram:chat`.
- **Password gate, drafts persistence, second-window (⊕), prompt addendum (§) with Citation Discipline preset + Chat-bar Citation toggle** — all live. Addendum attaches only when toggled on (localStorage `arg_addendum_on/content`).
- **Asset library** (`create/assets`): brand pack, logo marks (canonical transparent mark = `/shared/assets/logo-mark.png`; `logo-square.png` is Simon's original artwork — NEVER replace it, composites must use the transparent mark), palette, auto-filed created assets (KV `assets:created`, worker `logAsset`).
- **Research:** `/api/research/scholarly` + web engines; run history KV `research:runs` (GET/DELETE `/api/research/history`); relevance = client-side term overlap (+3 title, +1 body, vs Tay's ≤12 terms, date tiebreak) — Simon has been told; a semantic upgrade is an open suggestion.

## 5. Open to-do list (as of 23 Nov 2026)

1. **Musical reels end-to-end** (Simon approved; highest priority): reel slides → MP4 with music bed (browserless screencast of animated SVG, Lyria/Openverse music), then IG REELS container + FB `video_reels`.
2. **HTML5 live preview** in Canvas Studio (render as you type, brand layer locked).
3. **Penpot bridge**: one-way export of canvas/scene as Penpot-importable SVG.
4. **Threads in autonomous drafts**: agents rarely propose threads; consider adding threads to the default autonomy platform list (Social page checkboxes exist; prompt-side is weak).
5. **LinkedIn company-page decision** pending Simon: second app with ONLY Community Management API (keeps Share on LinkedIn on the IdentityPartners.uk app) vs continue posting as personal. OAuth flow + org detection already built; KV `linkedin:author:urn`.
6. **Research relevance upgrade** (semantic / weighted) — offered, awaiting Simon's go.
7. **Mechanical backstop for theme bleed** (server-side check rejecting theme phrases in news-reactions) — offered, awaiting Simon's go.
8. **x402/Pollinations extras**: GPT-5.4 Nano as cheap text profile in Tay (offered). Audio TTS as extra reel-voice option.
9. **Outlook inbox**: needs an Azure app registration with delegated `Mail.Read` for personal hotmail (Simon's action), then build `/api/oauth/outlook/callback` flow.
10. **Telegram reporting activation**: Simon must message @IdentityPartnerBot once; then verify the post-report arrives on the next approve.
11. **Voices registry** (KV `voices:registry`, Cadence page): approve-time `item.from` routing for Tumblr blogName is built; Bluesky per-voice app-password secrets (`bluesky_<voice>` pattern) when Simon creates accounts.
12. **Substack**: publication creation is manual; delivery via Resend email works.

## 6. Golden rules (from Simon, verbatim intents)

- Parchment light palette, EB Garamond/Inter; **never introduce dark modes**.
- **Never replace his logo artwork** (`logo-square.png`); use the extracted transparent mark for composites.
- Modals for everything; **never `prompt()`**; `confirm()` only for destructive actions.
- Editability everywhere: pen ✎ / delete ✕ on every section, subsection, unit across all surfaces.
- Hashtags: 2-4, relevant only; #Addiction only when on-topic. Footer on every post.
- Themes are advisory lenses, never forced into unrelated posts.
- No invented facts, citations or dates from memory (Citation Discipline is Simon's doctrine).
- Check with Simon before shelving/deleting secrets; removing a "seemingly unused" secret caused the Pollinations outage.
- Deploy Pages only AFTER committing, so stage and repo stay in sync.
