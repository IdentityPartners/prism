// v1793059912

// ── Immediate sidebar offset CSS (prevents flash of unstyled content) ─────────
(function() {
  var style = document.createElement('style');
  style.id = 'sidebar-offset-css';
  style.textContent = '#main-content { margin-left: 220px !important; width: calc(100vw - 220px) !important; max-width: calc(100vw - 220px) !important; box-sizing: border-box !important; }';
  // Insert as first child of head
  var head = document.head || document.getElementsByTagName('head')[0];
  if (head && head.firstChild) {
    head.insertBefore(style, head.firstChild);
  } else if (head) {
    head.appendChild(style);
  }
})();


// ── Load Iconify for colourful icons ─────────────────────────────────────────
(function() {
  if (!document.getElementById('iconify-script')) {
    var s = document.createElement('script');
    s.id = 'iconify-script';
    s.src = 'https://cdn.jsdelivr.net/npm/@iconify/iconify@3/dist/iconify.min.js';
    s.async = true;
    document.head.appendChild(s);
  }
})();

// ── Load Playfair Display for serif themes ───────────────────────────────────
(function() {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap';
  document.head.appendChild(link);
})();

// ── Argentica theme injection ─────────────────────────────────────────────────
(function() {
  var style = document.createElement('style');
  style.textContent = [
    // Global font size increase — base 15px (was 13-14px)
    'html,body{font-size:20px!important;line-height:1.65!important;}',
    '.btn{font-size:15px;}',
    'input,select,textarea{font-size:16px;}',
    ':root,[data-theme="parchment"],[data-theme="argentica"]{',
    '--bg:#f0f4f8;--bg-elevated:#ffffff;--bg-sunken:#e4eaf0;--bg-surface:#f8fafc;',
    '--fg:#1a2332;--fg-muted:#5a6a7e;--border:#c8d4e0;',
    '--accent:#2d6a9f;--accent-hover:#1e5080;--rose:#6b8fa8;',
    '--radius:8px;--topbar-h:48px;}',
    '[data-theme="midnight-teal"],[data-theme="midnight"],[data-theme="argentica-dark"]{',
    '--bg:#0d1520;--bg-elevated:#162030;--bg-sunken:#0a1018;--bg-surface:#1a2840;',
    '--fg:#e8f0f8;--fg-muted:#7a9ab8;--border:#2a3d52;',
    '--accent:#4a9fd4;--accent-hover:#6ab8e8;--rose:#7ab0cc;',
    '--radius:8px;--topbar-h:48px;}'
  ,
    '\n/* Auto-grow textarea */\n.chat-textarea, .devteam-textarea, #ocr-result {\n  field-sizing: content;\n  min-height: 80px;\n  max-height: 400px;\n  resize: vertical;\n}\n/* Larger writing box */\n#ocr-result {\n  min-height: 200px;\n  font-size: 14px;\n  line-height: 1.6;\n}\n'].join('');
  document.head.appendChild(style);
})();

// Argentica Shared Utilities v1788475099_1788475082 — Identity Partners
// Rules: var only at top level, no arrow functions, no innerHTML with mixed quotes

var PRISM_WORKER = 'https://prism-api.identitypartners.workers.dev';
var PRISM_VERSION = '1.0.0';

