// Prism Shared Utilities — Identity Partners
// Rules: var only at top level, no arrow functions, no innerHTML with mixed quotes

var PRISM_WORKER = ''; // Relative paths via _redirects proxy
var PRISM_VERSION = '1.0.0';

// ── Theme System ──────────────────────────────────────────────────────────────
var ThemeSystem = (function() {
  var THEMES = [
    'parchment','teal-rose','olive','faded-blue','midnight-teal',
    'midnight-rose','cloudflare','linear','notion','stripe',
    'vercel','wordpress','therapy','retreat','scholarly','dawn','dusk'
  ];
  var THEME_NAMES = [
    'Parchment & Rose','Teal & Rose Reversed','Olive & Cream','Faded Blue & Sand',
    'Midnight Teal','Midnight Rose','Cloudflare Light','Linear Light','Notion Classic',
    'Stripe Light','Vercel Light','WordPress TT4','Therapy Adjacent','Retreat & Restore',
    'Scholarly Authority','Dawn','Dusk'
  ];

  function getTimeTheme() {
    var h = new Date().getHours();
    if (h >= 5 && h < 8) return 'dawn';
    if (h >= 8 && h < 12) return 'parchment';
    if (h >= 12 && h < 17) return 'parchment';
    if (h >= 17 && h < 20) return 'dawn';
    return 'midnight-teal';
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('prism-theme', theme); } catch(e) {}
  }

  function init() {
    var saved;
    try { saved = localStorage.getItem('prism-theme'); } catch(e) {}
    apply(saved || getTimeTheme());
  }

  function getAll() { return THEMES; }
  function getNames() { return THEME_NAMES; }
  function getCurrent() {
    return document.documentElement.getAttribute('data-theme') || 'parchment';
  }

  return { init: init, apply: apply, getAll: getAll, getNames: getNames, getCurrent: getCurrent };
})();

// ── Toast ─────────────────────────────────────────────────────────────────────
var Toast = (function() {
  var container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type, duration) {
    var c = getContainer();
    var toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    c.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration || 3500);
  }

  return {
    success: function(msg) { show(msg, 'success'); },
    error: function(msg) { show(msg, 'error', 5000); },
    warning: function(msg) { show(msg, 'warning'); },
    info: function(msg) { show(msg, ''); }
  };
})();

// ── Sidebar ───────────────────────────────────────────────────────────────────
var Sidebar = (function() {
  var collapsed = false;

  function init() {
    try { collapsed = localStorage.getItem('prism-sidebar-collapsed') === 'true'; } catch(e) {}
    var sidebar = document.querySelector('.sidebar');
    var main = document.querySelector('.main-content');
    if (!sidebar) return;
    if (collapsed) {
      sidebar.classList.add('collapsed');
      if (main) main.classList.add('sidebar-collapsed');
    }
    var toggleBtn = document.querySelector('.sidebar-toggle-btn');
    if (toggleBtn) {
      toggleBtn.onclick = function() { toggle(); };
    }
    // Mark active nav item
    var path = window.location.pathname;
    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      var href = navItems[i].getAttribute('href');
      if (href && path.startsWith(href) && href !== '/') {
        navItems[i].classList.add('active');
      }
    }
  }

  function toggle() {
    collapsed = !collapsed;
    var sidebar = document.querySelector('.sidebar');
    var main = document.querySelector('.main-content');
    if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
    if (main) main.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem('prism-sidebar-collapsed', collapsed); } catch(e) {}
  }

  return { init: init, toggle: toggle };
})();

