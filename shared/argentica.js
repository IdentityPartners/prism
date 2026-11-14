// ARGENTICA shared shell — nav, helpers
(function () {
  const API = '/api';

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
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  const NAV = [
    { section: 'Work' },
    { label: 'Home', href: '/argentica/', key: 'home' },
    { label: 'Gerald (Chat)', href: '/argentica/chat/', key: 'chat' },
    { label: 'Study', href: '/argentica/study/', key: 'study' },
    { label: 'Research', href: '/argentica/research/', key: 'research' },
    { section: 'Practice' },
    { label: 'Social', href: '/argentica/social/', key: 'social' },
    { label: 'Marketing team', href: '/argentica/social/team/', key: 'team' },
    { label: 'Podcast & audio', href: '/argentica/social/podcast/', key: 'podcast' },
    { label: 'Media', href: '/argentica/social/media/', key: 'media' },
    { section: 'Comms' },
    { label: 'CRM', href: '/argentica/comms/crm/', key: 'crm' },
    { label: 'Email', href: '/argentica/comms/email/', key: 'email' },
    { label: 'Calendar', href: '/argentica/comms/calendar/', key: 'calendar' },
    { label: 'Messages', href: '/argentica/comms/messages/', key: 'messages' },
    { section: 'System' },
    { label: 'Status', href: '/argentica/system/', key: 'system' },
  ];

  function buildShell(activeKey) {
    document.body.classList.add('arg-body');
    const side = document.createElement('aside');
    side.className = 'arg-side';
    side.innerHTML =
      '<div class="brand"><img src="/shared/assets/logo-square.png" alt="Identity Partners"><div class="name">Argentica</div></div>' +
      '<nav class="arg-nav">' +
      NAV.map(n => n.section
        ? '<div class="section">' + n.section + '</div>'
        : '<a href="' + n.href + '"' + (n.key === activeKey ? ' class="active"' : '') + '>' + n.label + '</a>'
      ).join('') +
      '</nav>';
    const shell = document.createElement('div');
    shell.className = 'arg-shell';
    document.body.prepend(shell);
    const main = document.createElement('main');
    main.className = 'arg-main';
    shell.append(side, main);
    while (document.body.contains(side) === false) break;
    // move existing page content into main
    const page = document.querySelector('.arg-page');
    if (page) main.appendChild(page);
  }

  window.ARG = { api, toast, esc, md, buildShell };
})();