// ── Theme System ──────────────────────────────────────────────────────────────
var ThemeSystem = (function() {
  var THEMES = [
    {id:'argentica',       label:'Argentica',        group:'Light'},
    {id:'parchment',       label:'Parchment',         group:'Light'},
    {id:'teal-rose',       label:'Teal & Rose',       group:'Light'},
    {id:'olive',           label:'Olive',             group:'Light'},
    {id:'faded-blue',      label:'Faded Blue',        group:'Light'},
    {id:'scholarly',       label:'Scholarly',         group:'Light'},
    {id:'therapy',         label:'Therapy',           group:'Light'},
    {id:'retreat',         label:'Retreat',           group:'Light'},
    {id:'dawn',            label:'Dawn',              group:'Light'},
    {id:'serif',           label:'Argentica Serif',   group:'Editorial'},
    {id:'slate',           label:'Slate',             group:'Editorial'},
    {id:'midnight-teal',   label:'Midnight Teal',     group:'Dark'},
    {id:'ink',             label:'Argentica Ink',     group:'Dark'},
    {id:'midnight-rose',   label:'Midnight Rose',     group:'Dark'},
    {id:'dusk',            label:'Dusk',              group:'Dark'},
    {id:'cloudflare',      label:'Cloudflare',        group:'Brand'},
    {id:'linear',          label:'Linear',            group:'Brand'},
    {id:'notion',          label:'Notion',            group:'Brand'},
    {id:'stripe',          label:'Stripe',            group:'Brand'},
    {id:'vercel',          label:'Vercel',            group:'Brand'},
    {id:'wordpress',       label:'WordPress',         group:'Brand'},
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

  return {
    init: init,
    apply: apply,
    getAll: getAll,
    getNames: getNames,
    getCurrent: getCurrent,
    togglePicker: function(anchorEl) {
      var panel = document.getElementById('theme-picker-panel');
      if (!panel) {
        // Build picker from the IIFE's buildThemePicker if available
        var evt = new CustomEvent('argentica:build-theme-picker');
        document.dispatchEvent(evt);
        panel = document.getElementById('theme-picker-panel');
      }
      if (!panel) return;
      var isHidden = panel.style.display === 'none' || panel.style.display === '';
      if (anchorEl) {
        var r = anchorEl.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = (r.bottom + 4) + 'px';
        panel.style.right = '8px';
        panel.style.left = 'auto';
        panel.style.bottom = 'auto';
        panel.style.zIndex = '99999';
      }
      panel.style.display = isHidden ? 'block' : 'none';
    }
  };
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
var ArgenticaAPI = (function() {
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

  // Shift character map — what each key produces when Shift is held
  var SHIFT_MAP = {
    '`':'~', '1':'!', '2':'"', '3':'£', '4':'$', '5':'%',
    '6':'^', '7':'&', '8':'*', '9':'(', '0':')', '-':'_', '=':'+',
    '[':'{', ']':'}', '\\':'|', ';':':', "'":'"', ',':'<', '.':'>', '/':'?',
    '2':'@', '3':'#'
  };
  // British English shift layer overrides
  var SHIFT_MAP_UK = {
    '`':'¬', '1':'!', '2':'"', '3':'£', '4':'$', '5':'%',
    '6':'^', '7':'&', '8':'*', '9':'(', '0':')', '-':'_', '=':'+',
    '[':'{', ']':'}', '\\':'|', ';':':', "'":"@", '#':'~', ',':'<', '.':'>', '/':'?'
  };

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
      var ch;
      if (shiftOn) {
        // Use British shift map first, then uppercase
        ch = SHIFT_MAP_UK[key] || SHIFT_MAP[key] || key.toUpperCase();
      } else if (capsOn) {
        ch = key.toUpperCase();
      } else {
        ch = key;
      }
      insertAtCursor(target, ch);
      if (shiftOn) { shiftOn = false; updateShift(); }
    }
    // Keep focus on target without triggering native keyboard
    target.focus({preventScroll: true});
  }

  function updateShift() {
    var btns = document.querySelectorAll('.osk-key');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var base = btn.getAttribute('data-base') || btn.textContent;
      if (!btn.getAttribute('data-base') && base.length === 1) {
        btn.setAttribute('data-base', base);
      }
      if (btn.textContent === 'Shift' || btn.getAttribute('data-base') === 'Shift') {
        btn.style.background = shiftOn ? 'var(--accent)' : '';
        btn.style.color = shiftOn ? '#fff' : '';
        continue;
      }
      if (btn.getAttribute('data-base') && btn.getAttribute('data-base').length === 1) {
        var baseKey = btn.getAttribute('data-base');
        if (shiftOn) {
          btn.textContent = SHIFT_MAP_UK[baseKey] || SHIFT_MAP[baseKey] || baseKey.toUpperCase();
        } else {
          btn.textContent = baseKey;
        }
      }
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

    // Add collapse toggle button
    var collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'osk-collapse-btn';
    collapseBtn.textContent = '⌨ Hide keyboard';
    collapseBtn.style.cssText = 'width:100%;padding:3px;font-size:10px;background:var(--bg-sunken,#e4eaf0);border:none;border-bottom:1px solid var(--border,#c8d4e0);cursor:pointer;color:var(--fg-muted,#5a6a7e);text-align:center;';
    var oskVisible = true;
    collapseBtn.onclick = function() {
      oskVisible = !oskVisible;
      var rows = container.querySelectorAll('.osk-row');
      rows.forEach(function(r) { r.style.display = oskVisible ? '' : 'none'; });
      collapseBtn.textContent = oskVisible ? '⌨ Hide keyboard' : '⌨ Show keyboard';
      // Not persisting collapse state — OSK always shows on fresh load
    };
    // OSK always visible by default — collapse is per-session only
    container.appendChild(collapseBtn);

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
          // Store base key for shift label swapping
          if (key.length === 1) btn.setAttribute('data-base', key);

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
    {type:'item', label:'Study Hub', icon:'fluent-emoji:books', href:'/study-hub/'},
    {type:'item', label:'Document Manager', icon:'fluent-emoji:open-book', href:'/doc-viewer/'},
    {type:'item', label:'Chat', icon:'fluent-emoji:speech-balloon', href:'/chat/'},
    {type:'item', label:'Research', icon:'fluent-emoji:magnifying-glass-tilted-left', href:'/research/'},
    {type:'item', label:'Drafting', icon:'fluent-emoji:pencil', href:'/drafting/'},
    {type:'section', label:'Create'},
    {type:'group', label:'Create', icon:'fluent-emoji:artist-palette', children:[
      {label:'Canvas', icon:'fluent-emoji:framed-picture', href:'/creator/canvas/'},
      {label:'Templates', icon:'fluent-emoji:card-index-dividers', href:'/creator/canvas/templates/'},
      {label:'Assets', icon:'fluent-emoji:file-folder', href:'/creator/assets/'},
      {label:'Generate', icon:'fluent-emoji:magic-wand', href:'/creator/assets/?tab=generate'},
      {label:'Carousel', icon:'fluent-emoji:film-frames', href:'/creator/carousel/'},
      {label:'Refract', icon:'fluent-emoji:gem-stone', href:'/atomise/'},
      {label:'Media Manager', icon:'fluent-emoji:calendar', href:'/social-queue/'},
      {label:'Podcasts', icon:'fluent-emoji:microphone', href:'/creator/podcasts/'},
      {label:'Music', icon:'fluent-emoji:musical-notes', href:'/creator/music/'},
    ]},
    {type:'section', label:'Comms'},
    {type:'group', label:'Comms', icon:'fluent-emoji:envelope', children:[
      {label:'Inbox', icon:'fluent-emoji:inbox-tray', href:'/inbox/'},
      {label:'Email', icon:'fluent-emoji:e-mail', href:'/comms/email/'},
      {label:'Google', icon:'fluent-emoji:envelope-with-arrow', href:'/comms/google/'},
      {label:'Calendar', icon:'fluent-emoji:spiral-calendar', href:'/comms/google/'},
      {label:'Twenty CRM', icon:'fluent-emoji:address-book', href:'/comms/twenty/'},
      {label:'Messages', icon:'fluent-emoji:speech-balloon', href:'/messages/'},
    ]},
    {type:'section', label:'Business'},
    {type:'group', label:'Business', icon:'fluent-emoji:briefcase', children:[
      {label:'CRM', icon:'fluent-emoji:busts-in-silhouette', href:'/crm/'},
      {label:'Monetisation', icon:'fluent-emoji:money-bag', href:'/monetisation/'},
      {label:'Platform Manager', icon:'fluent-emoji:link', href:'/platform-manager/'},
    ]},
    {type:'section', label:'Intelligence'},
    {type:'group', label:'Intelligence', icon:'fluent-emoji:brain', children:[
      {label:'Agents', icon:'fluent-emoji:robot', href:'/agenti/agent-builder/'},
      {label:'Debate Society', icon:'fluent-emoji:speaking-head', href:'/debate/'},
      {label:'Personas', icon:'fluent-emoji:performing-arts', href:'/personas/'},
      {label:'Workflows', icon:'fluent-emoji:gear', href:'/agenti/workflow-wizard/'},
      {label:'Orchestrator', icon:'fluent-emoji:control-knobs', href:'/orchestrator/'},
    ]},
    {type:'section', label:'System'},
    {type:'group', label:'System', icon:'fluent-emoji:wrench', children:[
      {label:'Profile & Memory', icon:'fluent-emoji:bust-in-silhouette', href:'/profile/'},
      {label:'WriteHandy', icon:'fluent-emoji:writing-hand', href:'/writehandy/'},
      {label:'Dev Team', icon:'fluent-emoji:hammer-and-wrench', href:'/dev-team/'},
      {label:'Comms Centre', icon:'fluent-emoji:satellite-antenna', href:'/comms/'},
      {label:'Settings', icon:'fluent-emoji:gear', href:'/settings/'},
      {label:'Sitemap', icon:'fluent-emoji:world-map', href:'/sitemap/'},
    ]},
  ];


  var sidebar = document.createElement('nav');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';

  // Logo
  var logo = document.createElement('a');
  logo.className = 'sidebar-logo';
  logo.href = '/home/';
  logo.style.textDecoration = 'none';
  logo.style.cursor = 'pointer';
  var logoMark = document.createElement('div');
  logoMark.className = 'sidebar-logo-mark';
  logoMark.innerHTML = '<svg viewBox="0 0 28 28" fill="none"><path d="M14 4 L24 14 L14 24 L4 14 Z" fill="#0f3b3a" opacity="0.8"/><path d="M14 8 L20 14 L14 20 L8 14 Z" fill="#5c2d3f" opacity="0.8"/></svg>';
  var logoText = document.createElement('span');
  logoText.className = 'sidebar-logo-text';
  logoText.textContent = 'Argentica';
  logo.href = '/home/';
  logo.style.textDecoration = 'none';
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
      // Render icon: Iconify format (contains ':') or plain emoji/text
    if (item.icon && item.icon.includes(':')) {
      hIcon.innerHTML = '<span class="iconify" data-icon="' + item.icon + '" style="font-size:18px;"></span>';
    } else {
      hIcon.innerHTML = item.icon || '';
    }
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
      if (item.icon && item.icon.includes(':')) {
        icon.innerHTML = '<span class="iconify" data-icon="' + item.icon + '" style="font-size:15px;"></span>';
      } else {
        icon.innerHTML = item.icon || '';
      }
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
      {title:'Welcome to Chat', body:'Chat is your primary interface with Argentica. Every message goes through the Orchestrator, which routes to the best available AI model automatically.', target:'.chat-messages'},
      {title:'The On-Screen Keyboard', body:'The keyboard below the input is always visible. It\'s designed for your Surface Slim Pen 2 — write directly into any key to insert text. Shift, Ctrl, Alt, and Caps Lock all work.', target:'#osk-container'},
      {title:'Routing Profiles', body:'Choose how Argentica routes your messages. <strong>Balanced</strong> uses free providers first. <strong>Full Frontier</strong> uses the best available model regardless of cost.', target:'#profile-selector'},
      {title:'Personas', body:'Switch between personas to change how Argentica responds. The Sardonic Butler is particularly useful when you need blunt feedback.', target:'.persona-selector'},
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
      {title:'Atomise', body:'Paste up to 1,500 words of any text — a programme description, session note, research synthesis — and Argentica generates 7 social media asset types in under 60 seconds.'},
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


// Creative Director panel

// Creative Director: use /api/creative-director/review endpoint directly
;


// ── Theme switcher ────────────────────────────────────────────────────────────
(function() {
  var THEMES = [
    {id:'argentica',      label:'Argentica',       group:'Light'},
    {id:'parchment',      label:'Parchment',       group:'Light'},
    {id:'teal-rose',      label:'Teal & Rose',     group:'Light'},
    {id:'olive',          label:'Olive',           group:'Light'},
    {id:'faded-blue',     label:'Faded Blue',      group:'Light'},
    {id:'scholarly',      label:'Scholarly',       group:'Light'},
    {id:'therapy',        label:'Therapy',         group:'Light'},
    {id:'retreat',        label:'Retreat',         group:'Light'},
    {id:'dawn',           label:'Dawn',            group:'Light'},
    {id:'midnight-teal',  label:'Midnight Teal',   group:'Dark'},
    {id:'argentica-dark', label:'Argentica Dark',  group:'Dark'},
    {id:'midnight-rose',  label:'Midnight Rose',   group:'Dark'},
    {id:'dusk',           label:'Dusk',            group:'Dark'},
    {id:'cloudflare',     label:'Cloudflare',      group:'Brand'},
    {id:'linear',         label:'Linear',          group:'Brand'},
    {id:'notion',         label:'Notion',          group:'Brand'},
    {id:'stripe',         label:'Stripe',          group:'Brand'},
    {id:'vercel',         label:'Vercel',          group:'Brand'},
    {id:'wordpress',      label:'WordPress',       group:'Brand'},
    {id:'serif',          label:'Argentica Serif', group:'Editorial'},
    {id:'ink',            label:'Argentica Ink',   group:'Editorial'},
    {id:'slate',          label:'Slate',           group:'Editorial'},
  ];

  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem('argentica-theme', id); } catch(e) {}
  }

  // Apply saved theme immediately (no time-based forcing)
  (function() {
    var saved = 'argentica';
    try { saved = localStorage.getItem('argentica-theme') || 'argentica'; } catch(e) {}
    document.documentElement.setAttribute('data-theme', saved);
  })();

  function buildThemePicker() {
    var panel = document.createElement('div');
    panel.id = 'theme-picker-panel';
    panel.style.cssText = [
      'position:fixed;bottom:56px;left:14px;',
      'background:var(--bg-elevated);border:1px solid var(--border);',
      'border-radius:10px;padding:14px;z-index:9999;width:270px;',
      'box-shadow:0 4px 24px rgba(0,0,0,0.18);display:none;',
    ].join('');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--fg-muted);margin-bottom:10px;';
    title.textContent = 'Choose Theme';
    panel.appendChild(title);

    var groups = {};
    THEMES.forEach(function(t) {
      if (!groups[t.group]) groups[t.group] = [];
      groups[t.group].push(t);
    });

    Object.keys(groups).forEach(function(group) {
      var gl = document.createElement('div');
      gl.style.cssText = 'font-size:10px;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.4px;margin:8px 0 4px;';
      gl.textContent = group;
      panel.appendChild(gl);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
      groups[group].forEach(function(t) {
        var btn = document.createElement('button');
        btn.textContent = t.label;
        btn.dataset.themeId = t.id;
        btn.style.cssText = 'padding:4px 10px;border:1px solid var(--border);border-radius:12px;font-size:11px;cursor:pointer;background:var(--bg);color:var(--fg);font-family:inherit;transition:all 0.15s;';
        btn.onclick = function() {
          applyTheme(t.id);
          panel.querySelectorAll('button').forEach(function(b) {
            b.style.background = 'var(--bg)';
            b.style.color = 'var(--fg)';
            b.style.borderColor = 'var(--border)';
          });
          btn.style.background = 'var(--accent)';
          btn.style.color = '#fff';
          btn.style.borderColor = 'var(--accent)';
        };
        try {
          if ((localStorage.getItem('argentica-theme') || 'argentica') === t.id) {
            btn.style.background = 'var(--accent)';
            btn.style.color = '#fff';
            btn.style.borderColor = 'var(--accent)';
          }
        } catch(e) {}
        row.appendChild(btn);
      });
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    return panel;
  }

  document.addEventListener('DOMContentLoaded', function() {
    var panel = null;
    var btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.innerHTML = '&#x1F3A8; Theme';
    btn.style.cssText = [
      'display:block;width:calc(100% - 16px);margin:4px 8px;',
      'padding:7px 12px;background:var(--bg-sunken);',
      'border:1px solid var(--border);border-radius:8px;',
      'font-size:12px;cursor:pointer;color:var(--fg-muted);',
      'font-family:inherit;transition:all 0.15s;text-align:left;',
      'box-shadow:none;',
    ].join('');
    btn.onmouseenter = function() { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; };
    btn.onmouseleave = function() { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--fg)'; };
    btn.onclick = function(e) {
      e.stopPropagation();
      e.preventDefault();
      if (window.ThemeSystem && ThemeSystem.togglePicker) {
        ThemeSystem.togglePicker(btn);
        return;
      }
      var panel = document.getElementById('theme-picker-panel');
      if (!panel) {
        if (window.ThemeSystem && ThemeSystem.buildPicker) ThemeSystem.buildPicker();
        else if (typeof buildThemePicker === 'function') buildThemePicker();
        panel = document.getElementById('theme-picker-panel');
      }
      if (panel) {
        var isHidden = panel.style.display === 'none' || panel.style.display === '';
        var btnRect = btn.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = (btnRect.bottom + 4) + 'px';
        panel.style.right = '8px';
        panel.style.left = 'auto';
        panel.style.bottom = 'auto';
        panel.style.zIndex = '99999';
        panel.style.display = isHidden ? 'block' : 'none';
      }
    };
    document.body.appendChild(btn);
    document.addEventListener('click', function() {
      if (panel) panel.style.display = 'none';
    });
    // Expose buildThemePicker via custom event for ThemeSystem.togglePicker
    document.addEventListener('argentica:build-theme-picker', function() {
      if (!document.getElementById('theme-picker-panel')) buildThemePicker();
    });
  });
})();

// ── On-Screen Keyboard ────────────────────────────────────────────────────────
function buildOSK(targetId) {
  var target = document.getElementById(targetId);
  if (!target) return;

  var APOS = "\u0027"; // apostrophe — avoids quote nesting issues
  var QUOT = "\u0022"; // double-quote

  var ROWS_NORMAL = [
    ['`','1','2','3','4','5','6','7','8','9','0','-','=','DEL'],
    ['Tab','q','w','e','r','t','y','u','i','o','p','[',']','\\'],
    ['Caps','a','s','d','f','g','h','j','k','l',';',APOS,'RET'],
    ['SHF','z','x','c','v','b','n','m',',','.','/',  'SHF'],
    ['123','MIC',',',' ','.','.com','RET']
  ];
  var ROWS_SHIFT = [
    ['~','!','@','#','$','%','^','&','*','(',')','_','+','DEL'],
    ['Tab','Q','W','E','R','T','Y','U','I','O','P','{','}','|'],
    ['Caps','A','S','D','F','G','H','J','K','L',':',QUOT,'RET'],
    ['SHF','Z','X','C','V','B','N','M','<','>','?','SHF'],
    ['123','MIC',',',' ','.','.com','RET']
  ];
  var ROWS_NUM = [
    ['1','2','3','4','5','6','7','8','9','0','-','/','DEL'],
    ['@','#','\u00a3','\u20ac','_','&','-','+','(',')','/','*','RET'],
    ['.',',','?','!',APOS,QUOT,'DEL'],
    ['ABC','MIC',',',' ','.','.com','RET']
  ];

  var shifted = false;
  var numMode = false;
  var collapsed = false;

  var wrapper = document.createElement('div');
  wrapper.id = 'osk-wrapper';
  wrapper.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:8000;background:var(--bg-elevated);border-top:2px solid var(--border);padding:4px 4px 10px;user-select:none;';

  var collapseBar = document.createElement('div');
  collapseBar.style.cssText = 'text-align:center;cursor:pointer;padding:3px 0 5px;font-size:12px;color:var(--fg-muted);letter-spacing:0.3px;';
  collapseBar.textContent = '\u25bc Hide keyboard';
  collapseBar.onclick = function() {
    collapsed = !collapsed;
    keyArea.style.display = collapsed ? 'none' : 'block';
    collapseBar.textContent = collapsed ? '\u25b2 Show keyboard' : '\u25bc Hide keyboard';
  };
  wrapper.appendChild(collapseBar);

  var keyArea = document.createElement('div');
  keyArea.id = 'osk-key-area';
  wrapper.appendChild(keyArea);

  function getRows() {
    return numMode ? ROWS_NUM : (shifted ? ROWS_SHIFT : ROWS_NORMAL);
  }

  var KEY_LABELS = { DEL:'\u232b', RET:'\u21b5', SHF:'\u21e7', MIC:'\ud83c\udfa4' };
  var KEY_WIDE = { ' ':1, Tab:1, Caps:1, SHF:1, RET:1, DEL:1, ABC:1, '123':1, '.com':1 };

  function renderKeys() {
    keyArea.innerHTML = '';
    getRows().forEach(function(row) {
      var rowDiv = document.createElement('div');
      rowDiv.style.cssText = 'display:flex;justify-content:center;gap:3px;margin-bottom:3px;';
      row.forEach(function(key) {
        var btn = document.createElement('button');
        var label = KEY_LABELS[key] || key;
        btn.textContent = label;
        var wide = KEY_WIDE[key];
        var isSpace = key === ' ';
        btn.style.cssText = [
          'padding:11px ' + (isSpace ? '50px' : wide ? '12px' : '9px') + ';',
          'border:1px solid var(--border);border-radius:6px;',
          'background:' + (wide && !isSpace ? 'var(--bg-sunken)' : 'var(--bg-elevated)') + ';',
          'color:var(--fg);font-size:14px;font-family:inherit;',
          'cursor:pointer;min-width:' + (isSpace ? '100px' : wide ? '48px' : '34px') + ';',
          'flex-shrink:0;transition:background 0.1s;',
        ].join('');
        btn.onmousedown = function(e) { e.preventDefault(); handleKey(key); };
        btn.ontouchstart = function(e) { e.preventDefault(); handleKey(key); };
        rowDiv.appendChild(btn);
      });
      keyArea.appendChild(rowDiv);
    });
  }

  function insert(text) {
    var s = target.selectionStart, e2 = target.selectionEnd;
    target.setRangeText(text, s, e2, 'end');
    target.dispatchEvent(new Event('input', {bubbles:true}));
    target.focus();
    // Auto-grow
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 300) + 'px';
  }

  function handleKey(key) {
    if (key === 'DEL') {
      var s = target.selectionStart, e2 = target.selectionEnd;
      if (s !== e2) { target.setRangeText('', s, e2, 'end'); }
      else if (s > 0) { target.setRangeText('', s-1, s, 'end'); }
      target.dispatchEvent(new Event('input', {bubbles:true}));
      target.focus();
    } else if (key === 'RET') {
      insert('\n');
    } else if (key === 'SHF' || key === 'Caps') {
      shifted = !shifted; renderKeys();
    } else if (key === 'Tab') {
      insert('  ');
    } else if (key === '123') {
      numMode = true; shifted = false; renderKeys();
    } else if (key === 'ABC') {
      numMode = false; shifted = false; renderKeys();
    } else if (key === 'MIC') {
      startDictation(target);
    } else {
      insert(key);
      if (shifted && !numMode) { shifted = false; renderKeys(); }
    }
  }

  renderKeys();

  var anchor = target.closest('.chat-input-area') || target.closest('form') || document.body;
  anchor.appendChild(wrapper);

  target.addEventListener('input', function() {
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 300) + 'px';
  });

  return wrapper;
}