// ── World Clocks ──────────────────────────────────────────────────────────────
var WorldClocks = (function() {
  var zones = [
    {label: 'London', tz: 'Europe/London'},
    {label: 'New York', tz: 'America/New_York'},
    {label: 'LA', tz: 'America/Los_Angeles'},
    {label: 'Dubai', tz: 'Asia/Dubai'},
    {label: 'Sydney', tz: 'Australia/Sydney'},
  ];

  function format(tz) {
    return new Date().toLocaleTimeString('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit'});
  }

  function render(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < zones.length; i++) {
      var item = document.createElement('div');
      item.className = 'world-clock-item';
      var time = document.createElement('span');
      time.className = 'world-clock-time';
      time.textContent = format(zones[i].tz);
      var label = document.createElement('span');
      label.className = 'world-clock-label';
      label.textContent = zones[i].label;
      item.appendChild(time);
      item.appendChild(label);
      el.appendChild(item);
    }
  }

  function start(containerId) {
    render(containerId);
    setInterval(function() { render(containerId); }, 30000);
  }

  return { start: start };
})();

// ── Pomodoro ──────────────────────────────────────────────────────────────────
var Pomodoro = (function() {
  var duration = 25 * 60;
  var remaining = duration;
  var running = false;
  var interval = null;
  var displayId = null;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function updateDisplay() {
    var el = document.getElementById(displayId);
    if (!el) return;
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    el.textContent = pad(m) + ':' + pad(s);
  }

  function tick() {
    if (remaining <= 0) {
      clearInterval(interval);
      running = false;
      Toast.info('Pomodoro complete. Take a break.');
      remaining = duration;
      updateDisplay();
      return;
    }
    remaining--;
    updateDisplay();
  }

  function start(timeDisplayId) {
    displayId = timeDisplayId;
    if (!running) {
      running = true;
      interval = setInterval(tick, 1000);
    }
    updateDisplay();
  }

  function pause() {
    running = false;
    clearInterval(interval);
  }

  function reset() {
    pause();
    remaining = duration;
    updateDisplay();
  }

  return { start: start, pause: pause, reset: reset };
})();

