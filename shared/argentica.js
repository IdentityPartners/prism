// ARGENTICA shared shell — nav, workspace tabs, helpers
(function () {
  const API = '/api';

  // ── Theme: dawn/dusk brand pack, toggleable ──
  let argTheme = 'brand';
  try { argTheme = localStorage.getItem('arg:theme') || 'brand'; } catch (e) {}
  document.documentElement.setAttribute('data-argtheme', argTheme);
  function switchTheme(t) {
    argTheme = t;
    document.documentElement.setAttribute('data-argtheme', t);
    try { localStorage.setItem('arg:theme', t); } catch (e) {}
    document.querySelectorAll('[data-theme-btn]').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-theme-btn') === t);
    });
  }
  window.ARGSwitchTheme = switchTheme;

  async function api(path, opts) {
    const res = await fetch(API + path, opts);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('audio/')) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function toast(msg, ms) {
    let el = document.getElementById('arg-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'arg-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, ms || 3200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // minimal markdown for chat bubbles
  function md(src) {
    let t = esc(src);
    t = t.replace(/```([\s\S]*?)```/g, (m, c) => '<pre>' + c.replace(/^\n/, '') + '</pre>');
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/^### (.*)$/gm, '<h4>$1</h4>');
    t = t.replace(/^## (.*)$/gm, '<h3>$1</h3>');
    t = t.replace(/^# (.*)$/gm, '<h3>$1</h3>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/^[-*] (.*)$/gm, '&bull; $1');
    t = t.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:10px; margin:6px 0;" loading="lazy">');
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  // ── Workspace structure: main nav clusters, each with subsection tabs ──
  const WORKSPACES = {
    library: {
      nav: 'Library',
      tabs: [
        { label: 'Study hub', href: '/argentica/library/', key: 'library' },
        { label: 'Notebooks', href: '/argentica/library/notebooks/', key: 'notebooks' },
        { label: 'Debate society', href: '/argentica/library/debate/', key: 'debate' },
        { label: 'Drafting desk', href: '/argentica/library/drafting/', key: 'drafting' },
        { label: 'Memory', href: '/argentica/library/memory/', key: 'memory' },
        { label: 'Search', href: '/argentica/library/search/', key: 'library-search' }
      ]
    },
    research: {
      nav: 'Research',
      tabs: [
        { label: 'One-off search', href: '/argentica/research/', key: 'research' },
        { label: 'Planned runs', href: '/argentica/research/runs/', key: 'runs' },
        { label: 'Watching briefs', href: '/argentica/research/watching/', key: 'watching' }
      ]
    },
    knowledge: {
      nav: 'Knowledge',
      tabs: [
        { label: 'Knowledge base', href: '/argentica/library/knowledge/', key: 'knowledge' }
      ]
    },
    create: {
      nav: 'Create',
      tabs: [
        { label: 'Canvas', href: '/argentica/create/', key: 'canvas' },
        { label: 'Carousels', href: '/argentica/create/carousels/', key: 'carousels' },
        { label: 'Podcast & audio', href: '/argentica/create/podcast/', key: 'podcast' },
        { label: 'Media', href: '/argentica/create/media/', key: 'media' },
        { label: 'Music', href: '/argentica/create/music/', key: 'music' },
        { label: 'Stick studio', href: '/argentica/create/studio/', key: 'studio' },
        { label: 'Asset library', href: '/argentica/create/assets/', key: 'assets' }
      ]
    },
    commercial: {
      nav: 'Commercial',
      tabs: [
        { label: 'Publishing', href: '/argentica/commercial/publishing/', key: 'publishing' },
        { label: 'Refract', href: '/argentica/commercial/refract/', key: 'refract' },
        { label: 'Marketing team', href: '/argentica/commercial/team/', key: 'team' },
        { label: 'Monetisation', href: '/argentica/commercial/monetisation/', key: 'monetisation' },
        { label: 'Platforms', href: '/argentica/commercial/platforms/', key: 'platforms' },
        { label: 'Publishing calendar', href: '/argentica/commercial/calendar/', key: 'pubcalendar' },
        { label: 'Weekly cadence', href: '/argentica/commercial/cadence/', key: 'cadence' }
      ]
    },
    comms: {
      nav: 'Comms',
      tabs: [
        { label: 'Email', href: '/argentica/comms/email/', key: 'email' },
        { label: 'Calendar', href: '/argentica/comms/calendar/', key: 'calendar' },
        { label: 'Messages', href: '/argentica/comms/messages/', key: 'messages' },
        { label: 'CRM', href: '/argentica/comms/crm/', key: 'crm' }
      ]
    },
    system: {
      nav: 'System',
      tabs: [
        { label: 'Status', href: '/argentica/system/', key: 'system' },
        { label: 'Dev Team', href: '/argentica/system/devteam/', key: 'devteam' },
        { label: 'Agents', href: '/argentica/system/agents/', key: 'agents' },
        { label: 'Personas', href: '/argentica/system/personas/', key: 'personas' },
        { label: 'Memories', href: '/argentica/system/memories/', key: 'system-memories' }
      ]
    }
  };

  function workspaceOf(key) {
    for (const [id, ws] of Object.entries(WORKSPACES)) {
      if (ws.tabs.some(t => t.key === key)) return { id, ws };
    }
    return null;
  }

  function buildShell(activeKey) {
    document.body.classList.add('arg-body');
    const found = workspaceOf(activeKey);

    // Collapsed state: remembered per browser; Home always starts collapsed.
    let navCollapsed = false;
    try { navCollapsed = localStorage.getItem('arg:nav-collapsed') === '1'; } catch (e) {}
    if (activeKey === 'home' && argTheme !== 'brand') navCollapsed = true;  // under Dawn the sidebar stays exposed on Home

    const side = document.createElement('aside');
    side.className = 'arg-side' + (navCollapsed ? ' collapsed' : '');
    side.innerHTML =
      '<button class="nav-toggle" title="Collapse / expand the toolbar" aria-label="Toggle toolbar">' + (navCollapsed ? '\u203A' : '\u2039') + '</button>' +
      '<div class="brand"><img src="/shared/assets/logo-square.png" alt="Identity Partners"><div class="name">Argentica</div></div>' +
      '<nav class="arg-nav">' +
      '<div class="section">Work</div>' +
      '<a href="/argentica/"' + (activeKey === 'home' ? ' class="active"' : '') + '>Home</a>' +
      '<a href="/argentica/chat/"' + (activeKey === 'chat' ? ' class="active"' : '') + '>Tay (Chat)</a>' +
      Object.entries(WORKSPACES).map(([id, ws]) => {
        const active = found && found.id === id;
        const home = ws.tabs[0];
        const linkLabel = (home.label && home.label.toLowerCase().indexOf(ws.nav.toLowerCase()) === 0) ? home.label : ws.nav;
        return '<div class="section">' + ws.nav + '</div>' +
          '<a href="' + home.href + '"' + (active ? ' class="active"' : '') + '>' + linkLabel + '</a>' +
          (active ? ws.tabs.map(t =>
            '<a href="' + t.href + '" style="padding-left:26px; font-size:12.5px;"' + (t.key === activeKey ? ' class="active"' : '') + '>' + t.label + '</a>'
          ).join('') : '');
      }).join('').replace(/(<a href="[^"]+"[^>]*>)(Home|Tay \(Chat\)|Library|Research|Create|Commercial|Comms|System|[^<>]{2,20})(<\/a>)/g, function (m, a, txt, z) { return a + '<span class="navlbl">' + txt + '</span>' + z; }) +
      '</nav>' +
      '<div class="arg-theme-row">' +
        '<button data-theme-btn="brand" title="Identity Partners dawn/dusk brand pack">Dawn</button>' +
        '<button data-theme-btn="classic" title="The original Argentica teal">Classic</button>' +
      '</div>';

    const shell = document.createElement('div');
    shell.className = 'arg-shell';
    document.body.prepend(shell);
    const main = document.createElement('main');
    main.className = 'arg-main';
    shell.append(side, main);
    const page = document.querySelector('.arg-page');
    if (page) {
      // subsection tab bar
      if (found) {
        const tabs = document.createElement('div');
        tabs.className = 'arg-tabs';
        tabs.innerHTML = found.ws.tabs.map(t =>
          '<a href="' + t.href + '"' + (t.key === activeKey ? ' class="active"' : '') + '>' + t.label + '</a>'
        ).join('');
        page.prepend(tabs);
      }
      main.appendChild(page);
    }

    // Theme buttons
    side.querySelectorAll('[data-theme-btn]').forEach(b => {
      b.addEventListener('click', () => switchTheme(b.getAttribute('data-theme-btn')));
      b.classList.toggle('on', b.getAttribute('data-theme-btn') === argTheme);
    });

    // Toolbar collapse toggle
    const toggle = side.querySelector('.nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const collapsed = side.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '\u203A' : '\u2039';
        try { localStorage.setItem('arg:nav-collapsed', collapsed ? '1' : '0'); } catch (e) {}
      });
    }
  }


// ── Drafts: work in progress survives navigating away and back ──
(function () {
  var KEY = function () { return 'argdraft:' + location.pathname; };
  function load() { try { return JSON.parse(localStorage.getItem(KEY()) || '{}'); } catch (e) { return {}; } }
  function save(map) { try { localStorage.setItem(KEY(), JSON.stringify(map)); } catch (e) {} }
  var t = null;
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var map = load();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      if (!el.id && !el.name) return;
      map[(el.id || 'n:' + el.name)] = el.value;
    } else if (el.isContentEditable) {
      // Quill / richtext editors
      map['#ce:' + (el.id || el.className.split(' ')[0] || 'anon')] = el.innerHTML;
    } else return;
    clearTimeout(t); t = setTimeout(function () { save(map); }, 400);
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.tagName === 'SELECT' && el.id) { var map = load(); map[el.id] = el.value; save(map); }
  }, true);
  window.addEventListener('load', function () {
    var map = load();
    if (!Object.keys(map).length) return;
    var restored = 0;
    Object.keys(map).forEach(function (k) {
      if (k.indexOf('#ce:') === 0) return;
      var el = document.getElementById(k) || (k.indexOf('n:') === 0 ? document.querySelector('[name="' + k.slice(2) + '"]') : null);
      if (el && map[k] && el.value !== map[k]) { el.value = map[k]; restored++; }
    });
    setTimeout(function () {
      Object.keys(map).forEach(function (k) {
        if (k.indexOf('#ce:') !== 0) return;
        var ceId = k.slice(4);
        var el = ceId ? document.getElementById(ceId) : document.querySelector('.ql-editor');
        if (el && el.isContentEditable && map[k] && !el.innerHTML) { el.innerHTML = map[k]; restored++; }
      });
      if (restored > 0 && window.ARG && window.ARG.toast) window.ARG.toast('Draft restored from where you left off.');
    }, 700);
  });
  window.ARG_drafts = { clear: function () { try { localStorage.removeItem(KEY()); } catch (e) {} }, get: load };
})();

