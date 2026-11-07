/**
 * Argentica — Marketing Team Module
 * File: src/modules/marketing-team.js  (or wherever the Marketing module lives in the Prism Pages project)
 *
 * Corrections in this version:
 *   1. OSK always-on, left of textarea — 60:40 split (OSK:input)
 *   2. Orchestrator panel — correct proportions, model selector, agent list
 *   3. Per-agent WIP pipeline tab for each of the 6 marketing agents
 *      - Jobs promoted/demoted with ↑↓ keys and buttons
 *      - Estimated completion time/date on every job
 *      - Click line-by-line to collapse/expand and interrogate individually
 *   4. Openverse added to image search sources (alongside Pexels/Unsplash/Pixabay)
 *
 * This file exports:
 *   - marketingTeamHTML()   — returns the full HTML string for the module
 *   - marketingTeamCSS()    — returns the CSS string (inject into <style> or a stylesheet)
 *   - marketingTeamJS()     — returns the JS string (inject before </body>)
 *
 * Or use renderMarketingTeam() which returns { html, css, js } for framework integration.
 *
 * Worker routes consumed by this module:
 *   POST /api/mm/chat          — agent chat
 *   GET  /api/mm/jobs          — job queue per agent
 *   POST /api/mm/jobs/reorder  — promote/demote job
 *   POST /api/canvas/generate  — trigger canvas generation
 *   GET  /api/canvas/search-images  — semantic image search (Pexels/Unsplash/Pixabay/Openverse)
 */

// ─────────────────────────────────────────────
// AGENT DEFINITIONS
// ─────────────────────────────────────────────

const AGENTS = [
  {
    id:       'visual',
    name:     'Visual Assets Manager',
    nick:     'Pixel',
    colour:   '#bc8cff',
    dotClass: 'dot-purple',
    initial:  'P',
    placeholder: 'Give Pixel a topic or occasion — e.g. "World Mental Health Day — awareness post"',
  },
  {
    id:       'copy',
    name:     'Copy & Content Writer',
    nick:     'Quill',
    colour:   '#58a6ff',
    dotClass: 'dot-blue',
    initial:  'Q',
    placeholder: 'Give Quill a brief — e.g. "Instagram caption for WMHD post, Simon voice"',
  },
  {
    id:       'research',
    name:     'Research Analyst',
    nick:     'Scout',
    colour:   '#3fb950',
    dotClass: 'dot-green',
    initial:  'S',
    placeholder: 'Give Scout a research task — e.g. "ONS addiction statistics 2026"',
  },
  {
    id:       'social',
    name:     'Social Queue Manager',
    nick:     'Relay',
    colour:   '#d29922',
    dotClass: 'dot-orange',
    initial:  'R',
    placeholder: 'Give Relay a scheduling task — e.g. "Schedule WMHD posts across all channels"',
  },
  {
    id:       'platform',
    name:     'Platform Manager',
    nick:     'Bridge',
    colour:   '#39d353',
    dotClass: 'dot-teal',
    initial:  'B',
    placeholder: 'Give Bridge a platform task — e.g. "Fetch Buffer channel IDs"',
  },
  {
    id:       'scheduler',
    name:     'Scheduler & Calendar',
    nick:     'Tempo',
    colour:   '#f85149',
    dotClass: 'dot-red',
    initial:  'T',
    placeholder: 'Give Tempo a calendar task — e.g. "List awareness days for December 2026"',
  },
];

// ─────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────