// ── Markdown Renderer ─────────────────────────────────────────────────────────
var Markdown = (function() {
  function render(text) {
    if (!text) return '';
    var t = text;
    // Code blocks
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, function(m, lang, code) {
      var pre = document.createElement('pre');
      var codeEl = document.createElement('code');
      codeEl.textContent = code.trim();
      pre.appendChild(codeEl);
      return pre.outerHTML;
    });
    // Inline code
    t = t.replace(/`([^`]+)`/g, function(m, code) {
      var el = document.createElement('code');
      el.textContent = code;
      return el.outerHTML;
    });
    // Headers
    t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    t = t.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold / italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Blockquote
    t = t.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // HR
    t = t.replace(/^---$/gm, '<hr>');
    // Unordered lists
    t = t.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
    t = t.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    // Ordered lists
    t = t.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Paragraphs
    t = t.replace(/\n\n/g, '</p><p>');
    t = '<p>' + t + '</p>';
    // Clean up empty paragraphs
    t = t.replace(/<p>\s*<\/p>/g, '');
    t = t.replace(/<p>(<h[1-6]>)/g, '$1');
    t = t.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
    t = t.replace(/<p>(<ul>)/g, '$1');
    t = t.replace(/(<\/ul>)<\/p>/g, '$1');
    t = t.replace(/<p>(<blockquote>)/g, '$1');
    t = t.replace(/(<\/blockquote>)<\/p>/g, '$1');
    t = t.replace(/<p>(<hr>)<\/p>/g, '$1');
    t = t.replace(/<p>(<pre>)/g, '$1');
    t = t.replace(/(<\/pre>)<\/p>/g, '$1');
    return t;
  }

  function renderInto(text, element) {
    element.className = (element.className || '') + ' md-content';
    element.innerHTML = render(text);
  }

  return { render: render, renderInto: renderInto };
})();

// ── API Client ────────────────────────────────────────────────────────────────
var PrismAPI = (function() {
  function post(path, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', PRISM_WORKER + path, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        try {
          var result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            callback(null, result);
          } else {
            callback(result.error || 'Request failed', null);
          }
        } catch(e) {
          callback('Invalid response', null);
        }
      }
    };
    xhr.onerror = function() { callback('Network error', null); };
    xhr.send(JSON.stringify(data));
  }

  function get(path, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', PRISM_WORKER + path, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        try {
          var result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            callback(null, result);
          } else {
            callback(result.error || 'Request failed', null);
          }
        } catch(e) {
          callback('Invalid response', null);
        }
      }
    };
    xhr.onerror = function() { callback('Network error', null); };
    xhr.send();
  }

  function chat(messages, profile, threadId, callback) {
    post('/api/chat', {messages: messages, profile: profile || 'balanced', threadId: threadId}, callback);
  }

  function getThreads(callback) { get('/api/threads', callback); }
  function getThread(id, callback) { get('/api/threads/' + id, callback); }
  function getMemory(callback) { get('/api/memory', callback); }
  function saveMemory(content, tags, callback) { post('/api/memory', {content: content, tags: tags}, callback); }
  function search(query, sources, callback) { post('/api/search', {query: query, sources: sources}, callback); }
  function atomise(text, profile, callback) { post('/api/atomise', {text: text, profile: profile}, callback); }
  function generateImage(prompt, model, callback) { post('/api/image', {prompt: prompt, model: model}, callback); }
  function devteam(agent, message, callback) { post('/api/devteam', {agent: agent, message: message}, callback); }

  return { post: post, get: get, chat: chat, getThreads: getThreads, getThread: getThread,
           getMemory: getMemory, saveMemory: saveMemory, search: search, atomise: atomise,
           generateImage: generateImage, devteam: devteam };
})();

// ── On-screen Keyboard Builder ────────────────────────────────────────────────
// CRITICAL: All OSK buttons use type="button" and mousedown+preventDefault
// to prevent focus loss from the target textarea and prevent native keyboard popup.
var OSK = (function() {
  var ROWS = [
    ['Esc','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'],
    ['`','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
    ['Tab','q','w','e','r','t','y','u','i','o','p','[',']','\\'],
    ['Caps','a','s','d','f','g','h','j','k','l',';',"'",'↵'],
    ['Shift','z','x','c','v','b','n','m',',','.','/',  'Shift'],
    ['Ctrl','Win','Alt','Space','Alt','Ctrl','←','↑','↓','→','Send']
  ];

  var currentTarget = null;
  var shiftOn = false;
  var capsOn = false;
  var ctrlOn = false;
  var altOn = false;

  function setTarget(el) { currentTarget = el; }

  function insertAtCursor(el, text) {
    if (!el) return;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var val = el.value;
    el.value = val.substring(0, start) + text + val.substring(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    // Trigger input event so word count etc update
    var ev = new Event('input', {bubbles: true});
    el.dispatchEvent(ev);
  }

  function handleKey(key, btn) {
    var target = currentTarget;
    if (!target) {
      // Try to find any focused textarea or input
      target = document.activeElement;
      if (!target || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT')) {
        // Fall back to first visible textarea
        var areas = document.querySelectorAll('textarea:not([style*="display:none"]), input[type="text"]:not([style*="display:none"])');
        if (areas.length) target = areas[0];
      }
    }
    if (!target) return;

    if (key === '⌫') {
      var s = target.selectionStart;
      var e = target.selectionEnd;
      if (s !== e) {
        target.value = target.value.substring(0, s) + target.value.substring(e);
        target.selectionStart = target.selectionEnd = s;
      } else if (s > 0) {
        target.value = target.value.substring(0, s-1) + target.value.substring(s);
        target.selectionStart = target.selectionEnd = s-1;
      }
      var ev = new Event('input', {bubbles:true}); target.dispatchEvent(ev);
    } else if (key === '↵') {
      insertAtCursor(target, '\n');
    } else if (key === 'Send') {
      var sendFn = window.prismSendMessage || window.doSend || window.sendDevTeamMessage;
      if (typeof sendFn === 'function') sendFn();
      return;
    } else if (key === 'Space') {
      insertAtCursor(target, ' ');
    } else if (key === 'Shift') {
      shiftOn = !shiftOn; updateShift(); return;
    } else if (key === 'Caps') {
      capsOn = !capsOn; updateCaps(); return;
    } else if (key === 'Ctrl') {
      ctrlOn = !ctrlOn; updateMod('ctrl', ctrlOn); return;
    } else if (key === 'Alt') {
      altOn = !altOn; updateMod('alt', altOn); return;
    } else if (key === 'Win') {
      Toast.info('Windows key'); return;
    } else if (key === 'Tab') {
      insertAtCursor(target, '\t');
    } else if (key === 'Esc') {
      target.blur(); return;
    } else if (key === 'Caps' || key === 'F1' || key === 'F2' || key === 'F3' || key === 'F4' || key === 'F5' || key === 'F6' || key === 'F7' || key === 'F8' || key === 'F9' || key === 'F10' || key === 'F11' || key === 'F12') {
      return; // function keys — no-op in textarea context
    } else if (key === '←') {
      var pos = target.selectionStart;
      if (pos > 0) { target.selectionStart = target.selectionEnd = pos - 1; }
      return;
    } else if (key === '→') {
      var pos = target.selectionStart;
      target.selectionStart = target.selectionEnd = pos + 1;
      return;
    } else if (key === '↑' || key === '↓') {
      return; // line navigation — browser handles
    } else if (ctrlOn) {
      // Ctrl combinations
      if (key === 'a') { target.select(); }
      else if (key === 'c') { if (navigator.clipboard) navigator.clipboard.writeText(target.value.substring(target.selectionStart, target.selectionEnd)); }
      else if (key === 'v') { navigator.clipboard && navigator.clipboard.readText().then(function(t){insertAtCursor(target,t);}); }
      else if (key === 'x') {
        var s=target.selectionStart,e=target.selectionEnd;
        if(navigator.clipboard) navigator.clipboard.writeText(target.value.substring(s,e));
        target.value=target.value.substring(0,s)+target.value.substring(e);
        target.selectionStart=target.selectionEnd=s;
      }
      else if (key === 'z') { /* undo — browser handles */ }
      ctrlOn = false; updateMod('ctrl', false);
    } else {
      var ch = (shiftOn || capsOn) ? key.toUpperCase() : key;
      insertAtCursor(target, ch);
      if (shiftOn) { shiftOn = false; updateShift(); }
    }
    // Keep focus on target without triggering native keyboard
    target.focus({preventScroll: true});
  }

  function updateShift() {
    var btns = document.querySelectorAll('.osk-key');
    for (var i=0;i<btns.length;i++) {
      if (btns[i].textContent === 'Shift') btns[i].style.background = shiftOn ? 'var(--accent)' : '';
      if (btns[i].style.background === 'var(--accent)' && btns[i].textContent !== 'Shift' && btns[i].textContent !== 'Send') btns[i].style.background = '';
    }
  }
  function updateCaps() {
    var btns = document.querySelectorAll('.osk-key');
    for (var i=0;i<btns.length;i++) {
      if (btns[i].textContent === 'Caps') btns[i].style.background = capsOn ? 'var(--accent)' : '';
    }
  }
  function updateMod(mod, on) {
    var btns = document.querySelectorAll('.osk-key');
    for (var i=0;i<btns.length;i++) {
      if (btns[i].textContent === mod.charAt(0).toUpperCase()+mod.slice(1) || btns[i].textContent.toLowerCase() === mod) {
        btns[i].style.background = on ? 'var(--warning)' : '';
        btns[i].style.color = on ? '#fff' : '';
      }
    }
  }

  function build(containerId, targetId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    container.className = 'osk';

    // Track focus on the target
    if (targetId) {
      var targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.addEventListener('focus', function() { currentTarget = targetEl; });
        currentTarget = targetEl;
      }
    }

    for (var r = 0; r < ROWS.length; r++) {
      var row = document.createElement('div');
      row.className = 'osk-row';
      var keys = ROWS[r];
      for (var k = 0; k < keys.length; k++) {
        (function(key) {
          var btn = document.createElement('button');
          btn.type = 'button'; // CRITICAL: prevents form submission
          btn.className = 'osk-key';
          btn.textContent = key === 'Space' ? 'Space' : key;

          if (key === 'Space') btn.className += ' space';
          else if (key === 'Send') btn.className += ' send';
          else if (key === '⌫' || key === '↵' || key === 'Shift' || key === 'Caps' || key === 'Tab') btn.className += ' wide';
          else if (key === 'Ctrl' || key === 'Alt' || key === 'Win') btn.className += ' wider';
          else if (key === 'Esc' || key === 'F1' || key === 'F2' || key === 'F3' || key === 'F4' || key === 'F5' || key === 'F6' || key === 'F7' || key === 'F8' || key === 'F9' || key === 'F10' || key === 'F11' || key === 'F12') btn.className += ' fn-key';

          var keyTitles = {'Send':'Send message','⌫':'Backspace','↵':'Enter / New line','Space':'Space bar','Shift':'Shift (toggle)','Caps':'Caps Lock (toggle)','Ctrl':'Ctrl (modifier)','Alt':'Alt (modifier)','Win':'Windows key','Tab':'Tab','Esc':'Escape','←':'Left arrow','→':'Right arrow','↑':'Up arrow','↓':'Down arrow'};
          btn.title = keyTitles[key] || ('Type: ' + key);

          // CRITICAL: use mousedown + preventDefault to prevent focus loss
          // and prevent native keyboard from appearing
          btn.addEventListener('mousedown', function(e) {
            e.preventDefault(); // Prevents blur on textarea AND prevents native keyboard
            e.stopPropagation();
          });

          // Use mouseup for the actual action (after mousedown prevented default)
          btn.addEventListener('mouseup', function(e) {
            e.preventDefault();
            handleKey(key, btn);
          });

          // Touch support — same pattern
          btn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            e.stopPropagation();
          }, {passive: false});

          btn.addEventListener('touchend', function(e) {
            e.preventDefault();
            handleKey(key, btn);
          }, {passive: false});

          row.appendChild(btn);
        })(keys[k]);
      }
      container.appendChild(row);
    }
  }

  // Build a floating OSK that attaches to any focused textarea/input
  function buildGlobal() {
    var existing = document.getElementById('prism-global-osk');
    if (existing) return;
    var osk = document.createElement('div');
    osk.id = 'prism-global-osk';
    osk.className = 'osk';
    osk.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9000;background:var(--bg-surface);border-top:1px solid var(--border);padding:8px;display:none;';
    document.body.appendChild(osk);
    build('prism-global-osk', null);
    // Show/hide based on focus
    document.addEventListener('focusin', function(e) {
      var el = e.target;
      if ((el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) && !el.closest('.osk')) {
        currentTarget = el;
        // Don't show global OSK on desktop — only show the inline one
      }
    });
  }

  return { build: build, buildGlobal: buildGlobal, setTarget: setTarget };
})();