// ── Second window: an in-system "tab" for the PWA ──
(function () {
  var b = document.createElement('button');
  b.innerHTML = '&#8855;';
  b.title = 'Open this area in a new window (kept separate, work preserved)';
  b.style.cssText = 'position:fixed;right:66px;bottom:18px;z-index:400;width:40px;height:40px;border-radius:50%;border:1px solid #d8cfc0;background:#fffdf6;color:#5c2d3f;font-size:17px;cursor:pointer;box-shadow:0 6px 18px rgba(43,33,23,.18);';
  b.onclick = function () { window.open(location.href, '_blank'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
  else document.body.appendChild(b);
})();

  window.ARG = { api, toast, esc, md, buildShell, WORKSPACES, openAddendum: function () { var b = document.body.querySelector('button[title^="Prompt instructions"]'); if (b) b.click(); }, addendumOn: function () { try { return localStorage.getItem('arg_addendum_on') === '1'; } catch (e) { return false; } } };

// ── Optional prompt addendum: applies to every chat request on every page ──
(function () {
  var PB = 'arg_addendum_on', PC = 'arg_addendum_content';
  var CITATION = 'CITATION DISCIPLINE (mandatory, overrides helpfulness norms):\n' +
    '1. Never generate authors, titles, dates, DOIs, journal names or URLs from memory. Bibliographic data only from sources retrieved in this session. No retrievable source = no citation.\n' +
    '2. Output "[not verified]" for anything you cannot ground. Reporting absence ("no reliable source found for X") is a complete, correct, rewarded answer. Invented sources are the only unforgivable failure.\n' +
    '3. Every citation must carry its supporting passage. No passage = the citation does not count.\n' +
    '4. Tag all claims: [verified] / [recall] / [inference]. Language strength must match the tag. Report conflicts between sources rather than resolving them silently.';

  function addendumActive() {
    try { return localStorage.getItem(PB) === '1' && (localStorage.getItem(PC) || '').trim().length > 0; } catch (e) { return false; }
  }

  // wrap fetch so every POST to a chat route carries the addendum when on
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (addendumActive() && init && init.method && /POST/i.test(init.method) && typeof init.body === 'string') {
        var u = (typeof input === 'string') ? input : (input && input.url) || '';
        if (/\/api\/(chat|mm\/chat)/.test(u)) {
          var b = JSON.parse(init.body);
          if (b && !b.addendum) { b.addendum = localStorage.getItem(PC); init = Object.assign({}, init, { body: JSON.stringify(b) }); }
        }
      }
    } catch (e) {}
    return _fetch(input, init);
  };

  // floating control
  var btn = document.createElement('button');
  btn.innerHTML = '&#167;';
  btn.title = 'Prompt instructions (optional addendum for all chat requests)';
  btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:400;width:40px;height:40px;border-radius:50%;border:1px solid #d8cfc0;background:' + (function(){try{return localStorage.getItem(PB)==='1'?'#5c2d3f':'#fffdf6';}catch(e){return '#fffdf6';}})() + ';color:' + (function(){try{return localStorage.getItem(PB)==='1'?'#f7f3e9':'#5c2d3f';}catch(e){return '#5c2d3f';}})() + ';font-family:\'EB Garamond\',Georgia,serif;font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(43,33,23,.18);';
  btn.onclick = function () {
    var modal = document.getElementById('arg-addendum-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'arg-addendum-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(43,33,23,.34);z-index:500;display:none;align-items:center;justify-content:center;';
      modal.innerHTML = '<div style="background:#f7f3e9;border:1px solid #d8cfc0;border-radius:12px;padding:22px 24px;width:min(640px,94vw);max-height:86vh;overflow-y:auto;">' +
        '<h3 style="margin:0 0 2px;font-family:\'EB Garamond\',Georgia,serif;color:#5c2d3f;">Prompt instructions</h3>' +
        '<div style="font-size:12px;color:#7a4254;margin-bottom:12px;">Optional addendum attached to every chat request on every page (drafting, notebooks, debate, research, agents). Toggle on and paste your instructions, or start from the Citation Discipline preset.</div>' +
        '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:12px;"><input type="checkbox" id="adm-on"> Attach these instructions to chat requests</label>' +
        '<textarea id="adm-text" rows="12" style="width:100%;box-sizing:border-box;font-size:12.5px;font-family:Inter,sans-serif;"></textarea>' +
        '<div style="display:flex;justify-content:space-between;margin-top:14px;gap:8px;">' +
        '<button id="adm-preset" style="border:1px solid #d8cfc0;background:#fffdf6;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:11.5px;">Insert Citation Discipline</button>' +
        '<div style="display:flex;gap:8px;"><button id="adm-save" style="border:0;background:#5c2d3f;color:#f7f3e9;border-radius:999px;padding:8px 16px;cursor:pointer;">Save</button></div></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
      modal.querySelector('#adm-preset').onclick = function () { modal.querySelector('#adm-text').value = CITATION; };
      modal.querySelector('#adm-save').onclick = function () {
        try {
          localStorage.setItem(PB, modal.querySelector('#adm-on').checked ? '1' : '0');
          localStorage.setItem(PC, modal.querySelector('#adm-text').value);
        } catch (e) {}
        modal.style.display = 'none';
        var active = addendumActive();
        btn.style.background = active ? '#5c2d3f' : '#fffdf6';
        btn.style.color = active ? '#f7f3e9' : '#5c2d3f';
        if (window.ARG && window.ARG.toast) window.ARG.toast(active ? 'Instructions attached to all chat requests.' : 'Instructions detached.');
      };
    }
    modal.querySelector('#adm-on').checked = (function(){try{return localStorage.getItem(PB)==='1';}catch(e){return false;}})();
    modal.querySelector('#adm-text').value = (function(){try{return localStorage.getItem(PC) || '';}catch(e){return '';}})();
    modal.style.display = 'flex';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(btn); });
  else document.body.appendChild(btn);
})();

})();