function marketingTeamCSS() {
  return `
/* ═══════════════════════════════════════════════════════════
   Argentica Marketing Team — layout reset
   All measurements are explicit. No ambiguous flex defaults.
═══════════════════════════════════════════════════════════ */

.mkt-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base, #0d1117);
  color: var(--text-primary, #e6edf3);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}

/* ── Orchestrator panel ─────────────────────────────────── */
/* Fixed width. Never shrinks. Never grows. */
.mkt-orch {
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  flex-shrink: 0;
  background: var(--bg-panel, #161b22);
  border-right: 1px solid var(--border, #30363d);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mkt-orch-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border, #30363d);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.mkt-orch-logo {
  width: 30px; height: 30px;
  background: linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 700; color: #fff;
  flex-shrink: 0;
}

.mkt-orch-title    { font-size: 13px; font-weight: 600; }
.mkt-orch-subtitle { font-size: 10px; color: var(--text-secondary, #8b949e); margin-top: 1px; }

.mkt-orch-section  { padding: 10px 12px 4px; flex-shrink: 0; }
.mkt-orch-label    {
  font-size: 10px; font-weight: 600; color: var(--text-muted, #484f58);
  text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px;
}

.mkt-orch-model {
  margin: 0 12px 8px;
  width: calc(100% - 24px);
  background: var(--bg-input, #21262d);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-primary, #e6edf3);
  font-size: 11px;
  padding: 6px 24px 6px 8px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238b949e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
  flex-shrink: 0;
}
.mkt-orch-model:focus { outline: none; border-color: #58a6ff; }

.mkt-agent-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; padding: 0 4px 4px; }

.mkt-agent {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 4px;
  cursor: pointer; transition: background 0.12s;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.mkt-agent:hover  { background: var(--bg-hover, #262d3a); }
.mkt-agent.active { background: rgba(88,166,255,0.1); border-color: #58a6ff; }

.mkt-agent-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.dot-purple { background: #bc8cff; box-shadow: 0 0 5px #bc8cff; }
.dot-blue   { background: #58a6ff; box-shadow: 0 0 5px #58a6ff; }
.dot-green  { background: #3fb950; box-shadow: 0 0 5px #3fb950; }
.dot-orange { background: #d29922; box-shadow: 0 0 5px #d29922; }
.dot-teal   { background: #39d353; box-shadow: 0 0 5px #39d353; }
.dot-red    { background: #f85149; box-shadow: 0 0 5px #f85149; }

.mkt-agent-info  { flex: 1; min-width: 0; }
.mkt-agent-name  { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mkt-agent-nick  { font-size: 10px; color: var(--text-secondary, #8b949e); }

.mkt-agent-badge {
  font-size: 10px; font-weight: 600;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 10px; padding: 1px 6px;
  color: var(--text-secondary, #8b949e);
  flex-shrink: 0;
}
.mkt-agent-badge.busy {
  background: rgba(88,166,255,0.12);
  border-color: #58a6ff;
  color: #58a6ff;
}

.mkt-orch-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border, #30363d);
  display: flex; gap: 6px;
  flex-shrink: 0;
}
.mkt-orch-footer-btn {
  flex: 1; padding: 6px 4px;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-secondary, #8b949e);
  font-size: 11px; cursor: pointer;
  transition: all 0.12s; text-align: center;
}
.mkt-orch-footer-btn:hover {
  background: var(--bg-hover, #262d3a);
  color: var(--text-primary, #e6edf3);
}

/* ── Main area ──────────────────────────────────────────── */
/* Takes all remaining width. Never overflows. */
.mkt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Agent tabs — top nav */
.mkt-tabs {
  height: 44px;
  flex-shrink: 0;
  background: var(--bg-panel, #161b22);
  border-bottom: 1px solid var(--border, #30363d);
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  scrollbar-width: none;
}
.mkt-tabs::-webkit-scrollbar { display: none; }

.mkt-tab {
  height: 44px;
  padding: 0 16px;
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition: all 0.12s;
  flex-shrink: 0;
}
.mkt-tab:hover  { color: var(--text-primary, #e6edf3); background: var(--bg-hover, #262d3a); }
.mkt-tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }

.mkt-tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.mkt-tab-spacer { flex: 1; }

.mkt-new-job-btn {
  align-self: center;
  margin-right: 12px;
  padding: 5px 14px;
  background: #58a6ff;
  border: none; border-radius: 4px;
  color: #fff; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: opacity 0.12s;
  flex-shrink: 0;
}
.mkt-new-job-btn:hover { opacity: 0.85; }

/* ── Content body ───────────────────────────────────────── */
.mkt-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Chat messages */
.mkt-chat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scroll-behavior: smooth;
}
.mkt-chat::-webkit-scrollbar { width: 4px; }
.mkt-chat::-webkit-scrollbar-thumb { background: var(--border, #30363d); border-radius: 2px; }

.mkt-msg { display: flex; gap: 10px; }
.mkt-msg.user { flex-direction: row-reverse; }

.mkt-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 2px;
}
.mkt-avatar.agent { background: linear-gradient(135deg, #58a6ff, #bc8cff); color: #fff; }
.mkt-avatar.user  { background: var(--bg-card, #1c2330); border: 1px solid var(--border, #30363d); color: var(--text-secondary, #8b949e); }

.mkt-bubble {
  max-width: 70%;
  padding: 9px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.55;
}
.mkt-msg.agent .mkt-bubble {
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-top-left-radius: 2px;
}
.mkt-msg.user .mkt-bubble {
  background: rgba(88,166,255,0.12);
  border: 1px solid #58a6ff;
  border-top-right-radius: 2px;
}

.mkt-msg-meta { font-size: 10px; color: var(--text-muted, #484f58); margin-top: 3px; }
.mkt-msg.user .mkt-msg-meta { text-align: right; }

/* ── Resize handle ──────────────────────────────────────── */
.mkt-resize {
  height: 5px;
  flex-shrink: 0;
  cursor: ns-resize;
  background: transparent;
  border-top: 1px solid var(--border-light, #3d444d);
  transition: background 0.12s;
}
.mkt-resize:hover { background: rgba(88,166,255,0.15); }

/* ── Input dock ─────────────────────────────────────────── */
/*
  OSK : text input = 60 : 40 of the input row width.
  Enforced with flex-basis. No ambiguity.
*/
.mkt-input-dock {
  flex-shrink: 0;
  background: var(--bg-panel, #161b22);
  border-top: 1px solid var(--border, #30363d);
  padding: 10px 16px 12px;
}

.mkt-input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  width: 100%;
}

/* OSK — exactly 60% of the input row */
.mkt-osk {
  flex: 0 0 calc(60% - 5px);   /* 60% minus half the gap */
  width: calc(60% - 5px);
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  user-select: none;
}

.mkt-osk-label {
  font-size: 9px; color: var(--text-muted, #484f58);
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 1px;
}

.mkt-osk-row {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
}

.mkt-key {
  background: var(--bg-hover, #262d3a);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-primary, #e6edf3);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.1s;
  white-space: nowrap;
  line-height: 1.4;
  flex-shrink: 0;
}
.mkt-key:hover  { background: var(--border, #30363d); border-color: var(--border-light, #3d444d); }
.mkt-key:active { background: rgba(88,166,255,0.2); border-color: #58a6ff; color: #58a6ff; }

.mkt-key.action {
  background: rgba(88,166,255,0.1);
  border-color: rgba(88,166,255,0.3);
  color: #58a6ff;
  font-weight: 600;
}
.mkt-key.action:hover { background: rgba(88,166,255,0.2); }

.mkt-key.fn    { font-size: 10px; color: var(--text-secondary, #8b949e); padding: 3px 7px; }
.mkt-key.wide  { flex: 1; }
.mkt-key.emoji { font-size: 13px; }

/* Text input area — exactly 40% of the input row */
.mkt-text-wrap {
  flex: 0 0 calc(40% - 5px);   /* 40% minus half the gap */
  width: calc(40% - 5px);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mkt-textarea {
  width: 100%;
  background: var(--bg-input, #21262d);
  border: 1px solid var(--border, #30363d);
  border-radius: 8px;
  color: var(--text-primary, #e6edf3);
  font-size: 13px;
  font-family: inherit;
  padding: 9px 12px;
  resize: none;
  min-height: 76px;
  max-height: 140px;
  line-height: 1.5;
  transition: border-color 0.12s;
}
.mkt-textarea:focus { outline: none; border-color: #58a6ff; }
.mkt-textarea::placeholder { color: var(--text-muted, #484f58); }

.mkt-input-actions {
  display: flex; gap: 6px; align-items: center;
}

.mkt-btn {
  padding: 5px 10px;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-secondary, #8b949e);
  font-size: 11px; cursor: pointer;
  transition: all 0.12s;
  display: flex; align-items: center; gap: 4px;
}
.mkt-btn:hover { background: var(--bg-hover, #262d3a); color: var(--text-primary, #e6edf3); }

.mkt-btn.primary {
  background: #58a6ff;
  border-color: #58a6ff;
  color: #fff;
  font-weight: 600;
  margin-left: auto;
}
.mkt-btn.primary:hover { opacity: 0.85; }

/* ── Pipeline panel ─────────────────────────────────────── */
.mkt-pipeline {
  flex-shrink: 0;
  height: 300px;
  background: var(--bg-panel, #161b22);
  border-top: 1px solid var(--border, #30363d);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mkt-pipeline-tabs {
  display: flex;
  border-bottom: 1px solid var(--border, #30363d);
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}
.mkt-pipeline-tabs::-webkit-scrollbar { display: none; }

.mkt-ptab {
  padding: 7px 14px;
  font-size: 11px; font-weight: 500;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  display: flex; align-items: center; gap: 5px;
  transition: all 0.12s;
  flex-shrink: 0;
}
.mkt-ptab:hover  { color: var(--text-primary, #e6edf3); background: var(--bg-hover, #262d3a); }
.mkt-ptab.active { color: var(--text-primary, #e6edf3); border-bottom-color: #58a6ff; }

.mkt-ptab-dot   { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.mkt-ptab-count {
  font-size: 9px; font-weight: 700;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 8px; padding: 0 5px;
  color: var(--text-muted, #484f58);
}
.mkt-ptab.active .mkt-ptab-count {
  background: rgba(88,166,255,0.12);
  border-color: #58a6ff;
  color: #58a6ff;
}

.mkt-pipeline-body {
  flex: 1;
  overflow-y: auto;
}
.mkt-pipeline-body::-webkit-scrollbar { width: 4px; }
.mkt-pipeline-body::-webkit-scrollbar-thumb { background: var(--border, #30363d); border-radius: 2px; }

/* Job rows */
.mkt-job {
  border-bottom: 1px solid var(--border, #30363d);
  transition: background 0.1s;
}
.mkt-job:last-child { border-bottom: none; }
.mkt-job:hover { background: var(--bg-hover, #262d3a); }

.mkt-job-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
}

/* ↑↓ promote/demote controls */
.mkt-job-controls {
  display: flex; flex-direction: column; gap: 1px;
  flex-shrink: 0;
}
.mkt-job-ctrl {
  width: 18px; height: 14px;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 2px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; color: var(--text-muted, #484f58);
  transition: all 0.1s; line-height: 1;
}
.mkt-job-ctrl:hover:not(:disabled) {
  background: rgba(88,166,255,0.15);
  border-color: #58a6ff;
  color: #58a6ff;
}
.mkt-job-ctrl:disabled { opacity: 0.25; cursor: default; }

.mkt-job-priority {
  width: 22px; text-align: center;
  font-size: 10px; font-weight: 700;
  color: var(--text-muted, #484f58);
  flex-shrink: 0;
}

/* Status dot */
.mkt-job-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.jdot-running { background: #3fb950; box-shadow: 0 0 5px #3fb950; animation: mkt-pulse 1.5s infinite; }
.jdot-queued  { background: #d29922; }
.jdot-pending { background: #484f58; }
.jdot-done    { background: #39d353; }
.jdot-error   { background: #f85149; }

@keyframes mkt-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

.mkt-job-info  { flex: 1; min-width: 0; }
.mkt-job-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mkt-job-sub   { font-size: 10px; color: var(--text-secondary, #8b949e); margin-top: 1px; }

.mkt-job-eta {
  font-size: 10px; color: var(--text-secondary, #8b949e);
  white-space: nowrap; flex-shrink: 0;
  display: flex; flex-direction: column; align-items: flex-end; gap: 1px;
}
.mkt-job-eta-time  { font-weight: 600; color: var(--text-primary, #e6edf3); }
.mkt-job-eta-label { font-size: 9px; color: var(--text-muted, #484f58); }

.mkt-job-chevron {
  font-size: 9px; color: var(--text-muted, #484f58);
  flex-shrink: 0; width: 12px; text-align: center;
  transition: transform 0.18s;
}
.mkt-job.expanded .mkt-job-chevron { transform: rotate(90deg); }

/* Job detail (collapsed by default) */
.mkt-job-detail {
  display: none;
  padding: 0 14px 10px 62px;
  border-top: 1px solid var(--border, #30363d);
  background: rgba(0,0,0,0.18);
}
.mkt-job.expanded .mkt-job-detail { display: block; }

.mkt-job-detail-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px; padding-top: 8px;
}
.mkt-jd-field  { display: flex; flex-direction: column; gap: 2px; }
.mkt-jd-label  { font-size: 9px; color: var(--text-muted, #484f58); text-transform: uppercase; letter-spacing: 0.5px; }
.mkt-jd-value  { font-size: 11px; }

.mkt-job-progress {
  height: 3px; background: var(--border, #30363d);
  border-radius: 2px; margin-top: 8px; overflow: hidden;
}
.mkt-job-progress-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, #58a6ff, #bc8cff);
  transition: width 0.3s;
}

.mkt-job-log {
  margin-top: 8px;
  background: var(--bg-base, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
  color: var(--text-secondary, #8b949e);
  max-height: 64px;
  overflow-y: auto;
  line-height: 1.6;
}
.mkt-log-ok   { color: #3fb950; }
.mkt-log-warn { color: #d29922; }
.mkt-log-err  { color: #f85149; }

.mkt-job-actions { display: flex; gap: 5px; margin-top: 8px; }
.mkt-job-action {
  padding: 3px 8px;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-secondary, #8b949e);
  font-size: 10px; cursor: pointer;
  transition: all 0.1s;
}
.mkt-job-action:hover { background: var(--bg-hover, #262d3a); color: var(--text-primary, #e6edf3); }
.mkt-job-action.danger:hover {
  background: rgba(248,81,73,0.12);
  border-color: #f85149;
  color: #f85149;
}

/* Pipeline empty state */
.mkt-pipeline-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100%;
  color: var(--text-muted, #484f58);
  font-size: 12px; gap: 6px;
}

/* ── Image search modal ─────────────────────────────────── */
.mkt-modal-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.72);
  z-index: 200;
  align-items: center; justify-content: center;
}
.mkt-modal-overlay.open { display: flex; }

.mkt-modal {
  background: var(--bg-panel, #161b22);
  border: 1px solid var(--border, #30363d);
  border-radius: 12px;
  width: 700px; max-width: 95vw;
  max-height: 82vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.mkt-modal-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border, #30363d);
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.mkt-modal-title { font-size: 14px; font-weight: 600; flex: 1; }
.mkt-modal-close {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  color: var(--text-secondary, #8b949e);
  cursor: pointer; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.12s;
}
.mkt-modal-close:hover { background: var(--bg-hover, #262d3a); color: var(--text-primary, #e6edf3); }

.mkt-modal-search {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #30363d);
  display: flex; gap: 8px;
  flex-shrink: 0;
}
.mkt-modal-input {
  flex: 1;
  background: var(--bg-input, #21262d);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--text-primary, #e6edf3);
  font-size: 12px; padding: 7px 10px;
}
.mkt-modal-input:focus { outline: none; border-color: #58a6ff; }

.mkt-source-row {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border, #30363d);
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  flex-shrink: 0;
}
.mkt-source-label { font-size: 10px; color: var(--text-muted, #484f58); }

.mkt-source-pill {
  padding: 3px 10px; border-radius: 12px;
  font-size: 10px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--border, #30363d);
  background: var(--bg-card, #1c2330);
  color: var(--text-secondary, #8b949e);
  transition: all 0.12s;
}
.mkt-source-pill.active-pexels    { background: rgba(5,173,230,0.12); border-color: #05ade6; color: #05ade6; }
.mkt-source-pill.active-unsplash  { background: rgba(220,220,220,0.08); border-color: #ccc; color: #ccc; }
.mkt-source-pill.active-pixabay   { background: rgba(45,196,78,0.12); border-color: #2dc44e; color: #2dc44e; }
.mkt-source-pill.active-openverse { background: rgba(188,140,255,0.12); border-color: #bc8cff; color: #bc8cff; }

.mkt-modal-body { flex: 1; overflow-y: auto; padding: 12px 16px; }

.mkt-img-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.mkt-img-thumb {
  aspect-ratio: 4/3;
  border-radius: 4px;
  background: var(--bg-card, #1c2330);
  border: 1px solid var(--border, #30363d);
  overflow: hidden; cursor: pointer; position: relative;
  transition: all 0.12s;
}
.mkt-img-thumb:hover { border-color: #58a6ff; transform: scale(1.02); }
.mkt-img-thumb img   { width: 100%; height: 100%; object-fit: cover; display: block; }
.mkt-img-source {
  position: absolute; bottom: 4px; right: 4px;
  font-size: 8px; font-weight: 700;
  padding: 1px 5px; border-radius: 3px;
  background: rgba(0,0,0,0.75); color: #fff;
}
`;
}

