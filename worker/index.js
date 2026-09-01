// Prism API Worker — Identity Partners
// ES Module format (required for D1 binding)

// ─── TROPE ELIMINATION ────────────────────────────────────────────────────────
function stripTropes(text) {
  if (!text) return text;
  var patterns = [
    /^(Great|Excellent|Wonderful|Fantastic|Amazing|Perfect|Brilliant)\s+(question|point|idea|observation|thought)[!.]\s*/gi,
    /^You'?re\s+absolutely\s+right[!.]\s*/gi,
    /\bdelve\b/gi,
    /\btapestry\b/gi,
    /^(In conclusion|To summarise|To summarize|In summary)[,:.]\s*/gim,
    /^(Certainly|Absolutely|Of course|Sure)[!,]\s*/gi,
    /I('m| am) (just |only )?an? (AI|language model|AI assistant)[^.]*\./gi,
  ];
  var result = text;
  patterns.forEach(function(p) { result = result.replace(p, ''); });
  return result.trim();
}

// ─── INTENT CLASSIFICATION ────────────────────────────────────────────────────
function classifyIntent(message) {
  if (!message) return 'chat';
  var m = message.toLowerCase();
  if (/\b(generate|create|draw|illustrate|make)\s+(an?\s+)?(image|picture|photo|illustration)\b/.test(m)) return 'image_gen';
  if (/\b(generate|create|compose)\s+(a\s+)?(song|music|audio|track)\b/.test(m)) return 'audio_gen';
  if (/\b(search|find|research|look up)\b/.test(m)) return 'research';
  if (/\b(write|draft|compose)\s+(a\s+)?(email|letter|report|article|blog|essay)\b/.test(m)) return 'drafting';
  if (/\b(code|function|script|program|debug|fix|implement)\b/.test(m)) return 'coding';
  if (/\b(reason|analyse|analyze|evaluate|assess)\b/.test(m)) return 'reasoning';
  if (/\b(remember|save|store|note|memory)\b/.test(m)) return 'memory_action';
  if (/\b(crm|client|contact|session|booking)\b/.test(m)) return 'crm_action';
  if (/\b(post|tweet|publish|schedule|social)\b/.test(m)) return 'social_post';
  if (/\b(atomise|atomize|refract|repurpose)\b/.test(m)) return 'social_post';
  return 'chat';
}

// ─── PROVIDER ADAPTERS ────────────────────────────────────────────────────────
async function callCerebras(env, messages, model) {
  var keys = [env.CEREBRAS_FREE_1, env.CEREBRAS_FREE_2, env.CEREBRAS_FREE_3, env.CEREBRAS_FREE_4, env.CEREBRAS_API_KEY, env.CEREBRAS_PAID].filter(Boolean);
  if (!keys.length) throw new Error('No Cerebras keys');
  var key = keys[Math.floor(Math.random() * keys.length)];
  var resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'llama-4-scout-17b-16e-instruct', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Cerebras: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callGroq(env, messages, model) {
  var keys = [env.GROQ_FREE_1, env.GROQ_FREE_2, env.GROQ_FREE_3, env.GROQ_API_KEY].filter(Boolean);
  if (!keys.length) throw new Error('No Groq keys');
  var key = keys[Math.floor(Math.random() * keys.length)];
  var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'llama-3.3-70b-versatile', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Groq: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callDeepSeek(env, messages, model) {
  var key = env.DEEPSEEK_PAID || env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('No DeepSeek key');
  var resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'deepseek-chat', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('DeepSeek: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callGemini(env, messages, model) {
  var keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4].filter(Boolean);
  if (!keys.length) throw new Error('No Gemini keys');
  var key = keys[Math.floor(Math.random() * keys.length)];
  var mdl = model || 'gemini-2.0-flash';
  var contents = messages.filter(function(m){return m.role!=='system';}).map(function(m){
    return {role: m.role==='assistant'?'model':'user', parts:[{text:m.content}]};
  });
  var sysMsg = messages.find(function(m){return m.role==='system';});
  var body = {contents: contents};
  if (sysMsg) body.systemInstruction = {parts:[{text:sysMsg.content}]};
  var resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+mdl+':generateContent?key='+key, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Gemini: '+(data.error&&data.error.message||resp.status));
  return data.candidates[0].content.parts[0].text;
}

async function callOpenRouter(env, messages, model) {
  var key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No OpenRouter key');
  var resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key,'HTTP-Referer':'https://prism.identitypartners.uk'},
    body: JSON.stringify({model: model||'deepseek/deepseek-chat-v3-0324:free', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('OpenRouter: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callSambaNova(env, messages, model) {
  var key = env.SAMBANOVA_API_KEY;
  if (!key) throw new Error('No SambaNova key');
  var resp = await fetch('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'Meta-Llama-3.3-70B-Instruct', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('SambaNova: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callNvidia(env, messages, model) {
  var key = env.NVIDIA_API_KEY;
  if (!key) throw new Error('No NVIDIA key');
  var resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'nvidia/llama-3.3-nemotron-super-49b-v1', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('NVIDIA: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callMistral(env, messages, model) {
  var key = env.MISTRAL_API_KEY;
  if (!key) throw new Error('No Mistral key');
  var resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'mistral-small-latest', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Mistral: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callTogether(env, messages, model) {
  var key = env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together key');
  var resp = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Together: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callFireworks(env, messages, model) {
  var key = env.FIREWORKS_API_KEY;
  if (!key) throw new Error('No Fireworks key');
  var resp = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'accounts/fireworks/models/llama-v3p3-70b-instruct', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Fireworks: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callZhipu(env, messages, model) {
  var key = env.ZHIPU_API_KEY;
  if (!key) throw new Error('No Zhipu key');
  var resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'glm-4-flash', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Zhipu: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callChutes(env, messages, model) {
  var key = env.CHUTES_API_KEY;
  if (!key) throw new Error('No Chutes key');
  var resp = await fetch('https://llm.chutes.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'deepseek-ai/DeepSeek-V3-0324', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Chutes: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callNebius(env, messages, model) {
  var key = env.NEBIOUS_API_KEY;
  if (!key) throw new Error('No Nebius key');
  var resp = await fetch('https://api.studio.nebius.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'meta-llama/Meta-Llama-3.1-70B-Instruct', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Nebius: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callKimi(env, messages, model) {
  var key = env.KIMI_API_KEY;
  if (!key) throw new Error('No Kimi key');
  var resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'moonshot-v1-8k', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Kimi: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callOllama(env, messages, model) {
  var tunnelUrl = env.OLLAMA_TUNNEL_URL || 'http://localhost:11434';
  var resp = await fetch(tunnelUrl+'/api/chat', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({model: model||'phi4:latest', messages: messages, stream: false})
  });
  if (!resp.ok) throw new Error('Ollama: '+resp.status);
  var data = await resp.json();
  return data.message.content;
}

// ─── ROUTING PROFILES ─────────────────────────────────────────────────────────
var FALLBACK_CHAINS = {
  'local':         [['ollama','phi4:latest']],
  'free':          [['cerebras',null],['groq',null],['sambanova',null],['together',null],['chutes',null],['openrouter',null],['ollama',null]],
  'balanced':      [['cerebras',null],['groq',null],['deepseek','deepseek-chat'],['sambanova',null],['chutes',null],['openrouter',null],['ollama',null]],
  'frontier-free': [['gemini',null],['nvidia',null],['deepseek','deepseek-chat'],['openrouter',null],['ollama',null]],
  'frontier':      [['deepseek','deepseek-reasoner'],['gemini','gemini-2.0-flash'],['openrouter','deepseek/deepseek-r1'],['deepseek','deepseek-chat'],['ollama',null]],
  'coding':        [['zhipu','glm-4-flash'],['cerebras',null],['deepseek','deepseek-chat'],['groq',null]],
  'reasoning':     [['nvidia',null],['deepseek','deepseek-reasoner'],['groq','deepseek-r1-distill-llama-70b'],['openrouter',null]],
  'fast':          [['cerebras',null],['groq',null],['zhipu','glm-4-flash']],
};

var PROVIDER_FNS = {
  'cerebras':  callCerebras,
  'groq':      callGroq,
  'deepseek':  callDeepSeek,
  'gemini':    callGemini,
  'openrouter':callOpenRouter,
  'sambanova': callSambaNova,
  'nvidia':    callNvidia,
  'mistral':   callMistral,
  'together':  callTogether,
  'fireworks': callFireworks,
  'zhipu':     callZhipu,
  'chutes':    callChutes,
  'nebius':    callNebius,
  'kimi':      callKimi,
  'ollama':    callOllama,
};

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────
async function orchestrate(env, messages, profile, intent, threadId) {
  var chain = (FALLBACK_CHAINS[profile] || FALLBACK_CHAINS['balanced']).slice();
  if (intent === 'coding') chain = FALLBACK_CHAINS['coding'].concat(chain);
  if (intent === 'reasoning') chain = FALLBACK_CHAINS['reasoning'].concat(chain);

  var lastError = null;
  var routingLog = [];

  for (var i = 0; i < chain.length; i++) {
    var provider = chain[i][0];
    var model = chain[i][1];
    var fn = PROVIDER_FNS[provider];
    if (!fn) continue;
    try {
      routingLog.push({provider: provider, model: model});
      var result = await fn(env, messages, model);
      if (result && result.trim()) {
        var cleaned = stripTropes(result);
        if (env.PRISM_KV && threadId) {
          await env.PRISM_KV.put('routing:'+threadId+':'+Date.now(), JSON.stringify({
            provider: provider, model: model, intent: intent, profile: profile
          }), {expirationTtl: 604800});
        }
        return {content: cleaned, provider: provider, model: model, routingLog: routingLog};
      }
    } catch(e) {
      lastError = e;
      routingLog[routingLog.length-1].error = e.message;
    }
  }
  throw new Error('All providers failed. Last: '+(lastError ? lastError.message : 'unknown'));
}

// ─── MEMORY ───────────────────────────────────────────────────────────────────
async function getMemories(env) {
  if (!env.PRISM_KV) return [];
  try {
    var list = await env.PRISM_KV.list({prefix: 'memory:'});
    var memories = [];
    for (var i = 0; i < Math.min(list.keys.length, 10); i++) {
      var val = await env.PRISM_KV.get(list.keys[i].name);
      if (val) memories.push(JSON.parse(val));
    }
    return memories;
  } catch(e) { return []; }
}

async function saveMemory(env, content, tags) {
  if (!env.PRISM_KV) return null;
  var id = 'memory:'+Date.now();
  await env.PRISM_KV.put(id, JSON.stringify({id: id, content: content, tags: tags||[], created: new Date().toISOString()}));
  return id;
}

// ─── THREADS ──────────────────────────────────────────────────────────────────
async function getThread(env, threadId) {
  if (!env.PRISM_KV) return null;
  var val = await env.PRISM_KV.get('thread:'+threadId);
  return val ? JSON.parse(val) : null;
}

async function saveThread(env, threadId, thread) {
  if (!env.PRISM_KV) return;
  await env.PRISM_KV.put('thread:'+threadId, JSON.stringify(thread));
}

async function listThreads(env) {
  if (!env.PRISM_KV) return [];
  try {
    var list = await env.PRISM_KV.list({prefix: 'thread:'});
    var threads = [];
    for (var i = 0; i < Math.min(list.keys.length, 50); i++) {
      var val = await env.PRISM_KV.get(list.keys[i].name);
      if (val) {
        var t = JSON.parse(val);
        threads.push({id: t.id, title: t.title, messageCount: (t.messages||[]).length, updated: t.updated});
      }
    }
    return threads.sort(function(a,b){ return new Date(b.updated)-new Date(a.updated); });
  } catch(e) { return []; }
}

// ─── IMAGE GENERATION ─────────────────────────────────────────────────────────
async function generateImage(env, prompt, modelName) {
  if (env.FAL_API_KEY) {
    try {
      var resp = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':'Key '+env.FAL_API_KEY},
        body: JSON.stringify({prompt: prompt, image_size: 'landscape_4_3', num_images: 1})
      });
      if (resp.ok) {
        var data = await resp.json();
        if (data.images && data.images[0]) return {url: data.images[0].url, provider: 'fal'};
      }
    } catch(e) {}
  }
  var encoded = encodeURIComponent(prompt);
  return {url: 'https://image.pollinations.ai/prompt/'+encoded+'?width=1024&height=768&nologo=true&model='+(modelName||'flux'), provider: 'pollinations'};
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
async function searchTavily(env, query) {
  var key = env.TAVILY_API_KEY || env.TAVILY_API_KEY_2;
  if (!key) return [];
  var resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({api_key: key, query: query, max_results: 5, include_answer: true})
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return data.results || [];
}

async function searchBrave(env, query) {
  var key = env.BRAVE_API_KEY || env.BRAVE_API_KEY_2;
  if (!key) return [];
  var resp = await fetch('https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(query)+'&count=5', {
    headers: {'Accept':'application/json','X-Subscription-Token': key}
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return (data.web && data.web.results) ? data.web.results : [];
}

// ─── ATOMISE ──────────────────────────────────────────────────────────────────
async function atomise(env, text, profile) {
  var sys = {role:'system', content:'You are a social media content specialist for Identity Partners, a professional services firm focused on addiction, trauma, mental health, and community wellbeing. Write in British English. Be concise, professional, and engaging. No sycophancy.'};
  var assets = {};

  var quoteResp = await orchestrate(env, [sys, {role:'user', content:'Extract 3 powerful, standalone quotes from this text. Each 15-25 words, suitable for a quote card. Return as a JSON array of strings only.\n\n'+text}], profile||'balanced', 'drafting', null);
  try { assets.quotes = JSON.parse(quoteResp.content.match(/\[[\s\S]*?\]/)[0]); } catch(e) { assets.quotes = [quoteResp.content]; }

  var liResp = await orchestrate(env, [sys, {role:'user', content:'Write a LinkedIn post based on this text. 150-200 words. Professional tone. 3-5 hashtags at the end.\n\n'+text}], profile||'balanced', 'drafting', null);
  assets.linkedin = liResp.content;

  var bskyResp = await orchestrate(env, [sys, {role:'user', content:'Write a Bluesky thread (5 posts, each under 300 characters). Number each 1/5, 2/5 etc. Return as JSON array of strings only.\n\n'+text}], profile||'balanced', 'drafting', null);
  try { assets.bluesky = JSON.parse(bskyResp.content.match(/\[[\s\S]*?\]/)[0]); } catch(e) { assets.bluesky = [bskyResp.content]; }

  var emailResp = await orchestrate(env, [sys, {role:'user', content:'Write a newsletter email snippet. 80-120 words. Warm but professional. Clear call to action at the end.\n\n'+text}], profile||'balanced', 'drafting', null);
  assets.email = emailResp.content;

  var carouselResp = await orchestrate(env, [sys, {role:'user', content:'Create a 5-slide LinkedIn carousel. Each slide: title (max 8 words) and body (max 30 words). Return as JSON array of {title,body} objects only.\n\n'+text}], profile||'balanced', 'drafting', null);
  try { assets.carousel = JSON.parse(carouselResp.content.match(/\[[\s\S]*?\]/)[0]); } catch(e) { assets.carousel = [{title:'Key Insight', body: carouselResp.content}]; }

  return assets;
}

// ─── BLUESKY ──────────────────────────────────────────────────────────────────
async function postToBluesky(env, text) {
  var handle = env.BLUESKY_HANDLE || 'identitypartners.bsky.social';
  var password = env.BLUESKY_APP_PASSWORD;
  if (!password) throw new Error('Bluesky app password not configured');
  var sessionResp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({identifier: handle, password: password})
  });
  if (!sessionResp.ok) throw new Error('Bluesky auth failed');
  var session = await sessionResp.json();
  var postResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+session.accessJwt},
    body: JSON.stringify({repo: session.did, collection: 'app.bsky.feed.post', record: {text: text, createdAt: new Date().toISOString(), '$type': 'app.bsky.feed.post'}})
  });
  if (!postResp.ok) throw new Error('Bluesky post failed');
  return await postResp.json();
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function sendTelegram(env, message) {
  var token = env.TELEGRAM_TOKEN;
  var chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch('https://api.telegram.org/bot'+token+'/sendMessage', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: chatId, text: message, parse_mode: 'Markdown'})
  });
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Thread-ID, X-Profile',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({'Content-Type':'application/json'}, cors(origin))
  });
}

// ─── DEV TEAM SYSTEM PROMPTS ──────────────────────────────────────────────────
var DEV_TEAM_PROMPTS = {
  pm: 'You are the Programme Manager for Prism (prism.identitypartners.uk). Worker: prism-api.identitypartners.workers.dev. Repo: IdentityPartners/prism. Pages deploys from main branch. JS rules: var not const/let at top level, no arrow functions in onclick, no innerHTML with mixed quotes, use document.createElement. You coordinate the dev team and maintain the roadmap. Direct, technical, concise. British English.',
  troubleshooter: 'You are the Troubleshooter for Prism. Diagnose and fix issues systematically. Common issues: (1) const/let redeclaration — fix with var. (2) Arrow functions in onclick — fix with named functions. (3) innerHTML with mixed quotes — fix with createElement. (4) To push a fix: edit file, commit to main, Pages auto-deploys. (5) Worker secrets: Cloudflare dashboard > Workers > prism-api > Settings > Variables. Be precise.',
  researcher: 'You are the Research Agent for Prism. Find information, synthesise research, produce structured reports. Focus on addiction, trauma, mental health, community wellbeing, social policy. British English. Cite sources.',
  creator: 'You are the Creator Agent for Prism. Create content: social media posts, carousels, email newsletters, podcast scripts, worksheets. Identity Partners brand: warm, professional, evidence-based, focused on addiction and mental health. British English.',
  api_champion: 'You are the API Champion for Prism. Monitor the model registry, track new model releases, update routing profiles, ensure all API keys are current. Know all providers: Cerebras, Groq, DeepSeek, Gemini, OpenRouter, SambaNova, NVIDIA NIM, Mistral, Together, Fireworks, Cohere, Kimi, Chutes, Nebius, Zhipu, Ollama. Report model updates concisely.',
};

// ─── MAIN EXPORT (ES MODULE) ──────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;
    var origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: cors(origin)});
    }

    // Health
    if (path === '/' || path === '/health') {
      return json({status:'ok', version:'1.0.0', worker:'prism-api', timestamp: new Date().toISOString()}, 200, origin);
    }

    // Chat
    if (path === '/api/chat' && request.method === 'POST') {
      try {
        var body = await request.json();
        var messages = body.messages || [];
        var profile = body.profile || 'balanced';
        var threadId = body.threadId || ('t'+Date.now());
        var lastMsg = messages[messages.length-1];
        var intent = body.intent || classifyIntent(lastMsg ? lastMsg.content : '');

        // Inject memories
        var memories = await getMemories(env);
        if (memories.length > 0) {
          var memText = memories.slice(0,5).map(function(m){return m.content;}).join('\n');
          var sysIdx = messages.findIndex(function(m){return m.role==='system';});
          if (sysIdx >= 0) {
            messages[sysIdx] = {role:'system', content: messages[sysIdx].content+'\n\nRelevant memories:\n'+memText};
          } else {
            messages = [{role:'system', content:'Relevant memories:\n'+memText}].concat(messages);
          }
        }

        var result = await orchestrate(env, messages, profile, intent, threadId);

        // Save thread
        if (env.PRISM_KV) {
          var thread = await getThread(env, threadId) || {id: threadId, messages: [], created: new Date().toISOString()};
          thread.title = thread.title || (lastMsg ? lastMsg.content.substring(0,50) : 'Thread');
          thread.messages = body.messages.concat([{role:'assistant', content: result.content}]);
          thread.updated = new Date().toISOString();
          await saveThread(env, threadId, thread);
        }

        return json({content: result.content, provider: result.provider, model: result.model, intent: intent, threadId: threadId}, 200, origin);
      } catch(e) {
        return json({error: e.message}, 500, origin);
      }
    }

    // Threads list
    if (path === '/api/threads' && request.method === 'GET') {
      return json({threads: await listThreads(env)}, 200, origin);
    }

    // Thread by ID
    if (path.startsWith('/api/threads/') && request.method === 'GET') {
      var tid = path.slice(13);
      var thread = await getThread(env, tid);
      return thread ? json(thread, 200, origin) : json({error:'Not found'}, 404, origin);
    }

    // Delete thread
    if (path.startsWith('/api/threads/') && request.method === 'DELETE') {
      var tid = path.slice(13);
      if (env.PRISM_KV) await env.PRISM_KV.delete('thread:'+tid);
      return json({success:true}, 200, origin);
    }

    // Memory
    if (path === '/api/memory' && request.method === 'GET') {
      return json({memories: await getMemories(env)}, 200, origin);
    }
    if (path === '/api/memory' && request.method === 'POST') {
      var body = await request.json();
      var id = await saveMemory(env, body.content, body.tags);
      return json({success:true, id:id}, 200, origin);
    }
    if (path.startsWith('/api/memory/') && request.method === 'DELETE') {
      var mid = path.slice(12);
      if (env.PRISM_KV) await env.PRISM_KV.delete(mid);
      return json({success:true}, 200, origin);
    }

    // Image generation
    if (path === '/api/image' && request.method === 'POST') {
      try {
        var body = await request.json();
        var result = await generateImage(env, body.prompt, body.model);
        return json(result, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // Pollinations model list
    if (path === '/api/image/models') {
      try {
        var resp = await fetch('https://image.pollinations.ai/models');
        var models = await resp.json();
        return json({models: models}, 200, origin);
      } catch(e) { return json({models:['flux','turbo','gptimage']}, 200, origin); }
    }

    // Search
    if (path === '/api/search' && request.method === 'POST') {
      try {
        var body = await request.json();
        var results = {};
        if (!body.sources || body.sources.includes('tavily')) results.tavily = await searchTavily(env, body.query);
        if (body.sources && body.sources.includes('brave')) results.brave = await searchBrave(env, body.query);
        return json({results: results, query: body.query}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // Atomise
    if (path === '/api/atomise' && request.method === 'POST') {
      try {
        var body = await request.json();
        var assets = await atomise(env, body.text, body.profile);
        return json({assets: assets}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // Social queue
    if (path === '/api/social/queue' && request.method === 'GET') {
      if (!env.PRISM_KV) return json({queue:[]}, 200, origin);
      var list = await env.PRISM_KV.list({prefix:'queue:'});
      var queue = [];
      for (var i = 0; i < list.keys.length; i++) {
        var val = await env.PRISM_KV.get(list.keys[i].name);
        if (val) queue.push(JSON.parse(val));
      }
      return json({queue: queue.sort(function(a,b){return new Date(a.scheduledAt)-new Date(b.scheduledAt);})}, 200, origin);
    }
    if (path === '/api/social/queue' && request.method === 'POST') {
      var body = await request.json();
      var id = 'queue:'+Date.now();
      var item = Object.assign({id:id, created: new Date().toISOString(), status:'pending'}, body);
      if (env.PRISM_KV) await env.PRISM_KV.put(id, JSON.stringify(item));
      return json({success:true, id:id}, 200, origin);
    }
    if (path === '/api/social/post' && request.method === 'POST') {
      try {
        var body = await request.json();
        var results = {};
        if (body.platforms && body.platforms.includes('bluesky')) results.bluesky = await postToBluesky(env, body.text);
        return json({success:true, results:results}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // Dev Team
    if (path === '/api/devteam' && request.method === 'POST') {
      try {
        var body = await request.json();
        var agent = body.agent || 'pm';
        var historyKey = 'devteam:'+agent+':history';
        var history = [];
        if (env.PRISM_KV) {
          var stored = await env.PRISM_KV.get(historyKey);
          if (stored) history = JSON.parse(stored);
        }
        var sysPrompt = DEV_TEAM_PROMPTS[agent] || DEV_TEAM_PROMPTS['pm'];
        var messages = [{role:'system', content:sysPrompt}].concat(history).concat([{role:'user', content:body.message}]);
        var result = await orchestrate(env, messages, 'balanced', 'chat', null);
        history.push({role:'user', content:body.message});
        history.push({role:'assistant', content:result.content});
        if (history.length > 40) history = history.slice(-40);
        if (env.PRISM_KV) await env.PRISM_KV.put(historyKey, JSON.stringify(history));
        return json({content: result.content, provider: result.provider, agent: agent}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // CRM
    if (path === '/api/crm/contacts' && request.method === 'GET') {
      if (!env.PRISM_KV) return json({contacts:[]}, 200, origin);
      var list = await env.PRISM_KV.list({prefix:'crm:contact:'});
      var contacts = [];
      for (var i = 0; i < list.keys.length; i++) {
        var val = await env.PRISM_KV.get(list.keys[i].name);
        if (val) contacts.push(JSON.parse(val));
      }
      return json({contacts: contacts}, 200, origin);
    }
    if (path === '/api/crm/contacts' && request.method === 'POST') {
      var body = await request.json();
      var id = 'crm:contact:'+Date.now();
      var contact = Object.assign({id:id, created: new Date().toISOString()}, body);
      if (env.PRISM_KV) await env.PRISM_KV.put(id, JSON.stringify(contact));
      return json({success:true, id:id, contact:contact}, 200, origin);
    }

    // Zoho OAuth
    if (path.startsWith('/oauth/zoho/')) {
      var service = path.slice(12);
      var code = url.searchParams.get('code');
      var redirectUri = 'https://prism.identitypartners.uk/oauth/zoho/'+service;
      if (!code) {
        var scope = 'ZohoMail.messages.ALL,ZohoCalendar.event.ALL,ZohoCRM.modules.ALL';
        var authUrl = 'https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id='+(env.ZOHO_CLIENT_ID||env.Zoho_Client_ID)+'&scope='+encodeURIComponent(scope)+'&redirect_uri='+encodeURIComponent(redirectUri)+'&access_type=offline';
        return Response.redirect(authUrl, 302);
      }
      var tokenResp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
        method: 'POST',
        headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: 'grant_type=authorization_code&client_id='+(env.ZOHO_CLIENT_ID||env.Zoho_Client_ID)+'&client_secret='+(env.ZOHO_CLIENT_SECRET||env.Zoho_Client_Secret)+'&redirect_uri='+encodeURIComponent(redirectUri)+'&code='+code
      });
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put('zoho:tokens:'+service, JSON.stringify(tokens));
      return new Response('<html><body><script>window.close();</script><p>Authorised. You may close this window.</p></body></html>', {headers:{'Content-Type':'text/html'}});
    }

    // Telegram notify
    if (path === '/api/notify' && request.method === 'POST') {
      try {
        var body = await request.json();
        await sendTelegram(env, body.message);
        return json({success:true}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // KV list (diagnostics)
    if (path === '/api/kv' && request.method === 'GET') {
      if (!env.PRISM_KV) return json({keys:[]}, 200, origin);
      var prefix = url.searchParams.get('prefix') || '';
      var list = await env.PRISM_KV.list({prefix: prefix});
      return json({keys: list.keys.map(function(k){return k.name;})}, 200, origin);
    }


    // RSS proxy (server-side fetch to avoid CORS)
    if (path === '/api/rss' && request.method === 'GET') {
      var feedUrl = url.searchParams.get('url');
      if (!feedUrl) return json({error:'No URL provided'}, 400, origin);
      try {
        var rssResp = await fetch(feedUrl, {headers:{'User-Agent':'Prism/1.0 RSS Reader'}});
        var rssText = await rssResp.text();
        return new Response(rssText, {
          headers: Object.assign({'Content-Type':'application/rss+xml; charset=utf-8'}, cors(origin))
        });
      } catch(e) {
        return json({error:'RSS fetch failed: '+e.message}, 500, origin);
      }
    }

    return json({error:'Not found', path:path}, 404, origin);
  }
};
// This file is complete — the append below adds the RSS endpoint
// (appended at build time, not runtime)