function startDictation(target) {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Speech recognition not supported in this browser.'); return; }
  var rec = new SR();
  rec.lang = 'en-GB';
  rec.interimResults = false;
  rec.onresult = function(e) {
    var text = e.results[0][0].transcript;
    var pos = target.selectionStart;
    target.setRangeText(text + ' ', pos, pos, 'end');
    target.dispatchEvent(new Event('input', {bubbles:true}));
  };
  rec.start();
}

// ── Global UI: theme button in top bar, chat pill, notification bell ──────────
// Appended to prism.js

var GlobalUI = (function() {
  var WORKER = 'https://prism-api.identitypartners.workers.dev';
  var chatOpen = false;
  var chatHistory = [];
  var unreadCount = 0;

  function init() {
    buildTopBar();
    buildChatPill();
    pollNotifications();
    setInterval(pollNotifications, 30000);
  }

  function buildTopBar() {
    if (document.getElementById('global-top-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'global-top-bar';
    bar.style.cssText = 'position:fixed;top:0;right:0;height:var(--topbar-h,48px);display:flex;align-items:center;gap:6px;padding:0 12px;z-index:800;pointer-events:none;';

    function makeBtn(icon, title, onclick) {
      var btn = document.createElement('button');
      btn.innerHTML = icon;
      btn.title = title;
      btn.style.cssText = 'pointer-events:all;width:32px;height:32px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:border-color 0.15s;';
      btn.onmouseenter = function() { btn.style.borderColor = 'var(--accent)'; };
      btn.onmouseleave = function() { btn.style.borderColor = 'var(--border)'; };
      btn.onclick = onclick;
      return btn;
    }

    // Theme button
    var themeBtn = makeBtn('🎨', 'Change theme', function(e) {
      e.stopPropagation();
      var panel = document.getElementById('theme-picker-panel');
      if (!panel) {
        if (typeof buildThemePicker === 'function') buildThemePicker();
        panel = document.getElementById('theme-picker-panel');
      }
      if (panel) {
        panel.style.bottom = 'auto';
        panel.style.top = '52px';
        panel.style.left = 'auto';
        panel.style.right = '14px';
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Notification bell
    var notifBtn = makeBtn('&#x1F514;', 'Inbox & notifications', function() {
      window.location.href = '/inbox/';
    });
    var badge = document.createElement('span');
    badge.id = 'top-notif-badge';
    badge.style.cssText = 'position:absolute;top:-3px;right:-3px;background:#dc2626;color:#fff;border-radius:8px;font-size:9px;font-weight:700;padding:1px 4px;display:none;';
    notifBtn.style.position = 'relative';
    notifBtn.appendChild(badge);

    bar.appendChild(themeBtn);
    bar.appendChild(notifBtn);
    document.body.appendChild(bar);
  }

  function buildChatPill() {
    if (document.getElementById('global-chat-strip')) return;

    // Bottom strip
    var strip = document.createElement('div');
    strip.id = 'global-chat-strip';
    strip.style.cssText = 'position:fixed;bottom:0;right:0;height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;z-index:900;background:var(--bg-elevated);border-top:1px solid var(--border);border-left:1px solid var(--border);border-radius:10px 0 0 0;box-shadow:0 -2px 12px rgba(0,0,0,0.08);cursor:pointer;transition:background 0.15s;';
    strip.onmouseenter = function() { strip.style.background = 'var(--bg-sunken)'; };
    strip.onmouseleave = function() { strip.style.background = 'var(--bg-elevated)'; };
    strip.onclick = toggleChat;

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:15px;';
    icon.innerHTML = '💬';

    var label = document.createElement('span');
    label.style.cssText = 'font-size:12px;font-weight:600;color:var(--fg);';
    label.textContent = 'Chat';

    var pillBadge = document.createElement('span');
    pillBadge.id = 'chat-pill-badge';
    pillBadge.style.cssText = 'background:var(--accent);color:#fff;border-radius:8px;font-size:9px;font-weight:700;padding:1px 6px;display:none;';

    var providerSpan = document.createElement('span');
    providerSpan.id = 'chat-pill-provider';
    providerSpan.style.cssText = 'font-size:10px;color:var(--fg-muted);';

    strip.appendChild(icon);
    strip.appendChild(label);
    strip.appendChild(pillBadge);
    strip.appendChild(providerSpan);
    document.body.appendChild(strip);

    // Chat panel
    var panel = document.createElement('div');
    panel.id = 'global-chat-panel';
    panel.style.cssText = 'position:fixed;bottom:38px;right:0;width:380px;height:500px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px 0 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.15);display:none;flex-direction:column;z-index:899;';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;';
    hdr.innerHTML = '<span style="font-size:14px;">&#x1F3A9;</span><span style="font-size:13px;font-weight:600;flex:1;">Gerald</span><span id="pill-status" style="font-size:10px;color:var(--fg-muted);"></span><a href="/chat/" style="font-size:11px;color:var(--accent);text-decoration:none;">Full &#x2197;</a><button onclick="GlobalUI.toggleChat()" style="background:none;border:none;cursor:pointer;color:var(--fg-muted);font-size:16px;margin-left:6px;">&#x2715;</button>';

    var msgs = document.createElement('div');
    msgs.id = 'pill-msgs';
    msgs.style.cssText = 'flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;';
    var welcome = document.createElement('div');
    welcome.style.cssText = 'font-size:12px;color:var(--fg-muted);font-style:italic;';
    welcome.textContent = 'Good day, sir. What are we working on?';
    msgs.appendChild(welcome);

    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'border-top:1px solid var(--border);padding:8px;flex-shrink:0;display:flex;gap:6px;align-items:flex-end;';

    var ta = document.createElement('textarea');
    ta.id = 'pill-input';
    ta.placeholder = 'Ask anything...';
    ta.rows = 1;
    ta.style.cssText = 'flex:1;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:inherit;resize:none;min-height:34px;max-height:80px;background:var(--bg);color:var(--fg);';
    ta.oninput = function() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 80) + 'px'; };
    ta.onkeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPillMsg(); } };

    var sendBtn = document.createElement('button');
    sendBtn.innerHTML = '&#x2191;';
    sendBtn.style.cssText = 'padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:14px;';
    sendBtn.onclick = sendPillMsg;

    inputRow.appendChild(ta);
    inputRow.appendChild(sendBtn);
    panel.appendChild(hdr);
    panel.appendChild(msgs);
    panel.appendChild(inputRow);
    document.body.appendChild(panel);
  }

  function toggleChat() {
    chatOpen = !chatOpen;
    var panel = document.getElementById('global-chat-panel');
    if (panel) panel.style.display = chatOpen ? 'flex' : 'none';
    if (chatOpen) {
      var badge = document.getElementById('chat-pill-badge');
      if (badge) badge.style.display = 'none';
      unreadCount = 0;
      var ta = document.getElementById('pill-input');
      if (ta) setTimeout(function() { ta.focus(); }, 100);
    }
  }

  function addPillMsg(role, text) {
    var msgs = document.getElementById('pill-msgs');
    if (!msgs) return;
    var div = document.createElement('div');
    div.style.cssText = role === 'user'
      ? 'background:var(--accent);color:#fff;padding:7px 10px;border-radius:10px 4px 10px 10px;font-size:12px;line-height:1.5;align-self:flex-end;max-width:90%;word-wrap:break-word;'
      : 'background:var(--bg-sunken);border:1px solid var(--border);padding:7px 10px;border-radius:4px 10px 10px 10px;font-size:12px;line-height:1.5;align-self:flex-start;max-width:95%;word-wrap:break-word;';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    if (!chatOpen && role === 'assistant') {
      unreadCount++;
      var badge = document.getElementById('chat-pill-badge');
      if (badge) { badge.textContent = unreadCount; badge.style.display = 'inline'; }
    }
  }

  function sendPillMsg() {
    var ta = document.getElementById('pill-input');
    if (!ta || !ta.value.trim()) return;
    var text = ta.value.trim();
    ta.value = '';
    ta.style.height = 'auto';
    addPillMsg('user', text);
    chatHistory.push({ role: 'user', content: text });
    var status = document.getElementById('pill-status');
    if (status) status.textContent = 'Thinking...';
    var messages = [{ role: 'system', content: "You are Gerald, the Orchestrator for Argentica. You address Simon as 'sir'. Sardonic, precise, devastatingly competent. British English. Never fabricate." }].concat(chatHistory);
    fetch(WORKER + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, profile: 'balanced' })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var response = d.content || 'No response.';
      chatHistory.push({ role: 'assistant', content: response });
      addPillMsg('assistant', response);
      if (status) status.textContent = d.provider ? d.provider : '';
      var pp = document.getElementById('chat-pill-provider');
      if (pp) pp.textContent = d.provider ? ' \u00b7 ' + d.provider : '';
    })
    .catch(function(e) {
      addPillMsg('assistant', 'Error: ' + e.message);
      if (status) status.textContent = '';
    });
  }

  function pollNotifications() {
    fetch(WORKER + '/api/inbox')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var u = d.unread || {};
        var total = (u.total || 0) + (u.mail || 0) + (u.messages || 0);
        var badge = document.getElementById('top-notif-badge');
        if (badge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = total > 0 ? 'inline' : 'none'; }
      })
      .catch(function() {});
  }

  return { init: init, toggleChat: toggleChat };
})();