// ─────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────

function marketingTeamHTML() {
  const agentOptions = AGENTS.map(a =>
    `<option value="${a.id}">${a.nick} — ${a.name}</option>`
  ).join('\n        ');

  const orchAgents = AGENTS.map(a => `
        <div class="mkt-agent" id="orch-${a.id}" data-agent="${a.id}" onclick="MKT.switchAgent('${a.id}')">
          <div class="mkt-agent-dot ${a.dotClass}"></div>
          <div class="mkt-agent-info">
            <div class="mkt-agent-name">${a.name}</div>
            <div class="mkt-agent-nick">${a.nick}</div>
          </div>
          <div class="mkt-agent-badge" id="badge-${a.id}">0</div>
        </div>`).join('');

  const topTabs = AGENTS.map(a => `
      <div class="mkt-tab" id="tab-${a.id}" data-agent="${a.id}" onclick="MKT.switchAgent('${a.id}')">
        <div class="mkt-tab-dot" style="background:${a.colour}"></div>
        ${a.nick} — ${a.name.split(' ')[0]}
      </div>`).join('');

  const pipelineTabs = AGENTS.map(a => `
          <div class="mkt-ptab" id="ptab-${a.id}" data-agent="${a.id}" onclick="MKT.switchPipelineTab('${a.id}')">
            <div class="mkt-ptab-dot" style="background:${a.colour}"></div>
            ${a.nick}
            <span class="mkt-ptab-count" id="ptab-count-${a.id}">0</span>
          </div>`).join('');

  return `
<div class="mkt-shell" id="mktShell">

  <!-- ── Orchestrator panel (280px fixed) ── -->
  <aside class="mkt-orch">
    <div class="mkt-orch-header">
      <div class="mkt-orch-logo">A</div>
      <div>
        <div class="mkt-orch-title">Argentica</div>
        <div class="mkt-orch-subtitle">Marketing Orchestrator</div>
      </div>
    </div>

    <div class="mkt-orch-section">
      <div class="mkt-orch-label">Model</div>
    </div>
    <select class="mkt-orch-model" id="mktModel">
      <option value="gemini-4-argon">Gemini 4 Argon — flagship</option>
      <option value="glm-5.3">GLM 5.3 via Mistral — 1M ctx</option>
      <option value="mistral-large-4">Mistral Large 4 — 262K</option>
      <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
      <option value="cerebras">Cerebras — fast</option>
      <option value="groq">Groq — fast</option>
      <option value="cohere">Cohere Command R+</option>
      <option value="kimi">Kimi — chargeable</option>
      <option value="deepseek">DeepSeek V3 — chargeable</option>
      <option value="grok">xAI Grok — real-time</option>
      <option value="nemotron-253b">Nemotron 253B (OpenRouter)</option>
      <option value="nemotron-550b">Nemotron 550B (OpenRouter)</option>
      <option value="devstral">Devstral Small (OpenRouter)</option>
      <option value="pollinations">Pollinations — fallback</option>
    </select>

    <div class="mkt-orch-section">
      <div class="mkt-orch-label">Agents</div>
    </div>
    <div class="mkt-agent-list">
      ${orchAgents}
    </div>

    <div class="mkt-orch-footer">
      <button class="mkt-orch-footer-btn" onclick="MKT.openImageSearch()">🖼 Images</button>
      <button class="mkt-orch-footer-btn" onclick="MKT.openQueue()">📋 Queue</button>
      <button class="mkt-orch-footer-btn" onclick="MKT.openSettings()">⚙ Settings</button>
    </div>
  </aside>

  <!-- ── Main area (flex: 1) ── -->
  <div class="mkt-main">

    <!-- Agent tabs -->
    <nav class="mkt-tabs">
      ${topTabs}
      <div class="mkt-tab-spacer"></div>
      <button class="mkt-new-job-btn" onclick="MKT.openImageSearch()">+ New Job</button>
    </nav>

    <!-- Content body -->
    <div class="mkt-body">

      <!-- Chat messages -->
      <div class="mkt-chat" id="mktChat"></div>

      <!-- Resize handle -->
      <div class="mkt-resize" id="mktResize"></div>

      <!-- Input dock: OSK 60% | textarea 40% -->
      <div class="mkt-input-dock">
        <div class="mkt-input-row">

          <!-- OSK — 60% -->
          <div class="mkt-osk">
            <div class="mkt-osk-label">Quick insert</div>

            <div class="mkt-osk-row">
              <button class="mkt-key action" onclick="MKT.insert('Awareness day: ')">📅 Awareness day</button>
              <button class="mkt-key action" onclick="MKT.insert('News reaction: ')">📰 News reaction</button>
              <button class="mkt-key action" onclick="MKT.insert('Myth vs fact: ')">⚖ Myth vs fact</button>
            </div>
            <div class="mkt-osk-row">
              <button class="mkt-key action" onclick="MKT.insert('Data infographic: ')">📊 Data infographic</button>
              <button class="mkt-key action" onclick="MKT.insert('Service explainer: ')">💬 Service explainer</button>
              <button class="mkt-key action" onclick="MKT.insert('Quote post: ')">💭 Quote post</button>
            </div>
            <div class="mkt-osk-row">
              <button class="mkt-key fn" onclick="MKT.insert('@Pixel ')">@Pixel</button>
              <button class="mkt-key fn" onclick="MKT.insert('@Quill ')">@Quill</button>
              <button class="mkt-key fn" onclick="MKT.insert('@Scout ')">@Scout</button>
              <button class="mkt-key fn" onclick="MKT.insert('@Relay ')">@Relay</button>
              <button class="mkt-key fn" onclick="MKT.insert('@Bridge ')">@Bridge</button>
              <button class="mkt-key fn" onclick="MKT.insert('@Tempo ')">@Tempo</button>
            </div>
            <div class="mkt-osk-row">
              <button class="mkt-key fn" onclick="MKT.insert('#MentalHealth ')">🏷 #MentalHealth</button>
              <button class="mkt-key fn" onclick="MKT.insert('#AddictionRecovery ')">🏷 #AddictionRecovery</button>
              <button class="mkt-key fn" onclick="MKT.insert('#Recovery ')">🏷 #Recovery</button>
              <button class="mkt-key fn" onclick="MKT.insert('#Trauma ')">🏷 #Trauma</button>
            </div>
            <div class="mkt-osk-row">
              <button class="mkt-key fn" onclick="MKT.insert('teal variant')">teal</button>
              <button class="mkt-key fn" onclick="MKT.insert('rose variant')">rose</button>
              <button class="mkt-key fn" onclick="MKT.insert('dark variant')">dark</button>
              <button class="mkt-key fn" onclick="MKT.insert('ivory variant')">ivory</button>
              <button class="mkt-key wide" onclick="MKT.insert('identitypartners.uk')">identitypartners.uk</button>
            </div>
          </div>

          <!-- Text input — 40% -->
          <div class="mkt-text-wrap">
            <textarea
              class="mkt-textarea"
              id="mktInput"
              placeholder="Give Pixel a topic or occasion…"
              onkeydown="MKT.handleKey(event)"
            ></textarea>
            <div class="mkt-input-actions">
              <button class="mkt-btn" onclick="MKT.openImageSearch()">🖼 Images</button>
              <button class="mkt-btn" onclick="MKT.attachFile()">📎 Attach</button>
              <button class="mkt-btn primary" onclick="MKT.send()">Send ↵</button>
            </div>
          </div>

        </div>
      </div>

    </div><!-- /mkt-body -->

    <!-- ── Pipeline panel ── -->
    <div class="mkt-pipeline" id="mktPipeline">
      <div class="mkt-pipeline-tabs">
        ${pipelineTabs}
      </div>
      <div class="mkt-pipeline-body" id="mktPipelineBody"></div>
    </div>

  </div><!-- /mkt-main -->
</div><!-- /mkt-shell -->

<!-- Image search modal -->
<div class="mkt-modal-overlay" id="mktImgModal" onclick="MKT.closeModalOutside(event)">
  <div class="mkt-modal">
    <div class="mkt-modal-header">
      <div class="mkt-modal-title">🖼 Semantic Image Search</div>
      <button class="mkt-modal-close" onclick="MKT.closeImageSearch()">✕</button>
    </div>
    <div class="mkt-modal-search">
      <input class="mkt-modal-input" type="text" id="mktImgQuery"
             placeholder="Topic or occasion — Mistral Small expands to 5 visual queries automatically"
             onkeydown="if(event.key==='Enter')MKT.runImageSearch()">
      <button class="mkt-btn primary" onclick="MKT.runImageSearch()">Search</button>
    </div>
    <div class="mkt-source-row">
      <span class="mkt-source-label">Sources:</span>
      <div class="mkt-source-pill active-pexels"    data-source="pexels"    onclick="MKT.toggleSource(this,'pexels')">Pexels</div>
      <div class="mkt-source-pill active-unsplash"  data-source="unsplash"  onclick="MKT.toggleSource(this,'unsplash')">Unsplash</div>
      <div class="mkt-source-pill active-pixabay"   data-source="pixabay"   onclick="MKT.toggleSource(this,'pixabay')">Pixabay</div>
      <div class="mkt-source-pill active-openverse" data-source="openverse" onclick="MKT.toggleSource(this,'openverse')">Openverse</div>
    </div>
    <div class="mkt-modal-body">
      <div class="mkt-img-grid" id="mktImgGrid">
        <div style="grid-column:1/-1;text-align:center;padding:32px;color:#484f58;font-size:12px;">
          Enter a topic above to search across Pexels, Unsplash, Pixabay, and Openverse.
        </div>
      </div>
    </div>
  </div>
</div>
`;
}

