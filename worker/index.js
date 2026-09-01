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
  var keys = [env.CEREBRAS_FREE_1, env.CEREBRAS_FREE_2, env.CEREBRAS_FREE_3, env.CEREBRAS_FREE_4, env.cerebras_free_1, env.cerebras_free_2, env.cerebras_free_3, env.cerebras_free_4, env.CEREBRAS_API_KEY, env.CEREBRAS_PAID, env.cerebras_paid, env.CEREBRAS_PAID2, env.cerebras_paid2].filter(Boolean);
  if (!keys.length) throw new Error('No Cerebras keys');
  var key = keys[Math.floor(Math.random() * keys.length)];
  var resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'gemma-4-9b-it', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Cerebras: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callGroq(env, messages, model) {
  var keys = [env.GROQ_FREE_1, env.GROQ_FREE_2, env.GROQ_FREE_3, env.GROQ_API_KEY, env.groq_free_1, env.groq_free_2, env.groq_free_3, env.groq_api_key, env.GROQ_API_KEY].filter(Boolean);
  if (!keys.length) throw new Error('No Groq keys');
  var key = keys[Math.floor(Math.random() * keys.length)];
  var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'gemma2-9b-it', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Groq: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callDeepSeek(env, messages, model) {
  var key = env.DEEPSEEK_PAID || env.deepseek_paid || env.DEEPSEEK_FREE_1 || env.deepseek_free_1 || env.DEEPSEEK_API_KEY || env.deepseek_api_key;
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
  var keys = [env.GEMINI_API_KEY, env.gemini_api_key, env.gemini_paid_api_key, env.GEMINI_PAID_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4].filter(Boolean);
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
  var key = env.OPENROUTER_API_KEY || env.openrouter_api_key;
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
  var key = env.SAMBANOVA_API_KEY || env.sambanova_api_key;
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
  var key = env.NVIDIA_API_KEY || env.nvidia_build_api_key || env.NVIDIA_BUILD_API_KEY || env.nvidia_build_api_key_2;
  if (!key) throw new Error('No NVIDIA key');
  var resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'nvidia/llama-3.1-nemotron-ultra-253b-v1', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('NVIDIA: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callMistral(env, messages, model) {
  var key = env.MISTRAL_API_KEY || env.mistral_api_key;
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
  var key = env.TOGETHER_API_KEY || env.together_api_key;
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
  var key = env.FIREWORKS_API_KEY || env.fireworks_api_key;
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
  var key = env.ZHIPU_API_KEY || env.zhipu_api_key;
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
  var key = env.CHUTES_API_KEY || env.chutes_api_key;
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
  var key = env.NEBIOUS_API_KEY || env.NEBIUS_API_KEY || env.nebius_api_key || env.NEBIUS_API_key;
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
  var key = env.KIMI_API_KEY || env.kimi_api_key;
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


async function callAnyAPI(env, messages, model) {
  var key = env.ANYAPI_KEY || env.anyapi_key || env.ANY_API_KEY;
  if (!key) throw new Error('No AnyAPI key');
  var resp = await fetch('https://api.anyapi.com/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'gpt-4o-mini', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('AnyAPI: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callPerplexity(env, messages, model) {
  var key = env.PERPLEXITY_API_KEY || env.perplexity;
  if (!key) throw new Error('No Perplexity key');
  var resp = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'llama-3.1-sonar-small-128k-online', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('Perplexity: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

async function callHuggingFace(env, messages, model) {
  var key = env.HUGGINGFACE_API_KEY || env.huggingface_api_key;
  if (!key) throw new Error('No HuggingFace key');
  // Use HF Inference API with Gemma4
  var mdl = model || 'google/gemma-2-9b-it';
  var resp = await fetch('https://api-inference.huggingface.co/models/' + mdl + '/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: mdl, messages: messages, max_tokens: 2048, stream: false})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('HuggingFace: '+(data.error||resp.status));
  return data.choices[0].message.content;
}

async function callImageRouter(env, messages, model) {
  var key = env.IMAGEROUTER_API_KEY || env.imagerouter_api_key;
  if (!key) throw new Error('No ImageRouter key');
  var resp = await fetch('https://ir.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({model: model||'google/gemma-3-27b-it:free', messages: messages, max_tokens: 4096})
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error('ImageRouter: '+(data.error&&data.error.message||resp.status));
  return data.choices[0].message.content;
}

// ─── ROUTING PROFILES ─────────────────────────────────────────────────────────
// ── Routing philosophy ────────────────────────────────────────────────────────
// Primary: Cerebras Gemma4 (fastest, free, multimodal)
// Secondary: NVIDIA Nemotron, DeepSeek, Groq Gemma2/Llama
// Long-context reasoning only: Gemini
// OpenRouter: only for free access to models not otherwise available
// Llama Scout 4: fallback only — only beats Gemma4 on encyclopaedic long-context
// ─────────────────────────────────────────────────────────────────────────────
var FALLBACK_CHAINS = {
  'local': [
    ['ollama','gemma4:12b'],
    ['ollama','gemma4:e4b'],
    ['ollama','phi4:latest'],
    ['ollama','qwen2.5:7b'],
    ['ollama','deepseek-r1:7b']
  ],
  'free': [
    ['cerebras','gemma-4-9b-it'],          // Gemma4 on Cerebras — fastest free
    ['cerebras','gemma-4-27b-it'],          // Gemma4 27B on Cerebras
    ['groq','gemma2-9b-it'],               // Gemma2 on Groq
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'], // NVIDIA free tier
    ['deepseek','deepseek-chat'],           // DeepSeek V3
    ['groq','llama-3.3-70b-versatile'],    // Groq Llama fallback
    ['chutes','deepseek-ai/DeepSeek-V3-0324'],
    ['sambanova',null],
    ['ollama','gemma4:12b']                // Local last resort
  ],
  'balanced': [
    ['cerebras','gemma-4-9b-it'],          // Gemma4 on Cerebras — primary
    ['cerebras','gemma-4-27b-it'],          // Gemma4 27B
    ['deepseek','deepseek-chat'],           // DeepSeek V3 for quality
    ['groq','gemma2-9b-it'],               // Gemma2 on Groq
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'],
    ['groq','llama-3.3-70b-versatile'],
    ['chutes','deepseek-ai/DeepSeek-V3-0324'],
    ['ollama','gemma4:12b']
  ],
  'frontier-free': [
    ['cerebras','gemma-4-27b-it'],          // Gemma4 27B on Cerebras
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'],
    ['deepseek','deepseek-chat'],
    ['groq','gemma2-9b-it'],
    ['gemini','gemini-2.0-flash'],          // Gemini for long-context only
    ['ollama','gemma4:e4b']
  ],
  'frontier': [
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'], // Nemotron Ultra 253B — 128K context + reasoning
    ['deepseek','deepseek-reasoner'],       // DeepSeek R1
    ['cerebras','gemma-4-27b-it'],
    ['deepseek','deepseek-chat'],
    ['gemini','gemini-2.0-flash'],          // Long-context only
    ['ollama','gemma4:12b']
  ],
  'coding': [
    ['cerebras','gemma-4-9b-it'],          // Gemma4 excellent at code
    ['deepseek','deepseek-chat'],           // DeepSeek strong on code
    ['groq','gemma2-9b-it'],
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'],
    ['groq','llama-3.3-70b-versatile'],
    ['ollama','gemma4:12b']
  ],
  'reasoning': [
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'], // Nemotron Ultra 253B — primary reasoning + 128K context
    ['deepseek','deepseek-reasoner'],       // DeepSeek R1 — strong reasoning
    ['groq','deepseek-r1-distill-llama-70b'],
    ['cerebras','gemma-4-27b-it'],
    ['gemini','gemini-2.0-flash'],          // Long-context fallback
    ['ollama','deepseek-r1:7b']
  ],
  'fast': [
    ['cerebras','gemma-4-9b-it'],          // Gemma4 9B — fastest option
    ['groq','gemma2-9b-it'],               // Gemma2 on Groq — very fast
    ['groq','llama-3.1-8b-instant'],       // Groq 8B instant
    ['cerebras','llama-4-scout-17b-16e-instruct'] // Scout only as fast fallback
  ],
  'research': [
    ['perplexity','llama-3.1-sonar-large-128k-online'], // Web-search augmented
    ['cerebras','gemma-4-27b-it'],
    ['deepseek','deepseek-chat'],
    ['gemini','gemini-2.0-flash'],          // Long-context for research synthesis
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1']
  ],
  'multimodal': [
    ['cerebras','gemma-4-27b-it'],          // Gemma4 is multimodal on Cerebras
    ['gemini','gemini-2.0-flash'],          // Gemini multimodal
    ['nvidia','nvidia/llama-3.1-nemotron-ultra-253b-v1'],
    ['ollama','gemma4:12b']
  ],
};

var PROVIDER_FNS = {
  'cerebras':    callCerebras,
  'groq':        callGroq,
  'deepseek':    callDeepSeek,
  'gemini':      callGemini,
  'openrouter':  callOpenRouter,
  'sambanova':   callSambaNova,
  'nvidia':      callNvidia,
  'mistral':     callMistral,
  'together':    callTogether,
  'fireworks':   callFireworks,
  'zhipu':       callZhipu,
  'chutes':      callChutes,
  'nebius':      callNebius,
  'kimi':        callKimi,
  'ollama':      callOllama,
  'huggingface': callHuggingFace,
  'perplexity':  callPerplexity,
  'anyapi':      callAnyAPI,
  'imagerouter': callImageRouter,
};

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────
async function orchestrate(env, messages, profile, intent, threadId) {
  var chain = (FALLBACK_CHAINS[profile] || FALLBACK_CHAINS['balanced']).slice();
  if (intent === 'coding') chain = FALLBACK_CHAINS['coding'].slice();
  else if (intent === 'reasoning') chain = FALLBACK_CHAINS['reasoning'].slice();
  else if (intent === 'research') chain = FALLBACK_CHAINS['research'].slice();
  else if (intent === 'multimodal' || intent === 'image_gen') chain = FALLBACK_CHAINS['multimodal'].slice();

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
  var _falKey = env.FAL_API_KEY || env.fal_api_key;
  if (_falKey) {
    try {
      var falKey = env.FAL_API_KEY || env.fal_api_key;
      var resp = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':'Key '+falKey},
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
  var key = env.TAVILY_API_KEY || env.TAVILY_API_KEY_2 || env.tavily_api_key;
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
  var key = env.BRAVE_API_KEY || env.BRAVE_API_KEY_2 || env.brave_api_key;
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
    // Helper: get secret from env or KV fallback
    async function S(name) {
      if (env[name]) return env[name];
      if (env[name.toUpperCase()]) return env[name.toUpperCase()];
      if (env.PRISM_KV) {
        try {
          var kv = await env.PRISM_KV.get('__secrets__');
          if (kv) {
            var p = JSON.parse(kv);
            return p[name] || p[name.toUpperCase()] || p[name.toLowerCase()] || null;
          }
        } catch(e) {}
      }
      return null;
    }

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

        // Merge KV secrets into env for this request
        var kvRaw = null;
        try { kvRaw = await env.PRISM_KV.get('__secrets__'); } catch(e) {}
        var kvSecrets = {};
        if (kvRaw) { try { kvSecrets = JSON.parse(kvRaw); } catch(e) {} }
        var envPlus = new Proxy(env, {
          get: function(target, prop) {
            if (target[prop] !== undefined) return target[prop];
            if (kvSecrets[prop] !== undefined) return kvSecrets[prop];
            if (kvSecrets[prop.toUpperCase()] !== undefined) return kvSecrets[prop.toUpperCase()];
            if (kvSecrets[prop.toLowerCase()] !== undefined) return kvSecrets[prop.toLowerCase()];
            return undefined;
          }
        });
        var result = await orchestrate(envPlus, messages, profile, intent, threadId);

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
        var kvRaw3 = null;
        try { kvRaw3 = await env.PRISM_KV.get('__secrets__'); } catch(e) {}
        var kvSecrets3 = {};
        if (kvRaw3) { try { kvSecrets3 = JSON.parse(kvRaw3); } catch(e) {} }
        var envPlus3 = new Proxy(env, {
          get: function(target, prop) {
            if (target[prop] !== undefined) return target[prop];
            if (kvSecrets3[prop] !== undefined) return kvSecrets3[prop];
            if (kvSecrets3[prop.toUpperCase()] !== undefined) return kvSecrets3[prop.toUpperCase()];
            if (kvSecrets3[prop.toLowerCase()] !== undefined) return kvSecrets3[prop.toLowerCase()];
            return undefined;
          }
        });
        var assets = await atomise(envPlus3, body.text, body.profile);
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

    // ── X / Twitter OAuth + posting ──────────────────────────────────────────
    if (path === '/oauth/x/callback') {
      var code = url.searchParams.get('code');
      var state = url.searchParams.get('state');
      if (!code) {
        // Initiate OAuth 2.0 PKCE flow
        var clientId = env.X_CLIENT_ID || env.x_client_id || env.TWITTER_CLIENT_ID;
        if (!clientId) return json({error:'X client ID not configured. Add X_CLIENT_ID to Worker secrets.'}, 400, origin);
        var redirectUri = 'https://prism.identitypartners.uk/oauth/x/callback';
        var scope = 'tweet.read tweet.write users.read offline.access';
        var authUrl = 'https://twitter.com/i/oauth2/authorize?response_type=code&client_id='+clientId+'&redirect_uri='+encodeURIComponent(redirectUri)+'&scope='+encodeURIComponent(scope)+'&state=prism&code_challenge=challenge&code_challenge_method=plain';
        return Response.redirect(authUrl, 302);
      }
      // Exchange code for token
      var clientId2 = env.X_CLIENT_ID || env.x_client_id;
      var clientSecret = env.X_CLIENT_SECRET || env.x_client_secret;
      var tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+btoa(clientId2+':'+clientSecret)},
        body: 'grant_type=authorization_code&code='+code+'&redirect_uri='+encodeURIComponent('https://prism.identitypartners.uk/oauth/x/callback')+'&code_verifier=challenge'
      });
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put('oauth:x:tokens', JSON.stringify(tokens));
      return new Response('<html><body><script>window.close();</script><p>X connected. You may close this window.</p></body></html>',{headers:{'Content-Type':'text/html'}});
    }

    // Post to X
    if (path === '/api/social/post/x' && request.method === 'POST') {
      try {
        var body = await request.json();
        var tokenData = null;
        if (env.PRISM_KV) { var td = await env.PRISM_KV.get('oauth:x:tokens'); if (td) tokenData = JSON.parse(td); }
        if (!tokenData || !tokenData.access_token) return json({error:'X not connected. Go to /oauth/x/callback to connect.'}, 401, origin);
        var postResp = await fetch('https://api.twitter.com/2/tweets', {
          method: 'POST',
          headers: {'Content-Type':'application/json','Authorization':'Bearer '+tokenData.access_token},
          body: JSON.stringify({text: body.text})
        });
        var postData = await postResp.json();
        if (!postResp.ok) return json({error: postData.detail || 'X post failed', data: postData}, 400, origin);
        return json({success:true, id: postData.data && postData.data.id}, 200, origin);
      } catch(e) { return json({error:e.message},500,origin); }
    }

    // ── LinkedIn OAuth + posting ──────────────────────────────────────────────
    if (path === '/oauth/linkedin/callback') {
      var code = url.searchParams.get('code');
      var clientId = env.LINKEDIN_CLIENT_ID || env.linkedin_client_id;
      var clientSecret = env.LINKEDIN_CLIENT_SECRET || env.linkedin_primary_client_secret || env.linkedin_client_secret;
      if (!code) {
        if (!clientId) return json({error:'LinkedIn client ID not configured.'}, 400, origin);
        var redirectUri = 'https://prism.identitypartners.uk/oauth/linkedin/callback';
        var scope = 'openid profile email w_member_social';
        var authUrl = 'https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id='+clientId+'&redirect_uri='+encodeURIComponent(redirectUri)+'&scope='+encodeURIComponent(scope)+'&state=prism';
        return Response.redirect(authUrl, 302);
      }
      var redirectUri2 = 'https://prism.identitypartners.uk/oauth/linkedin/callback';
      var tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: 'grant_type=authorization_code&code='+code+'&redirect_uri='+encodeURIComponent(redirectUri2)+'&client_id='+clientId+'&client_secret='+clientSecret
      });
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put('oauth:linkedin:tokens', JSON.stringify(tokens));
      return new Response('<html><body><script>window.close();</script><p>LinkedIn connected.</p></body></html>',{headers:{'Content-Type':'text/html'}});
    }

    // Post to LinkedIn
    if (path === '/api/social/post/linkedin' && request.method === 'POST') {
      try {
        var body = await request.json();
        var tokenData = null;
        if (env.PRISM_KV) { var td = await env.PRISM_KV.get('oauth:linkedin:tokens'); if (td) tokenData = JSON.parse(td); }
        if (!tokenData || !tokenData.access_token) return json({error:'LinkedIn not connected. Go to /oauth/linkedin/callback to connect.'}, 401, origin);
        // Get person URN
        var meResp = await fetch('https://api.linkedin.com/v2/userinfo', {headers:{'Authorization':'Bearer '+tokenData.access_token}});
        var me = await meResp.json();
        var urn = 'urn:li:person:' + me.sub;
        var postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: {'Content-Type':'application/json','Authorization':'Bearer '+tokenData.access_token,'X-Restli-Protocol-Version':'2.0.0'},
          body: JSON.stringify({author:urn,lifecycleState:'PUBLISHED',specificContent:{'com.linkedin.ugc.ShareContent':{shareCommentary:{text:body.text},shareMediaCategory:'NONE'}},visibility:{'com.linkedin.ugc.MemberNetworkVisibility':'PUBLIC'}})
        });
        var postData = await postResp.json();
        if (!postResp.ok) return json({error:'LinkedIn post failed', data:postData}, 400, origin);
        return json({success:true, id:postData.id}, 200, origin);
      } catch(e) { return json({error:e.message},500,origin); }
    }

    // ── Meta (Facebook/Instagram) OAuth ──────────────────────────────────────
    if (path === '/oauth/meta/callback') {
      var code = url.searchParams.get('code');
      var clientId = env.META_APP_ID || env.meta_app_id || env.FACEBOOK_APP_ID;
      var clientSecret = env.META_APP_SECRET || env.meta_app_secret || env.FACEBOOK_APP_SECRET;
      if (!code) {
        if (!clientId) return json({error:'Meta App ID not configured. Add META_APP_ID to Worker secrets.'}, 400, origin);
        var redirectUri = 'https://prism.identitypartners.uk/oauth/meta/callback';
        var scope = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,publish_to_groups';
        var authUrl = 'https://www.facebook.com/v19.0/dialog/oauth?client_id='+clientId+'&redirect_uri='+encodeURIComponent(redirectUri)+'&scope='+encodeURIComponent(scope)+'&state=prism';
        return Response.redirect(authUrl, 302);
      }
      var redirectUri2 = 'https://prism.identitypartners.uk/oauth/meta/callback';
      var tokenResp = await fetch('https://graph.facebook.com/v19.0/oauth/access_token?client_id='+clientId+'&redirect_uri='+encodeURIComponent(redirectUri2)+'&client_secret='+clientSecret+'&code='+code);
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put('oauth:meta:tokens', JSON.stringify(tokens));
      return new Response('<html><body><script>window.close();</script><p>Meta connected.</p></body></html>',{headers:{'Content-Type':'text/html'}});
    }

    // ── Unified social post endpoint (routes to correct platform) ─────────────
    if (path === '/api/social/post' && request.method === 'POST') {
      try {
        var body = await request.json();
        var text = body.text || '';
        var platforms = body.platforms || ['bluesky'];
        var results = {};

        for (var pi = 0; pi < platforms.length; pi++) {
          var platform = platforms[pi];
          try {
            if (platform === 'bluesky') {
              results.bluesky = await postToBluesky(env, text);
            } else if (platform === 'x' || platform === 'twitter') {
              var xTokenData = null;
              if (env.PRISM_KV) { var xtd = await env.PRISM_KV.get('oauth:x:tokens'); if (xtd) xTokenData = JSON.parse(xtd); }
              if (xTokenData && xTokenData.access_token) {
                var xResp = await fetch('https://api.twitter.com/2/tweets',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+xTokenData.access_token},body:JSON.stringify({text:text.substring(0,280)})});
                results.x = await xResp.json();
              } else { results.x = {error:'Not connected — visit /oauth/x/callback'}; }
            } else if (platform === 'linkedin') {
              var liTokenData = null;
              if (env.PRISM_KV) { var litd = await env.PRISM_KV.get('oauth:linkedin:tokens'); if (litd) liTokenData = JSON.parse(litd); }
              if (liTokenData && liTokenData.access_token) {
                var meR = await fetch('https://api.linkedin.com/v2/userinfo',{headers:{'Authorization':'Bearer '+liTokenData.access_token}});
                var meD = await meR.json();
                var liResp = await fetch('https://api.linkedin.com/v2/ugcPosts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+liTokenData.access_token,'X-Restli-Protocol-Version':'2.0.0'},body:JSON.stringify({author:'urn:li:person:'+meD.sub,lifecycleState:'PUBLISHED',specificContent:{'com.linkedin.ugc.ShareContent':{shareCommentary:{text:text},shareMediaCategory:'NONE'}},visibility:{'com.linkedin.ugc.MemberNetworkVisibility':'PUBLIC'}})});
                results.linkedin = await liResp.json();
              } else { results.linkedin = {error:'Not connected — visit /oauth/linkedin/callback'}; }
            } else {
              results[platform] = {error:'Platform not yet connected — visit Platform Manager'};
            }
          } catch(pe) { results[platform] = {error:pe.message}; }
        }
        return json({success:true, results:results}, 200, origin);
      } catch(e) { return json({error:e.message},500,origin); }
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
        var kvRaw2 = null;
        try { kvRaw2 = await env.PRISM_KV.get('__secrets__'); } catch(e) {}
        var kvSecrets2 = {};
        if (kvRaw2) { try { kvSecrets2 = JSON.parse(kvRaw2); } catch(e) {} }
        var envPlus2 = new Proxy(env, {
          get: function(target, prop) {
            if (target[prop] !== undefined) return target[prop];
            if (kvSecrets2[prop] !== undefined) return kvSecrets2[prop];
            if (kvSecrets2[prop.toUpperCase()] !== undefined) return kvSecrets2[prop.toUpperCase()];
            if (kvSecrets2[prop.toLowerCase()] !== undefined) return kvSecrets2[prop.toLowerCase()];
            return undefined;
          }
        });
        var result = await orchestrate(envPlus2, messages, 'balanced', 'chat', null);
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


    // Secret ingestion endpoint — accepts secrets and stores them in KV for immediate use
    // Also proxies to CF API to persist them as Worker secrets
    if (path === '/api/ingest-secrets' && request.method === 'POST') {
      try {
        var body = await request.json();
        var secrets = body.secrets || {}; // {KEY: value, ...}
        var cfToken = body.cfToken;
        var accountId = body.accountId || 'd741de91f8cfff2306cc0f850a76ee07';
        var workerName = body.workerName || 'prism-api';
        var results = {ok: [], failed: []};

        // Store in KV immediately for instant use (no redeploy needed)
        if (env.PRISM_KV) {
          var kvSecrets = {};
          try {
            var existing = await env.PRISM_KV.get('__secrets__');
            if (existing) kvSecrets = JSON.parse(existing);
          } catch(e) {}
          Object.assign(kvSecrets, secrets);
          await env.PRISM_KV.put('__secrets__', JSON.stringify(kvSecrets));
        }

        // Also push to CF API as proper Worker secrets if token provided
        if (cfToken) {
          var entries = Object.entries(secrets);
          for (var i = 0; i < entries.length; i++) {
            var key = entries[i][0];
            var val = entries[i][1];
            try {
              var r = await fetch(
                'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/scripts/' + workerName + '/secrets',
                {
                  method: 'PUT',
                  headers: {'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json'},
                  body: JSON.stringify({name: key, text: val, type: 'secret_text'})
                }
              );
              var rd = await r.json();
              if (rd.success) results.ok.push(key);
              else results.failed.push({key: key, error: rd.errors && rd.errors[0] ? rd.errors[0].message : 'unknown'});
            } catch(e) {
              results.failed.push({key: key, error: e.message});
            }
          }
        } else {
          results.ok = Object.keys(secrets);
        }

        return json({success: true, kvStored: Object.keys(secrets).length, cfPushed: results.ok.length, failed: results.failed}, 200, origin);
      } catch(e) {
        return json({error: e.message}, 500, origin);
      }
    }

    // Get a secret from KV store (for runtime use)
    async function getSecret(env, name) {
      // Check env first (proper Worker secrets)
      if (env[name]) return env[name];
      // Check uppercase variant
      if (env[name.toUpperCase()]) return env[name.toUpperCase()];
      // Fall back to KV secret store
      if (env.PRISM_KV) {
        try {
          var kvSecrets = await env.PRISM_KV.get('__secrets__');
          if (kvSecrets) {
            var parsed = JSON.parse(kvSecrets);
            // Try exact match, then uppercase, then lowercase
            return parsed[name] || parsed[name.toUpperCase()] || parsed[name.toLowerCase()] || null;
          }
        } catch(e) {}
      }
      return null;
    }


    // Round Table — send to multiple models simultaneously, synthesise
    if (path === '/api/roundtable' && request.method === 'POST') {
      try {
        var body = await request.json();
        var messages = body.messages || [];
        var models = body.models || ['cerebras-gemma4','nvidia-nemotron','deepseek-r1'];
        var synthesise = body.synthesise !== false;

        // Load KV secrets
        var kvRaw = null;
        try { kvRaw = await env.PRISM_KV.get('__secrets__'); } catch(e) {}
        var kvSecrets = {};
        if (kvRaw) { try { kvSecrets = JSON.parse(kvRaw); } catch(e) {} }
        var envPlus = new Proxy(env, {
          get: function(target, prop) {
            if (target[prop] !== undefined) return target[prop];
            if (kvSecrets[prop] !== undefined) return kvSecrets[prop];
            if (kvSecrets[prop.toUpperCase()] !== undefined) return kvSecrets[prop.toUpperCase()];
            if (kvSecrets[prop.toLowerCase()] !== undefined) return kvSecrets[prop.toLowerCase()];
            return undefined;
          }
        });

        var MODEL_MAP = {
          'cerebras-gemma4':  function(m) { return callCerebras(envPlus, m, 'gemma-4-9b-it'); },
          'cerebras-gemma4-27': function(m) { return callCerebras(envPlus, m, 'gemma-4-27b-it'); },
          'nvidia-nemotron':  function(m) { return callNvidia(envPlus, m, 'nvidia/llama-3.1-nemotron-ultra-253b-v1'); },
          'deepseek-r1':      function(m) { return callDeepSeek(envPlus, m, 'deepseek-reasoner'); },
          'deepseek-v3':      function(m) { return callDeepSeek(envPlus, m, 'deepseek-chat'); },
          'groq-gemma2':      function(m) { return callGroq(envPlus, m, 'gemma2-9b-it'); },
          'groq-llama':       function(m) { return callGroq(envPlus, m, 'llama-3.3-70b-versatile'); },
          'gemini':           function(m) { return callGemini(envPlus, m, 'gemini-2.0-flash'); },
          'mistral':          function(m) { return callMistral(envPlus, m, null); },
        };

        // Run all models in parallel
        var promises = models.map(function(modelId) {
          var fn = MODEL_MAP[modelId];
          if (!fn) return Promise.resolve({model: modelId, content: null, error: 'Unknown model'});
          return fn(messages).then(function(content) {
            return {model: modelId, content: stripTropes(content), error: null};
          }).catch(function(e) {
            return {model: modelId, content: null, error: e.message};
          });
        });

        var responses = await Promise.all(promises);
        var successful = responses.filter(function(r) { return r.content; });

        // Synthesise if requested and we have multiple responses
        var synthesis = null;
        if (synthesise && successful.length > 1) {
          var synthContext = successful.map(function(r) {
            return '## ' + r.model + '\n' + r.content;
          }).join('\n\n');
          var synthMessages = [
            {role:'system', content:'You are a synthesis engine. You have received responses from multiple AI models to the same prompt. Synthesise the key insights, note where models agree and disagree, and produce a single authoritative response. British English. No sycophancy. Be direct.'},
            {role:'user', content:'Synthesise these responses:\n\n' + synthContext}
          ];
          try {
            synthesis = await callNvidia(envPlus, synthMessages, 'nvidia/llama-3.1-nemotron-ultra-253b-v1');
            synthesis = stripTropes(synthesis);
          } catch(e) {
            try { synthesis = await callCerebras(envPlus, synthMessages, 'gemma-4-27b-it'); synthesis = stripTropes(synthesis); } catch(e2) {}
          }
        }

        return json({responses: responses, synthesis: synthesis, modelsUsed: models}, 200, origin);
      } catch(e) {
        return json({error: e.message}, 500, origin);
      }
    }

    return json({error:'Not found', path:path}, 404, origin);
  }
};
// This file is complete — the append below adds the RSS endpoint
// (appended at build time, not runtime)