// ── Sidebar HTML Builder ──────────────────────────────────────────────────────
function buildSidebar(activePage) {
  // Nav structure: flat items and grouped dropdowns
  var navStructure = [
    {type:'item', label:'Workspaces', icon:'🗂', href:'/workspaces/'},
    {type:'item', label:'Home', icon:'⌂', href:'/home/'},
    {type:'item', label:'Chat', icon:'💬', href:'/chat/'},
    {type:'item', label:'Research', icon:'🔍', href:'/research/'},
    {type:'item', label:'Drafting Desk', icon:'✍', href:'/drafting/'},
    {type:'section', label:'Create'},
    {type:'group', label:'Creator Studio', icon:'🎨', children:[
      {label:'Canvas', href:'/creator/canvas/'},
      {label:'Assets', href:'/creator/assets/'},
      {label:'Podcasts', href:'/creator/podcasts/'},
      {label:'Worksheets', href:'/creator/worksheets/'},
      {label:'Social Series', href:'/creator/social-series/'},
      {label:'Brand Kit', href:'/creator/brand-kit/'},
    ]},
    {type:'item', label:'Atomise', icon:'⚡', href:'/atomise/'},
    {type:'item', label:'Social Calendar', icon:'📅', href:'/social-queue/'},
    {type:'section', label:'Business'},
    {type:'item', label:'CRM', icon:'👥', href:'/crm/'},
    {type:'item', label:'Monetisation', icon:'💷', href:'/monetisation/'},
    {type:'item', label:'Platform Manager', icon:'🔗', href:'/platform-manager/'},
    {type:'group', label:'Comms Centre', icon:'📧', children:[
      {label:'Email', href:'/comms/email/'},
      {label:'Calendar', href:'/comms/zoho-calendar/'},
    ]},
    {type:'section', label:'Intelligence'},
    {type:'group', label:'Agenti City', icon:'🤖', children:[
      {label:'Agent Builder', href:'/agenti/agent-builder/'},
      {label:'Persona Maker', href:'/agenti/persona-maker/'},
      {label:'Round Table', href:'/agenti/round-table/'},
      {label:'Workflow Wizard', href:'/agenti/workflow-wizard/'},
    ]},
    {type:'item', label:'Orchestrator', icon:'⚙', href:'/orchestrator/'},
    {type:'section', label:'System'},
    {type:'item', label:'My Profile', icon:'👤', href:'/profile/'},
    {type:'item', label:'Memory', icon:'🧠', href:'/memory/'},
    {type:'item', label:'Whiteboard', icon:'🖊', href:'/whiteboard/'},
    {type:'item', label:'Handwriting', icon:'✒', href:'/handwriting/'},
    {type:'item', label:'Settings', icon:'⚙', href:'/settings/'},
    {type:'item', label:'Dev Team', icon:'🛠', href:'/dev-team/'},
    {type:'item', label:'Sitemap', icon:'🗺', href:'/sitemap/'},
  ];


  var sidebar = document.createElement('nav');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';

  // Logo
  var logo = document.createElement('div');
  logo.className = 'sidebar-logo';
  var logoMark = document.createElement('div');
  logoMark.className = 'sidebar-logo-mark';
  logoMark.innerHTML = '<svg viewBox="0 0 28 28" fill="none"><path d="M14 4 L24 14 L14 24 L4 14 Z" fill="#0f3b3a" opacity="0.8"/><path d="M14 8 L20 14 L14 20 L8 14 Z" fill="#5c2d3f" opacity="0.8"/></svg>';
  var logoText = document.createElement('span');
  logoText.className = 'sidebar-logo-text';
  logoText.textContent = 'Prism';
  logo.appendChild(logoMark);
  logo.appendChild(logoText);
  sidebar.appendChild(logo);

  // Nav
  var navEl = document.createElement('div');
  navEl.className = 'sidebar-nav';
  var path = window.location.pathname;

  navStructure.forEach(function(item) {
    if (item.type === 'section') {
      var sec = document.createElement('div');
      sec.className = 'sidebar-section';
      sec.textContent = item.label;
      navEl.appendChild(sec);
      return;
    }

    if (item.type === 'group') {
      var group = document.createElement('div');
      group.className = 'nav-group';
      // Check if any child is active
      var anyActive = item.children && item.children.some(function(c){return path.startsWith(c.href);});
      if (anyActive) group.classList.add('open');

      var header = document.createElement('div');
      header.className = 'nav-group-header' + (anyActive ? ' active' : '');
      var hIcon = document.createElement('span');
      hIcon.className = 'nav-item-icon';
      hIcon.textContent = item.icon || '';
      var hLabel = document.createElement('span');
      hLabel.className = 'nav-item-label';
      hLabel.textContent = item.label;
      var arrow = document.createElement('span');
      arrow.className = 'nav-group-arrow';
      arrow.textContent = '▶';
      header.appendChild(hIcon);
      header.appendChild(hLabel);
      header.appendChild(arrow);
      header.onclick = function() { group.classList.toggle('open'); };

      var children = document.createElement('div');
      children.className = 'nav-group-children';
      (item.children || []).forEach(function(child) {
        var a = document.createElement('a');
        a.className = 'nav-item' + (path.startsWith(child.href) ? ' active' : '');
        a.href = child.href;
        a.title = child.label;
        var lbl = document.createElement('span');
        lbl.className = 'nav-item-label';
        lbl.textContent = child.label;
        a.appendChild(lbl);
        children.appendChild(a);
      });

      group.appendChild(header);
      group.appendChild(children);
      navEl.appendChild(group);
      return;
    }

    // Regular item
    var a = document.createElement('a');
    a.className = 'nav-item' + (activePage && item.href === activePage ? ' active' : (path === item.href ? ' active' : ''));
    a.href = item.href;
    a.title = item.label;
    if (item.icon) {
      var icon = document.createElement('span');
      icon.className = 'nav-item-icon';
      icon.textContent = item.icon;
      a.appendChild(icon);
    }
    var lbl = document.createElement('span');
    lbl.className = 'nav-item-label';
    lbl.textContent = item.label;
    a.appendChild(lbl);
    navEl.appendChild(a);
  });

  sidebar.appendChild(navEl);

  // Toggle
  var toggleDiv = document.createElement('div');
  toggleDiv.className = 'sidebar-toggle';
  var toggleBtn = document.createElement('button');
  toggleBtn.className = 'sidebar-toggle-btn';
  toggleBtn.textContent = '◀';
  toggleBtn.title = 'Collapse sidebar';
  toggleBtn.onclick = function() { Sidebar.toggle(); };
  toggleDiv.appendChild(toggleBtn);
  sidebar.appendChild(toggleDiv);

  return sidebar;
}