// ─────────────────────────────────────────────
// JAVASCRIPT
// ─────────────────────────────────────────────

function marketingTeamJS() {
  return `
(function() {
'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  activeAgent:   'visual',
  activePtab:    'visual',
  expandedJobs:  new Set(),
  activeSources: new Set(['pexels','unsplash','pixabay','openverse']),
  jobs: {
    visual:    [],
    copy:      [],
    research:  [],
    social:    [],
    platform:  [],
    scheduler: [],
  },
};

const AGENTS = ${JSON.stringify(AGENTS)};

const PLACEHOLDERS = {
  visual:    'Give Pixel a topic or occasion — e.g. "World Mental Health Day — awareness post"',
  copy:      'Give Quill a brief — e.g. "Instagram caption for WMHD post, Simon voice"',
  research:  'Give Scout a research task — e.g. "ONS addiction statistics 2026"',
  social:    'Give Relay a scheduling task — e.g. "Schedule WMHD posts across all channels"',
  platform:  'Give Bridge a platform task — e.g. "Fetch Buffer channel IDs"',
  scheduler: 'Give Tempo a calendar task — e.g. "List awareness days for December 2026"',
};

// ── Helpers ────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function now() {
  return new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC';
}

function statusDotClass(s) {
  return {running:'jdot-running',queued:'jdot-queued',pending:'jdot-pending',done:'jdot-done',error:'jdot-error'}[s]||'jdot-pending';
}

// ── Job queue fetch ────────────────────────────────────────
async function fetchJobs(agentId) {
  try {
    const res = await fetch('/api/mm/jobs?agent=' + agentId);
    if (!res.ok) return;
    const data = await res.json();
    state.jobs[agentId] = data.jobs || [];
    updateBadge(agentId);
    if (agentId === state.activePtab) renderPipeline(agentId);
  } catch(e) {
    // silently fail — Worker may not be reachable in dev
  }
}

function updateBadge(agentId) {
  const count = state.jobs[agentId].filter(j => j.status !== 'done').length;
  const badge = document.getElementById('badge-' + agentId);
  const ptabCount = document.getElementById('ptab-count-' + agentId);
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('busy', count > 0);
  }
  if (ptabCount) ptabCount.textContent = count;
}

// ── Pipeline render ────────────────────────────────────────
function renderPipeline(agentId) {
  const body = document.getElementById('mktPipelineBody');
  if (!body) return;
  const jobs = state.jobs[agentId] || [];

  if (jobs.length === 0) {
    body.innerHTML = '<div class="mkt-pipeline-empty"><span>No jobs in queue</span></div>';
    return;
  }

  body.innerHTML = '<div>' + jobs.map((job, idx) => renderJob(job, idx, jobs.length)).join('') + '</div>';
}

function renderJob(job, idx, total) {
  const expanded = state.expandedJobs.has(job.id);
  const canUp    = idx > 0;
  const canDown  = idx < total - 1;

  const logHtml = (job.log || []).map(l =>
    '<div class="mkt-log-' + (l.cls||'') + '">' + esc(l.t) + ' — ' + esc(l.msg) + '</div>'
  ).join('');

  const detailGrid = [
    ['Type',    job.type    || '—'],
    ['Model',   job.model   || '—'],
    ['Status',  job.status  || '—'],
    ['Created', job.created || '—'],
  ].map(([label, val]) =>
    '<div class="mkt-jd-field"><div class="mkt-jd-label">' + label + '</div><div class="mkt-jd-value">' + esc(val) + '</div></div>'
  ).join('');

  const progressBar = (job.progress > 0)
    ? '<div class="mkt-job-progress"><div class="mkt-job-progress-fill" style="width:' + job.progress + '%"></div></div>'
    : '';

  return '<div class="mkt-job' + (expanded ? ' expanded' : '') + '" id="mktjob-' + esc(job.id) + '">' +
    '<div class="mkt-job-header" onclick="MKT.toggleJob(\'' + job.id + '\')">' +
      '<div class="mkt-job-controls" onclick="event.stopPropagation()">' +
        '<button class="mkt-job-ctrl" ' + (canUp ? '' : 'disabled') + ' onclick="MKT.moveJob(\'' + job.id + '\',-1)" title="Promote ↑">▲</button>' +
        '<button class="mkt-job-ctrl" ' + (canDown ? '' : 'disabled') + ' onclick="MKT.moveJob(\'' + job.id + '\',1)" title="Demote ↓">▼</button>' +
      '</div>' +
      '<div class="mkt-job-priority">#' + (job.priority || idx + 1) + '</div>' +
      '<div class="mkt-job-dot ' + statusDotClass(job.status) + '"></div>' +
      '<div class="mkt-job-info">' +
        '<div class="mkt-job-title">' + esc(job.title || '') + '</div>' +
        '<div class="mkt-job-sub">'   + esc(job.sub   || '') + '</div>' +
      '</div>' +
      '<div class="mkt-job-eta">' +
        '<span class="mkt-job-eta-time">'  + esc(job.eta      || '—') + '</span>' +
        '<span class="mkt-job-eta-label">' + esc(job.etaLabel || '')  + '</span>' +
      '</div>' +
      '<div class="mkt-job-chevron">▶</div>' +
    '</div>' +
    '<div class="mkt-job-detail">' +
      '<div class="mkt-job-detail-grid">' + detailGrid + '</div>' +
      progressBar +
      '<div class="mkt-job-log">' + logHtml + '</div>' +
      '<div class="mkt-job-actions">' +
        '<button class="mkt-job-action" onclick="MKT.retryJob(\'' + job.id + '\')">↻ Retry</button>' +
        '<button class="mkt-job-action" onclick="MKT.pauseJob(\'' + job.id + '\')">⏸ Pause</button>' +
        '<button class="mkt-job-action danger" onclick="MKT.cancelJob(\'' + job.id + '\')">✕ Cancel</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── Job actions ────────────────────────────────────────────
function toggleJob(id) {
  if (state.expandedJobs.has(id)) state.expandedJobs.delete(id);
  else state.expandedJobs.add(id);
  renderPipeline(state.activePtab);
}

async function moveJob(id, dir) {
  const jobs = state.jobs[state.activePtab];
  const idx  = jobs.findIndex(j => j.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= jobs.length) return;
  [jobs[idx], jobs[newIdx]] = [jobs[newIdx], jobs[idx]];
  jobs.forEach((j, i) => j.priority = i + 1);
  renderPipeline(state.activePtab);
  // Persist to Worker
  try {
    await fetch('/api/mm/jobs/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: state.activePtab, jobId: id, direction: dir }),
    });
  } catch(e) {}
}

async function retryJob(id) {
  try { await fetch('/api/mm/jobs/' + id + '/retry', { method: 'POST' }); } catch(e) {}
  fetchJobs(state.activePtab);
}

async function pauseJob(id) {
  try { await fetch('/api/mm/jobs/' + id + '/pause', { method: 'POST' }); } catch(e) {}
  fetchJobs(state.activePtab);
}

async function cancelJob(id) {
  if (!confirm('Cancel this job?')) return;
  try { await fetch('/api/mm/jobs/' + id + '/cancel', { method: 'POST' }); } catch(e) {}
  state.jobs[state.activePtab] = state.jobs[state.activePtab].filter(j => j.id !== id);
  state.expandedJobs.delete(id);
  updateBadge(state.activePtab);
  renderPipeline(state.activePtab);
}

// ── Keyboard: ↑↓ on focused job ───────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const focused = document.querySelector('.mkt-job:focus-within');
  if (!focused) return;
  const id  = focused.id.replace('mktjob-', '');
  const dir = e.key === 'ArrowUp' ? -1 : 1;
  e.preventDefault();
  moveJob(id, dir);
});

// ── Tab switching ──────────────────────────────────────────
function switchAgent(agentId) {
  state.activeAgent = agentId;

  document.querySelectorAll('.mkt-agent').forEach(el => el.classList.remove('active'));
  const orchEl = document.getElementById('orch-' + agentId);
  if (orchEl) orchEl.classList.add('active');

  document.querySelectorAll('.mkt-tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + agentId);
  if (tabEl) tabEl.classList.add('active');

  const ta = document.getElementById('mktInput');
  if (ta) ta.placeholder = PLACEHOLDERS[agentId] || '';

  switchPipelineTab(agentId);
  loadChatHistory(agentId);
}

function switchPipelineTab(agentId) {
  state.activePtab = agentId;
  state.expandedJobs.clear();

  document.querySelectorAll('.mkt-ptab').forEach(el => el.classList.remove('active'));
  const ptab = document.getElementById('ptab-' + agentId);
  if (ptab) ptab.classList.add('active');

  fetchJobs(agentId);
}

// ── Chat ───────────────────────────────────────────────────
function loadChatHistory(agentId) {
  const chat = document.getElementById('mktChat');
  if (!chat) return;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;
  chat.innerHTML = renderMsg('agent', agent.initial, agent.nick + ' ready. Give me a topic or occasion.', now(), agent.id);
  chat.scrollTop = chat.scrollHeight;
}

function renderMsg(role, initial, text, time, agentId) {
  const agent = AGENTS.find(a => a.id === agentId) || {};
  const colour = agent.colour || '#58a6ff';
  const avatarStyle = role === 'agent'
    ? 'background:linear-gradient(135deg,' + colour + ',#bc8cff);color:#fff'
    : 'background:var(--bg-card,#1c2330);border:1px solid var(--border,#30363d);color:var(--text-secondary,#8b949e)';

  return '<div class="mkt-msg ' + role + '">' +
    '<div class="mkt-avatar ' + role + '" style="' + avatarStyle + '">' + esc(initial) + '</div>' +
    '<div>' +
      '<div class="mkt-bubble">' + esc(text) + '</div>' +
      '<div class="mkt-msg-meta' + (role === 'user' ? ' style="text-align:right"' : '') + '">' + esc(time) + '</div>' +
    '</div>' +
  '</div>';
}

function insert(text) {
  const ta = document.getElementById('mktInput');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
}

function handleKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
}

async function send() {
  const ta   = document.getElementById('mktInput');
  const chat = document.getElementById('mktChat');
  const text = ta ? ta.value.trim() : '';
  if (!text || !chat) return;

  const agent = AGENTS.find(a => a.id === state.activeAgent);
  const t = now();

  chat.innerHTML += renderMsg('user', 'SJ', text, t, state.activeAgent);
  ta.value = '';
  chat.scrollTop = chat.scrollHeight;

  try {
    const model = document.getElementById('mktModel')?.value || 'gemini-4-argon';
    const res = await fetch('/api/mm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: state.activeAgent, message: text, model }),
    });
    const data = await res.json();
    const reply = data.reply || 'Job queued.';
    chat.innerHTML += renderMsg('agent', agent?.initial || 'A', reply, now(), state.activeAgent);
    chat.scrollTop = chat.scrollHeight;
    // Refresh job queue after sending
    setTimeout(() => fetchJobs(state.activeAgent), 1500);
  } catch(e) {
    chat.innerHTML += renderMsg('agent', agent?.initial || 'A', 'Error reaching Worker. Check network.', now(), state.activeAgent);
    chat.scrollTop = chat.scrollHeight;
  }
}

// ── Image search ───────────────────────────────────────────
function openImageSearch() {
  const modal = document.getElementById('mktImgModal');
  if (modal) { modal.classList.add('open'); document.getElementById('mktImgQuery')?.focus(); }
}

function closeImageSearch() {
  const modal = document.getElementById('mktImgModal');
  if (modal) modal.classList.remove('open');
}

function closeModalOutside(ev) {
  if (ev.target === document.getElementById('mktImgModal')) closeImageSearch();
}

function toggleSource(el, source) {
  const activeClass = 'active-' + source;
  if (el.classList.contains(activeClass)) {
    el.classList.remove(activeClass);
    state.activeSources.delete(source);
  } else {
    el.classList.add(activeClass);
    state.activeSources.add(source);
  }
}

async function runImageSearch() {
  const q    = document.getElementById('mktImgQuery')?.value.trim();
  const grid = document.getElementById('mktImgGrid');
  if (!q || !grid) return;

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#484f58;font-size:12px;">Expanding "' + esc(q) + '" via Mistral Small → searching ' + [...state.activeSources].join(', ') + '…</div>';

  try {
    const res = await fetch('/api/canvas/search-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: q, sources: [...state.activeSources] }),
    });
    const data = await res.json();
    const images = data.images || [];

    if (images.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#484f58;font-size:12px;">No images found. Try a different topic.</div>';
      return;
    }

    grid.innerHTML = images.map(img =>
      '<div class="mkt-img-thumb" onclick="MKT.selectImage(\'' + esc(img.url) + '\')">' +
        '<img src="' + esc(img.url) + '" alt="' + esc(img.alt || '') + '" loading="lazy">' +
        '<div class="mkt-img-source">' + esc(img.source) + '</div>' +
      '</div>'
    ).join('');
  } catch(e) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#f85149;font-size:12px;">Search failed. Worker may be unreachable.</div>';
  }
}

function selectImage(url) {
  insert(url + ' ');
  closeImageSearch();
}

// ── Resize handle ──────────────────────────────────────────
(function() {
  const handle   = document.getElementById('mktResize');
  const pipeline = document.getElementById('mktPipeline');
  if (!handle || !pipeline) return;
  let dragging = false, startY = 0, startH = 0;

  handle.addEventListener('mousedown', function(e) {
    dragging = true; startY = e.clientY; startH = pipeline.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const delta = startY - e.clientY;
    pipeline.style.height = Math.max(120, Math.min(520, startH + delta)) + 'px';
  });
  document.addEventListener('mouseup', function() {
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ── Stubs for footer buttons ───────────────────────────────
function openQueue()    { /* navigate to /social-queue */ window.location.href = '/social-queue'; }
function openSettings() { /* navigate to /settings */     window.location.href = '/settings'; }
function attachFile()   { /* trigger file input */
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,.pdf,.doc,.docx';
  inp.onchange = function() {
    if (inp.files[0]) insert('[Attached: ' + inp.files[0].name + '] ');
  };
  inp.click();
}

// ── Keyboard shortcut: Escape closes modal ─────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeImageSearch();
});

// ── Init ───────────────────────────────────────────────────
function init() {
  switchAgent('visual');
  AGENTS.forEach(a => fetchJobs(a.id));
  // Poll for job updates every 15 seconds
  setInterval(function() { fetchJobs(state.activePtab); }, 15000);
}

// ── Public API ─────────────────────────────────────────────
window.MKT = {
  switchAgent, switchPipelineTab,
  toggleJob, moveJob, retryJob, pauseJob, cancelJob,
  insert, handleKey, send,
  openImageSearch, closeImageSearch, closeModalOutside, toggleSource, runImageSearch, selectImage,
  openQueue, openSettings, attachFile,
};

init();

})();
`;
}

// ─────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────

function renderMarketingTeam() {
  return {
    html: marketingTeamHTML(),
    css:  marketingTeamCSS(),
    js:   marketingTeamJS(),
  };
}

export {
  marketingTeamHTML,
  marketingTeamCSS,
  marketingTeamJS,
  renderMarketingTeam,
  AGENTS,
};