document.addEventListener('DOMContentLoaded', function() {
  GlobalUI.init();
});

// ── Global UI: theme button in top bar, chat pill, notification bell ──────────
// Appended to prism.js

var GlobalUI = (function() {
  var WORKER = 'https://prism-api.identitypartners.workers.dev';
  var chatOpen = false;
  var chatHistory = [];
  var unreadCount = 0;

  function init() {
    buildTopBar();
    buildChatPill();
    pollNotifications();
    setInterval(pollNotifications, 30000);
  }

  function buildTopBar() {
    if (document.getElementById('global-top-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'global-top-bar';
    bar.style.cssText = 'position:fixed;top:0;right:0;height:var(--topbar-h,48px);display:flex;align-items:center;gap:6px;padding:0 12px;z-index:800;pointer-events:none;';

    function makeBtn(icon, title, onclick) {
      var btn = document.createElement('button');
      btn.innerHTML = icon;
      btn.title = title;
      btn.style.cssText = 'pointer-events:all;width:32px;height:32px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:border-color 0.15s;';
      btn.onmouseenter = function() { btn.style.borderColor = 'var(--accent)'; };
      btn.onmouseleave = function() { btn.style.borderColor = 'var(--border)'; };
      btn.onclick = onclick;
      return btn;
    }

    // Theme button
    var themeBtn = makeBtn('🎨', 'Change theme', function(e) {
      e.stopPropagation();
      var panel = document.getElementById('theme-picker-panel');
      if (!panel) {
        if (window.ThemeSystem && ThemeSystem.buildPicker) ThemeSystem.buildPicker();
        panel = document.getElementById('theme-picker-panel');
      }
      if (panel) {
        panel.style.bottom = 'auto';
        panel.style.top = '52px';
        panel.style.left = 'auto';
        panel.style.right = '14px';
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Notification bell
    var notifBtn = makeBtn('&#x1F514;', 'Inbox & notifications', function() {
      window.location.href = '/inbox/';
    });
    var badge = document.createElement('span');
    badge.id = 'top-notif-badge';
    badge.style.cssText = 'position:absolute;top:-3px;right:-3px;background:#dc2626;color:#fff;border-radius:8px;font-size:9px;font-weight:700;padding:1px 4px;display:none;';
    notifBtn.style.position = 'relative';
    notifBtn.appendChild(badge);

    bar.appendChild(themeBtn);
    bar.appendChild(notifBtn);
    document.body.appendChild(bar);
  }

  function buildChatPill() {
    if (document.getElementById('global-chat-strip')) return;

    // Bottom strip
    var strip = document.createElement('div');
    strip.id = 'global-chat-strip';
    strip.style.cssText = 'position:fixed;bottom:0;right:0;height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;z-index:900;background:var(--bg-elevated);border-top:1px solid var(--border);border-left:1px solid var(--border);border-radius:10px 0 0 0;box-shadow:0 -2px 12px rgba(0,0,0,0.08);cursor:pointer;transition:background 0.15s;';
    strip.onmouseenter = function() { strip.style.background = 'var(--bg-sunken)'; };
    strip.onmouseleave = function() { strip.style.background = 'var(--bg-elevated)'; };
    strip.onclick = toggleChat;

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:15px;';
    icon.innerHTML = '💬';

    var label = document.createElement('span');
    label.style.cssText = 'font-size:12px;font-weight:600;color:var(--fg);';
    label.textContent = 'Chat';

    var pillBadge = document.createElement('span');
    pillBadge.id = 'chat-pill-badge';
    pillBadge.style.cssText = 'background:var(--accent);color:#fff;border-radius:8px;font-size:9px;font-weight:700;padding:1px 6px;display:none;';

    var providerSpan = document.createElement('span');
    providerSpan.id = 'chat-pill-provider';
    providerSpan.style.cssText = 'font-size:10px;color:var(--fg-muted);';

    strip.appendChild(icon);
    strip.appendChild(label);
    strip.appendChild(pillBadge);
    strip.appendChild(providerSpan);
    document.body.appendChild(strip);

    // Chat panel
    var panel = document.createElement('div');
    panel.id = 'global-chat-panel';
    panel.style.cssText = 'position:fixed;bottom:38px;right:0;width:380px;height:500px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px 0 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.15);display:none;flex-direction:column;z-index:899;';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;';
    hdr.innerHTML = '<span style="font-size:14px;">&#x1F3A9;</span><span style="font-size:13px;font-weight:600;flex:1;">Gerald</span><span id="pill-status" style="font-size:10px;color:var(--fg-muted);"></span><a href="/chat/" style="font-size:11px;color:var(--accent);text-decoration:none;">Full &#x2197;</a><button onclick="GlobalUI.toggleChat()" style="background:none;border:none;cursor:pointer;color:var(--fg-muted);font-size:16px;margin-left:6px;">&#x2715;</button>';

    var msgs = document.createElement('div');
    msgs.id = 'pill-msgs';
    msgs.style.cssText = 'flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;';
    var welcome = document.createElement('div');
    welcome.style.cssText = 'font-size:12px;color:var(--fg-muted);font-style:italic;';
    welcome.textContent = 'Good day, sir. What are we working on?';
    msgs.appendChild(welcome);

    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'border-top:1px solid var(--border);padding:8px;flex-shrink:0;display:flex;gap:6px;align-items:flex-end;';

    var ta = document.createElement('textarea');
    ta.id = 'pill-input';
    ta.placeholder = 'Ask anything...';
    ta.rows = 1;
    ta.style.cssText = 'flex:1;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:inherit;resize:none;min-height:34px;max-height:80px;background:var(--bg);color:var(--fg);';
    ta.oninput = function() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 80) + 'px'; };
    ta.onkeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPillMsg(); } };

    var sendBtn = document.createElement('button');
    sendBtn.innerHTML = '&#x2191;';
    sendBtn.style.cssText = 'padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:14px;';
    sendBtn.onclick = sendPillMsg;

    inputRow.appendChild(ta);
    inputRow.appendChild(sendBtn);
    panel.appendChild(hdr);
    panel.appendChild(msgs);
    panel.appendChild(inputRow);
    document.body.appendChild(panel);
  }

  function toggleChat() {
    chatOpen = !chatOpen;
    var panel = document.getElementById('global-chat-panel');
    if (panel) panel.style.display = chatOpen ? 'flex' : 'none';
    if (chatOpen) {
      var badge = document.getElementById('chat-pill-badge');
      if (badge) badge.style.display = 'none';
      unreadCount = 0;
      var ta = document.getElementById('pill-input');
      if (ta) setTimeout(function() { ta.focus(); }, 100);
    }
  }

  function addPillMsg(role, text) {
    var msgs = document.getElementById('pill-msgs');
    if (!msgs) return;
    var div = document.createElement('div');
    div.style.cssText = role === 'user'
      ? 'background:var(--accent);color:#fff;padding:7px 10px;border-radius:10px 4px 10px 10px;font-size:12px;line-height:1.5;align-self:flex-end;max-width:90%;word-wrap:break-word;'
      : 'background:var(--bg-sunken);border:1px solid var(--border);padding:7px 10px;border-radius:4px 10px 10px 10px;font-size:12px;line-height:1.5;align-self:flex-start;max-width:95%;word-wrap:break-word;';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    if (!chatOpen && role === 'assistant') {
      unreadCount++;
      var badge = document.getElementById('chat-pill-badge');
      if (badge) { badge.textContent = unreadCount; badge.style.display = 'inline'; }
    }
  }

  function sendPillMsg() {
    var ta = document.getElementById('pill-input');
    if (!ta || !ta.value.trim()) return;
    var text = ta.value.trim();
    ta.value = '';
    ta.style.height = 'auto';
    addPillMsg('user', text);
    chatHistory.push({ role: 'user', content: text });
    var status = document.getElementById('pill-status');
    if (status) status.textContent = 'Thinking...';
    var messages = [{ role: 'system', content: "You are Gerald, the Orchestrator for Argentica. You address Simon as 'sir'. Sardonic, precise, devastatingly competent. British English. Never fabricate." }].concat(chatHistory);
    fetch(WORKER + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, profile: 'balanced' })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var response = d.content || 'No response.';
      chatHistory.push({ role: 'assistant', content: response });
      addPillMsg('assistant', response);
      if (status) status.textContent = d.provider ? d.provider : '';
      var pp = document.getElementById('chat-pill-provider');
      if (pp) pp.textContent = d.provider ? ' \u00b7 ' + d.provider : '';
    })
    .catch(function(e) {
      addPillMsg('assistant', 'Error: ' + e.message);
      if (status) status.textContent = '';
    });
  }

  function pollNotifications() {
    fetch(WORKER + '/api/inbox')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var u = d.unread || {};
        var total = (u.total || 0) + (u.mail || 0) + (u.messages || 0);
        var badge = document.getElementById('top-notif-badge');
        if (badge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = total > 0 ? 'inline' : 'none'; }
      })
      .catch(function() {});
  }

  return { init: init, toggleChat: toggleChat };
})();

document.addEventListener('DOMContentLoaded', function() {
  GlobalUI.init();
});

// ── Automatic error logging ───────────────────────────────────────────────────
(function() {
  var WORKER = 'https://prism-api.identitypartners.workers.dev';
  window.addEventListener('error', function(e) {
    fetch(WORKER + '/api/errors/log', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        page: window.location.pathname,
        error: e.message || String(e.error),
        stack: e.error && e.error.stack ? e.error.stack : '',
        url: e.filename || '',
        line: e.lineno,
        col: e.colno
      })
    }).catch(function(){});
  });
  window.addEventListener('unhandledrejection', function(e) {
    fetch(WORKER + '/api/errors/log', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        page: window.location.pathname,
        error: 'Unhandled Promise: ' + String(e.reason),
        stack: e.reason && e.reason.stack ? e.reason.stack : '',
        url: window.location.href
      })
    }).catch(function(){});
  });
})();
