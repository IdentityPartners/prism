# Argentica — Setup Guide for External Integrations

## 1. Email Ingestion: docs@identitypartners.uk

### Current setup
- MX records for `argentica.identitypartners.uk` point to ForwardEmail.net
- TXT record: `forward-email=files:https://prism-api.identitypartners.workers.dev/api/email/ingest`
- DNS propagation: 24-48 hours from setup (22 Oct 2026)

### To use docs@identitypartners.uk (shorter address)
1. Log in to **Zoho Mail** (mail.zoho.eu)
2. Go to **Settings** → **Email Aliases**
3. Add alias: `docs@identitypartners.uk` → forwards to `hello@identitypartners.uk`
4. Go to **Settings** → **Filters**
5. Create filter: When email arrives at `docs@identitypartners.uk` → Forward to `files@argentica.identitypartners.uk`
6. Any email sent to `docs@identitypartners.uk` will be auto-processed by Argentica

### What happens when an email arrives
- Email is parsed and stored in KV as an inbox item
- Auto-tagged based on content (mental-health, disability, research, file, etc.)
- Notification sent to Telegram (when configured)
- Appears in Argentica Inbox (/inbox/) with tags and preview
- Attachments listed (full content requires paid email parsing service)

### Test
Send an email to `files@argentica.identitypartners.uk` with subject "Test" and any attachment.
Check /inbox/ — it should appear within 60 seconds.

---

## 2. Telegram Integration

### Current status
- Webhook endpoint: `https://prism-api.identitypartners.workers.dev/api/telegram/webhook`
- Webhook is configured in the Worker
- **Token needs renewal** — the stored token returned 401

### To set up / renew
1. Open Telegram → search **@BotFather**
2. Send `/mybots`
3. Select your Argentica bot
4. Click **API Token** → **Revoke** → copy new token
5. Go to Argentica **Settings** (/settings/)
6. Paste new token as `telegram_token`
7. The webhook will activate automatically

### What Telegram can do
- Send any message to your bot → appears in Argentica Inbox
- Send a file/document → appears as "file awaiting allocation" in Inbox
- Send a photo → stored and tagged
- Forward any article/link → processed and tagged

### Telegram bot commands (to implement)
- `/status` — system status
- `/inbox` — show unread inbox items
- `/chat [message]` — send to Gerald

---

## 3. Proton Drive Backup

### Option A: rclone (automated, recommended)

**Install rclone on Surface Pro 9:**
```
winget install Rclone.Rclone
```

**Configure Proton Drive:**
```
rclone config
# Choose: n (new remote)
# Name: proton
# Type: protondrive
# Enter your Proton email and password
# Leave other settings as default
```

**Test:**
```
rclone ls proton:
```

**Create Windows Task Scheduler job for daily backup:**
1. Open Task Scheduler
2. Create Basic Task → name: "Argentica Backup"
3. Trigger: Daily at 02:00
4. Action: Start a program
5. Program: `rclone`
6. Arguments: `sync "C:\Users\SimonSP9\Downloads\argentica-exports" proton:Argentica --create-empty-src-dirs`

**Export from Argentica:**
- Study Hub → any week → Export button → saves .md file to Downloads
- /inbox/ → Export → saves JSON
- Chat → Export → saves .txt

### Option B: Manual (simplest)
1. In Argentica, use Export buttons on Study Hub weeks, Inbox, Chat
2. Files download to your Downloads folder
3. Drag to Proton Drive app (install from proton.me/drive)

### Option C: Zoho WorkDrive (automated via Worker)
- Already configured in the Worker (/api/backup/workdrive)
- Uses your existing Zoho OAuth token
- Call from Study Hub Export button to save directly to Zoho WorkDrive
- No additional setup needed

---

## 4. Live Notifications (WebSocket / SSE)

### Current implementation
- Notification bell polls /api/inbox every 5 minutes
- Chat pill shows unread badge when response arrives

### To enable real-time notifications
The Worker supports SSE (Server-Sent Events) for streaming.
A WebSocket connection would require Durable Objects (paid CF feature).

**Recommended approach:** Keep 5-minute polling for inbox.
For truly real-time: Telegram bot sends push notifications instantly.
Configure your Telegram bot to message you when new items arrive.

---

## 5. Cloudflare Cleanup

### Safe to delete
- `unscarred-ai` — deprecated (Decision 3 in spec)
- `unscarred-api` — deprecated
- `aria-ai` — deprecated
- `prism-wl-api` — deprecated white-label API

### Keep
- `prism-api` — the Argentica Worker (DO NOT DELETE)
- `prism` — the Argentica Pages site (DO NOT DELETE)
- `identitypartners.uk` zone — your domain (DO NOT DELETE)

### How to delete
1. dash.cloudflare.com → Workers & Pages
2. Click the project → Settings → Delete project
3. Confirm deletion

---

## 6. KV Operations

### Free tier limits (before upgrade)
- List operations: 1,000/day
- Read operations: 100,000/day
- Write operations: 1,000/day

### Paid plan ($5/month — now active)
- List operations: 1,000,000/day
- Read operations: 10,000,000/day
- Write operations: 1,000,000/day

### What uses list operations
- Loading conversation history (1 list op per page load)
- Loading inbox items (1 list op per request)
- Loading notifications (1 list op per request)
- Polling (was every 30s — now every 5 minutes)

---

*Last updated: 22 October 2026*
*Argentica v1.0 — Identity Partners*
