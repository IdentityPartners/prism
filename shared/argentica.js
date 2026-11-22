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
        { label: 'Stick studio', href: '/argentica/create/studio/', key: 'studio' }
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
        return '<div class="section">' + ws.nav + '</div>' +
          '<a href="' + home.href + '"' + (active ? ' class="active"' : '') + '>' + ws.nav + '</a>' +
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

  window.ARG = { api, toast, esc, md, buildShell, WORKSPACES };
})();
