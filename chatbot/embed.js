// Prism Booking Widget — embed on any website
// Usage: <script src="https://prism.identitypartners.uk/chatbot/embed.js"></script>
// Or with options:
// <script src="https://prism.identitypartners.uk/chatbot/embed.js"
//   data-type="booking"
//   data-position="bottom-right"
//   data-color="#0f3b3a"
//   data-label="Book an Initial Consultation">
// </script>

(function() {
  var script = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var type = (script && script.getAttribute('data-type')) || 'booking';
  var position = (script && script.getAttribute('data-position')) || 'bottom-right';
  var color = (script && script.getAttribute('data-color')) || '#0f3b3a';
  var label = (script && script.getAttribute('data-label')) || (type === 'booking' ? 'Book an Initial Consultation' : 'Chat with us');
  var baseUrl = 'https://prism.identitypartners.uk';

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '.prism-widget-btn{position:fixed;z-index:9999;display:flex;align-items:center;gap:8px;padding:12px 20px;border-radius:50px;border:none;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:all 0.2s;}',
    '.prism-widget-btn:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(0,0,0,0.25);}',
    '.prism-widget-btn.bottom-right{bottom:24px;right:24px;}',
    '.prism-widget-btn.bottom-left{bottom:24px;left:24px;}',
    '.prism-widget-btn.bottom-center{bottom:24px;left:50%;transform:translateX(-50%);}',
    '.prism-widget-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9998;display:none;align-items:center;justify-content:center;}',
    '.prism-widget-overlay.open{display:flex;}',
    '.prism-widget-modal{background:#fff;border-radius:16px;overflow:hidden;width:100%;max-width:680px;max-height:90vh;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;}',
    '.prism-widget-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(0,0,0,0.1);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;z-index:1;}',
    '.prism-widget-iframe{width:100%;height:80vh;border:none;display:block;}',
    '@media(max-width:700px){.prism-widget-modal{max-width:100%;max-height:100%;border-radius:0;}.prism-widget-overlay{align-items:flex-end;}.prism-widget-iframe{height:90vh;}}'
  ].join('');
  document.head.appendChild(style);

  // Create button
  var btn = document.createElement('button');
  btn.className = 'prism-widget-btn ' + position;
  btn.style.background = color;
  btn.innerHTML = (type === 'booking' ? '📅 ' : '💬 ') + label;

  // Create overlay + modal
  var overlay = document.createElement('div');
  overlay.className = 'prism-widget-overlay';
  var modal = document.createElement('div');
  modal.className = 'prism-widget-modal';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'prism-widget-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  var iframe = document.createElement('iframe');
  iframe.className = 'prism-widget-iframe';
  iframe.src = baseUrl + (type === 'booking' ? '/book/?embed=1' : '/chat/?embed=1');
  iframe.title = label;
  iframe.allow = 'microphone';
  modal.appendChild(closeBtn);
  modal.appendChild(iframe);
  overlay.appendChild(modal);

  // Events
  btn.onclick = function() { overlay.classList.add('open'); };
  closeBtn.onclick = function() { overlay.classList.remove('open'); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.remove('open'); };
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') overlay.classList.remove('open'); });

  document.body.appendChild(btn);
  document.body.appendChild(overlay);
})();