// ── Guide / Wizard System ─────────────────────────────────────────────────────
var Guide = (function() {
  var currentGuide = null;
  var currentStep = 0;
  var overlay = null;
  var highlight = null;

  function show(steps, title) {
    currentGuide = steps;
    currentStep = 0;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'guide-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) hide(); };
      document.body.appendChild(overlay);
    }
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.className = 'guide-highlight';
      document.body.appendChild(highlight);
    }
    overlay.style.display = 'flex';
    renderStep();
  }

  function renderStep() {
    if (!currentGuide || currentStep >= currentGuide.length) { hide(); return; }
    var step = currentGuide[currentStep];
    overlay.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'guide-card';

    // Step dots
    var dots = document.createElement('div');
    dots.className = 'guide-step-indicator';
    for (var i = 0; i < currentGuide.length; i++) {
      var dot = document.createElement('div');
      dot.className = 'guide-step-dot' + (i === currentStep ? ' active' : i < currentStep ? ' done' : '');
      dots.appendChild(dot);
    }

    var titleEl = document.createElement('div');
    titleEl.className = 'guide-title';
    titleEl.textContent = step.title || ('Step ' + (currentStep + 1));

    var body = document.createElement('div');
    body.className = 'guide-body';
    body.innerHTML = step.body || '';

    var actions = document.createElement('div');
    actions.className = 'guide-actions';

    if (currentStep > 0) {
      var prevBtn = document.createElement('button');
      prevBtn.className = 'btn btn-secondary btn-sm';
      prevBtn.textContent = '← Back';
      prevBtn.onclick = function() { currentStep--; renderStep(); };
      actions.appendChild(prevBtn);
    }

    var skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-ghost btn-sm';
    skipBtn.textContent = 'Skip guide';
    skipBtn.onclick = hide;
    actions.appendChild(skipBtn);

    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary btn-sm';
    nextBtn.textContent = currentStep === currentGuide.length - 1 ? 'Done ✓' : 'Next →';
    nextBtn.onclick = function() {
      if (step.action) step.action();
      currentStep++;
      renderStep();
    };
    actions.appendChild(nextBtn);

    card.appendChild(dots);
    card.appendChild(titleEl);
    card.appendChild(body);
    card.appendChild(actions);
    overlay.appendChild(card);

    // Highlight target element
    if (step.target) {
      var el = document.querySelector(step.target);
      if (el && highlight) {
        var rect = el.getBoundingClientRect();
        highlight.style.cssText = 'position:fixed;border:3px solid #0f3b3a;border-radius:8px;box-shadow:0 0 0 4000px rgba(0,0,0,0.4);z-index:7999;pointer-events:none;top:'+(rect.top-4)+'px;left:'+(rect.left-4)+'px;width:'+(rect.width+8)+'px;height:'+(rect.height+8)+'px;';
        highlight.style.display = 'block';
      } else if (highlight) {
        highlight.style.display = 'none';
      }
    } else if (highlight) {
      highlight.style.display = 'none';
    }
  }

  function hide() {
    if (overlay) overlay.style.display = 'none';
    if (highlight) highlight.style.display = 'none';
    currentGuide = null;
    currentStep = 0;
  }

  // Pre-built guides
  var GUIDES = {
    chat: [
      {title:'Welcome to Chat', body:'Chat is your primary interface with Prism. Every message goes through the Orchestrator, which routes to the best available AI model automatically.', target:'.chat-messages'},
      {title:'The On-Screen Keyboard', body:'The keyboard below the input is always visible. It\'s designed for your Surface Slim Pen 2 — write directly into any key to insert text. Shift, Ctrl, Alt, and Caps Lock all work.', target:'#osk-container'},
      {title:'Routing Profiles', body:'Choose how Prism routes your messages. <strong>Balanced</strong> uses free providers first. <strong>Full Frontier</strong> uses the best available model regardless of cost.', target:'#profile-selector'},
      {title:'Personas', body:'Switch between personas to change how Prism responds. The Sardonic Butler is particularly useful when you need blunt feedback.', target:'.persona-selector'},
      {title:'Action Chips', body:'Use these chips to quickly route your message to Research, Atomise, or Drafting — or to generate an image inline.', target:'.chat-chips'},
    ],
    research: [
      {title:'Research Hub', body:'Search across 80+ sources simultaneously — web search, academic databases, preprint servers, government data, and more.'},
      {title:'Select Your Sources', body:'Toggle individual sources on and off. Use <strong>Recommended</strong> for a balanced set, or <strong>Select All</strong> for maximum coverage.', target:'#source-chips'},
      {title:'Synthesise', body:'After searching, click <strong>Synthesise</strong> to have Nemotron Ultra 253B produce a single authoritative summary of all results.', target:'.topbar-actions'},
    ],
    workspaces: [
      {title:'Workspaces', body:'Each workspace is a visual super-folder for a project or client. Everything related to that project lives here — threads, documents, images, events, tasks, and notes.'},
      {title:'Sections', body:'Each workspace has 7 sections: Folders, Threads, Images, Events, Whiteboards, To-Do, and Notes. Click any folder or thread to open it directly.'},
      {title:'Create a Workspace', body:'Click <strong>+ New Workspace</strong> to create a workspace for a new project, client, or campaign.', target:'#ws-grid'},
    ],
    atomise: [
      {title:'Atomise', body:'Paste up to 1,500 words of any text — a programme description, session note, research synthesis — and Prism generates 7 social media asset types in under 60 seconds.'},
      {title:'Approve and Queue', body:'Review each generated asset. Click <strong>Approve</strong> on the ones you want, then <strong>Queue All Approved</strong> to send them to the Social Calendar.'},
    ],
  };

  function startGuide(name) {
    var guide = GUIDES[name];
    if (guide) show(guide);
    else Toast.warning('No guide available for: ' + name);
  }

  return { show: show, hide: hide, startGuide: startGuide };
})();

// ── Help button builder ───────────────────────────────────────────────────────
function makeHelpBtn(guideName, tooltip) {
  var btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.textContent = '?';
  btn.title = tooltip || 'Show guide';
  btn.setAttribute('data-tooltip', tooltip || 'Click for a guided tour');
  btn.onclick = function() { Guide.startGuide(guideName); };
  return btn;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  ThemeSystem.init();
  Sidebar.init();
});