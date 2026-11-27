// ARGENTICA shared shell — helper: breathable inline modal (replaces prompt/confirm)
(function () {
  // ARG_ask(): Promise-based inline modal — never uses window.prompt/confirm.
  // usage: const name = await ARG_ask('New notebook', 'Name:', 'Sociology');
  //        if (await ARG_confirmModal('Delete this?', 'This cannot be undone.')) {...}
  function ask(title, label, preset, placeholder) {
    return new Promise(function (resolve) {
      var old = document.getElementById('arg-inline-modal');
      if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'arg-inline-modal';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(43,33,23,.34);z-index:9000;display:flex;align-items:center;justify-content:center;';
      m.innerHTML = '<div style="background:#fffdf6;border:1px solid #d8cfc0;border-radius:12px;padding:22px 24px;width:min(480px,92vw);">' +
        '<h3 style="margin:0 0 10px;font-family:Georgia,serif;color:#1c1a17;">' + title + '</h3>' +
        (label ? '<label style="display:block;font-size:13px;color:#6b675f;margin-bottom:6px;">' + label + '</label>' : '') +
        '<input id="arg-ask-input" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d8cfc0;border-radius:6px;font-size:14px;background:#fff;color:#1c1a17;"' +
        'value="' + (preset || '') + '" placeholder="' + (placeholder || '') + '">' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' +
        '<button id="arg-ask-no" style="padding:6px 14px;border:1px solid #d8cfc0;background:#fffdf6;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>' +
        '<button id="arg-ask-ok" style="padding:6px 16px;border:0;background:#0f3b3a;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">OK</button></div></div>';
      document.body.appendChild(m);
      var inp = m.querySelector('#arg-ask-input');
      inp.focus(); inp.select();
      var done = function (val) { m.remove(); resolve(val); };
      var ok = function () { done(inp.value || null); };
      m.querySelector('#arg-ask-ok').onclick = ok;
      m.querySelector('#arg-ask-no').onclick = function () { done(null); };
      m.addEventListener('click', function (e) { if (e.target === m) done(null); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') ok();
        if (e.key === 'Escape') done(null);
      });
    });
  }
  function confirmModal(title, body) {
    return new Promise(function (resolve) {
      var old = document.getElementById('arg-inline-modal');
      if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'arg-inline-modal';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(43,33,23,.34);z-index:9000;display:flex;align-items:center;justify-content:center;';
      m.innerHTML = '<div style="background:#fffdf6;border:1px solid #d8cfc0;border-radius:12px;padding:22px 24px;width:min(480px,92vw);">' +
        '<h3 style="margin:0 0 10px;font-family:Georgia,serif;color:#1c1a17;">' + title + '</h3>' +
        (body ? '<p style="margin:0 0 16px;font-size:13.5px;color:#6b675f;">' + body + '</p>' : '') +
        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
        '<button id="arg-cm-no" style="padding:6px 14px;border:1px solid #d8cfc0;background:#fffdf6;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>' +
        '<button id="arg-cm-yes" style="padding:6px 16px;border:0;background:#dc2626;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">Confirm</button></div></div>';
      document.body.appendChild(m);
      var done = function (v) { m.remove(); resolve(v); };
      m.querySelector('#arg-cm-yes').onclick = function () { done(true); };
      m.querySelector('#arg-cm-no').onclick = function () { done(false); };
      m.addEventListener('click', function (e) { if (e.target === m) done(false); });
      m.addEventListener('keydown', function (e) { if (e.key === 'Escape') done(false); }, true);
    });
  }
  window.ARG_ask = ask;
  window.ARG_confirmModal = confirmModal;
})();
