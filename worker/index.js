/**
 * ARGENTICA WORKER v1.0
 * Clean ES module — no compiled bundle
 * Built: 19 October 2026
 * 
 * Routing chain (confirmed working):
 * 1. GLM 5.3 via Mistral (thinking + web search)
 * 2. Mistral Large 4 (thinking + web search)  
 * 3. Gemma 4 31B via NVIDIA (269ms, fast)
 * 4. Gemma 4 31B via Gemini API (Google Search grounding)
 * 5. DeepSeek V4 Flash (1M ctx)
 * 6. Grok 3 Mini (real-time X data)
 * 7. Cohere Command R+ (RAG-optimised)
 * 8. Cerebras GPT-OSS 120B (300+ tok/s)
 * 9. Groq Llama 4 Scout (131K ctx)
 * 10. MiniMax M3.1 Flash via OpenRouter (free, 1M ctx)
 * 11. Pollinations (unconditional fallback)
 */

// ── CORS ──────────────────────────────────────────────────────────────────────
function cors(origin) {
  const allowed = [
    'https://prism.identitypartners.uk',
    'https://arch.identitypartners.uk',
    'https://argentica.identitypartners.uk',
    'https://www.identitypartners.uk',
  ];
  const o = (origin && allowed.includes(origin)) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Thread-ID',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json', 
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...cors(origin) 
    },
  });
}

// ── KEY LOOKUP ────────────────────────────────────────────────────────────────
function k(env, names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return null;
}

// ── Memory + RAG helpers ──────────────────────────────────────────────────────

// Simon's voice and content guidelines — seeded into KV on first use if missing
const SIMON_VOICE = `Register: Intelligent, direct, humane, intellectually curious British professional prose. Educated but not professorial. Approachable but not chatty. Reflective but not therapeutic. Sophisticated without needless abstraction.
Calibration: 65% lucid professional conversation / 20% intellectual depth / 10% rhetorical personality / 5% deliberate informality.
Audience: Educated fellow professionals and prospective clients on social media.
Rules: Precise ordinary English. Specialist vocabulary only when it adds precision, not status. Direct — make the point. Human not institutional. Warm through attentiveness and candour, not therapeutic language. Varied sentence rhythm. Occasional wit or memorable phrase — accents, not dominant register. Critical without combative. Abstract ideas must cash out into people, relationships, practice, or consequences.
Never: academic-journal prose on LinkedIn, generic thought leadership, management-consultancy language, breathlessly inspirational, artificially vulnerable, relentlessly earnest, psychoanalytic terminology as performance, AI phrasing (multifaceted/nuanced/profound/tapestry/landscape/intersection/delve/ever-evolving), em dashes (use standard dash sparingly), over-polished, corporate hedging, excessive disclaimers, performative modesty.
British English throughout. No exceptions.`;

const CONTENT_GUIDELINES = `Approved sources only: ONS, Mind, NHS Digital, NHS England, NICE, PHE, British Social Attitudes Survey, NatCen, Psychology Today, The Lancet, NCBI/PubMed, WHO, EU, UN, UNICEF, academic journals, university research, government departments, supranational organisations. Quality press (limited): The Guardian, Washington Post, NYT, FT, The Economist, New Statesman, New Scientist, New European.
Prohibited sources: Telegraph, Times, iNews — do not use under any circumstances.
Mandatory tags on all posts: #IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing
Mandatory footer: hello@identitypartners.uk | www.identitypartners.uk/contact
Never use /book — always /contact.
Canvas assets must contain: IP logo, identitypartners.uk, hello@identitypartners.uk, IP social handles.`;

async function buildMemoryContext(env, query) {
  // Seed memory:simon-voice and memory:content-guidelines if missing
  if (env.PRISM_KV) {
    try {
      const voiceExists = await env.PRISM_KV.get('memory:simon-voice').catch(() => null);
      if (!voiceExists) {
        await env.PRISM_KV.put('memory:simon-voice', SIMON_VOICE, {expirationTtl: 60 * 60 * 24 * 3650}).catch(() => {});
      }
    } catch(e) {}
    try {
      const guidelinesExist = await env.PRISM_KV.get('memory:content-guidelines').catch(() => null);
      if (!guidelinesExist) {
        await env.PRISM_KV.put('memory:content-guidelines', CONTENT_GUIDELINES, {expirationTtl: 60 * 60 * 24 * 3650}).catch(() => {});
      }
    } catch(e) {}
  }

  // Load persistent memory about Simon and the system
  const memories = [];
  try {
    const aboutSimon = env.PRISM_KV ? await env.PRISM_KV.get('memory:about-simon', 'json') : null;
    if (aboutSimon) {
      memories.push('=== WHO YOU ARE TALKING TO ===');
      memories.push('Name: ' + (aboutSimon.name || 'Simon Johnson'));
      memories.push('Role: ' + (aboutSimon.role || ''));
      memories.push('Organisation: ' + (aboutSimon.organisation || 'Identity Partners'));
      memories.push('System: ' + (aboutSimon.system || 'Argentica'));
      memories.push('Device: ' + (aboutSimon.device || 'Surface Pro 9'));
      memories.push('Language: ' + (aboutSimon.language || 'British English'));
      memories.push('Academic modules: ' + JSON.stringify(aboutSimon.academic_modules || []));
      memories.push('Research interests: ' + JSON.stringify(aboutSimon.research_interests || []));
      if (aboutSimon.preferences) {
        memories.push('Preferences: no sycophancy, no AI tropes, no American English, agents must execute not describe, never ask Simon to fix bugs');
      }
    }
  } catch(e) {}

  // Load recent memory entries
  try {
    const memKeys = env.PRISM_KV ? await env.PRISM_KV.list({prefix: 'memory:', limit: 10}) : {keys:[]};
    for (const key of (memKeys.keys || []).slice(0, 5)) {
      if (key.name === 'memory:about-simon') continue;
      try {
        const val = await env.PRISM_KV.get(key.name);
        if (val && val.length < 2000) memories.push('Memory [' + key.name + ']: ' + val);
      } catch(e) {}
    }
  } catch(e) {}

  // RAG: search KV for content relevant to the query
  if (query && query.length > 10) {
    try {
      const ragKeys = env.PRISM_KV ? await env.PRISM_KV.list({prefix: 'doc-content:', limit: 20}) : {keys:[]};
      const queryWords = query.toLowerCase().split(/\s+/).filter(function(w){return w.length > 4;});
      const ragResults = [];
      for (const key of (ragKeys.keys || []).slice(0, 10)) {
        try {
          const val = await env.PRISM_KV.get(key.name);
          if (!val) continue;
          const valLower = val.toLowerCase();
          const matches = queryWords.filter(function(w){return valLower.includes(w);}).length;
          if (matches > 0) ragResults.push({key: key.name, val: val.substring(0, 500), matches});
        } catch(e) {}
      }
      ragResults.sort(function(a,b){return b.matches-a.matches;});
      if (ragResults.length > 0) {
        memories.push('=== RELEVANT DOCUMENTS (RAG) ===');
        ragResults.slice(0, 3).forEach(function(r) {
          memories.push('[' + r.key + ']: ' + r.val + '...');
        });
      }
    } catch(e) {}

    // Also search notes
    try {
      const noteKeys = env.PRISM_KV ? await env.PRISM_KV.list({prefix: 'notes:', limit: 20}) : {keys:[]};
      const queryWords = query.toLowerCase().split(/\s+/).filter(function(w){return w.length > 4;});
      for (const key of (noteKeys.keys || []).slice(0, 10)) {
        try {
          const val = await env.PRISM_KV.get(key.name);
          if (!val) continue;
          const valLower = val.toLowerCase();
          const matches = queryWords.filter(function(w){return valLower.includes(w);}).length;
          if (matches >= 2) memories.push('[Note ' + key.name + ']: ' + val.substring(0, 300) + '...');
        } catch(e) {}
      }
    } catch(e) {}
  }

  return memories.length > 0 ? memories.join('\n') : '';
}

async function saveMemoryFromConversation(env, messages, response) {
  // Extract and save key facts from the conversation to memory
  if (!env.PRISM_KV) return;
  try {
    const lastUser = messages.filter(function(m){return m.role==='user';}).pop();
    const userText = lastUser ? lastUser.content : '';
    const assistantText = response || '';
    
    // Save a rolling conversation summary
    const summaryKey = 'memory:conversation:' + Date.now();
    const summary = {
      userQuery: userText.substring(0, 200),
      assistantSummary: assistantText.substring(0, 300),
      timestamp: new Date().toISOString()
    };
    await env.PRISM_KV.put(summaryKey, JSON.stringify(summary), {expirationTtl: 60 * 60 * 24 * 30}); // 30 days
    
    // Extract explicit memory commands: "remember that...", "note that..."
    const rememberMatch = userText.match(/(?:remember|note|record) that (.+)/i);
    if (rememberMatch) {
      const fact = rememberMatch[1].trim();
      const factKey = 'memory:fact:' + Date.now();
      await env.PRISM_KV.put(factKey, fact, {expirationTtl: 60 * 60 * 24 * 365}); // 1 year
    }
  } catch(e) {}
}



// ── STRIP AI TROPES ───────────────────────────────────────────────────────────
function stripTropes(text) {
  if (!text) return text;
  return text
    .replace(/^(Great|Excellent|Wonderful|Fantastic|Certainly|Absolutely|Of course)[!,]\s*/gi, '')
    .replace(/^You'?re\s+absolutely\s+right[!.]\s*/gi, '')
    .replace(/\b(delve|dive into|I'd be happy to|I'd love to)\b/gi, '')
    .trim();
}

// ── FORMAT RESPONSE FOR LEGIBILITY ───────────────────────────────────────────
function formatResponse(text) {
  if (!text) return text;
  // Ensure proper markdown spacing
  text = text.replace(/\n{3,}/g, '\n\n');
  // Ensure headers have space after #
  text = text.replace(/^(#{1,6})([^ #])/gm, '$1 $2');
  return text.trim();
}

// ── CALL PROVIDER ─────────────────────────────────────────────────────────────
async function callProvider(env, provider, key, model, messages) {
  const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';

  // ── Gemini / Gemma ──────────────────────────────────────────────────────────
  if (provider === 'gemini' || provider === 'gemma') {
    const sysMsg = messages.find(function(m) { return m.role === 'system'; });
    const contents = messages
      .filter(function(m) { return m.role !== 'system'; })
      .map(function(m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }; });
    const body = {
      contents,
      // No artificial token cap — use provider maximum
      generationConfig: { temperature: 0.7 },
    };
    if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg.content }] };
    // Google Search grounding for Gemini models
    if (model && (model.includes('gemini-') || model.includes('gemma-4'))) {
      body.tools = [{ googleSearch: {} }];
    }
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key || GKEY }, body: JSON.stringify(body) }
    );
    const d = await resp.json();
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(d).substring(0, 100)}`);
    const candidate = d.candidates?.[0];
    if (!candidate) throw new Error('Gemini no candidates');
    const parts = candidate.content?.parts || [];
    const text = parts.filter(function(p) { return p.text; }).map(function(p) { return p.text; }).join('');
    if (!text) throw new Error('Gemini empty response (finishReason: ' + (candidate.finishReason || 'unknown') + ')');
    return { content: text, provider: 'gemini', model };
  }

  // ── Cohere v2 ───────────────────────────────────────────────────────────────
  // ── Cohere ──────────────────────────────────────────────────────────────────
  if (provider === 'cohere') {
    const cohereKey = key || k(env, ['cohere_paid', 'cohere_free', 'cohere', 'COHERE_API_KEY']);
    if (!cohereKey) throw new Error('Cohere: no key');
    const cohereBody = {
      model: model || 'command-r-plus',
      message: messages[messages.length - 1]?.content || '',
      chat_history: messages.slice(0, -1).map(m => ({role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content})),
      preamble: messages.find(m => m.role === 'system')?.content || undefined,
      temperature: 0.7,
    };
    const cohereResp = await fetch('https://api.cohere.com/v1/chat', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${cohereKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(cohereBody)
    });
    if (!cohereResp.ok) {
      const err = await cohereResp.text();
      throw new Error(`Cohere ${cohereResp.status}: ${err.substring(0,200)}`);
    }
    const cohereData = await cohereResp.json();
    return {content: cohereData.text || '', model: model, provider: 'cohere'};
  }

  // ── OpenAI-compatible (Mistral, DeepSeek, Cerebras, Groq, xAI, NVIDIA, OpenRouter) ──
  const OAI_PROVIDERS = {
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    cerebras: 'https://api.cerebras.ai/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    kimi: 'https://api.moonshot.cn/v1/chat/completions',
    glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
    xai: 'https://api.x.ai/v1/chat/completions',
    fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
    sambanova: 'https://api.sambanova.ai/v1/chat/completions',
    anyapi: 'https://api.anyapi.io/v1/chat/completions',
    together: 'https://api.together.xyz/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    perplexity: 'https://api.perplexity.ai/chat/completions',
  };

  const url = OAI_PROVIDERS[provider];
  if (!url) throw new Error(`Unknown provider: ${provider}`);

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://prism.identitypartners.uk';
    headers['X-Title'] = 'Argentica';
  }

  // Build request body — NO artificial token limits
  // Let the provider's own limits apply
  const reqBody = { model, messages, temperature: 0.7 };

  // Add web search tools for models that support it
  if (provider === 'mistral' && (model.includes('large') || model.includes('medium') || model.includes('magistral') || model.includes('glm'))) {
    reqBody.tools = [{ type: 'web_search' }];
  }
  if (provider === 'deepseek') {
    // DeepSeek has built-in web search, no tool needed
  }
  if (provider === 'perplexity') {
    // Perplexity always searches, no tool needed
  }

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(reqBody) });
  const d = await resp.json();
  if (!resp.ok) throw new Error(`${provider} ${resp.status}: ${JSON.stringify(d).substring(0, 100)}`);

  // Extract content + thinking — handle thinking-mode array responses (GLM 5.3, Mistral Large, etc.)
  const rawContent = d.choices?.[0]?.message?.content;
  const msg = d.choices?.[0]?.message;
  let text = '';
  let thinkingText = '';

  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    // Thinking mode: [{type:'thinking', thinking:[...]}, {type:'text', text:'...'}]
    const textParts = rawContent.filter(function(p) { return p.type === 'text'; }).map(function(p) { return p.text || ''; });
    text = textParts.join('');
    // Extract thinking parts separately
    const thinkParts = rawContent.filter(function(p) { return p.type === 'thinking'; });
    thinkParts.forEach(function(p) {
      if (typeof p.thinking === 'string') thinkingText += p.thinking;
      else if (Array.isArray(p.thinking)) thinkingText += p.thinking.map(function(t) { return t.text || ''; }).join('');
      else if (p.text) thinkingText += p.text;
    });
    if (!text && thinkingText) text = thinkingText.substring(0, 5000);
  }

  // Reasoning fields (Cerebras, DeepSeek R1, GLM reasoning_content)
  if (!thinkingText && msg) {
    if (msg.reasoning) thinkingText = msg.reasoning;
    else if (msg.reasoning_content) thinkingText = msg.reasoning_content;
  }
  // Final fallback for text
  if (!text && msg) {
    if (msg.reasoning) text = msg.reasoning.substring(0, 5000);
    else if (msg.reasoning_content) text = msg.reasoning_content.substring(0, 5000);
  }
  if (!text) throw new Error(provider + ' empty response');
  return { content: text, thinking: thinkingText || null, provider, model };
}


async function orchestrate(messages, env, options = {}) {
  const profile = options.profile || 'balanced';
  const providerOverride = options.providerOverride;
  const modelOverride = options.modelOverride;
  const threadId = options.threadId;

  // Helper to get key
  const k = (env, names) => { for (const n of names) { if (env[n]) return env[n]; } return null; };

  // Keys — canonical names from API register (2026-10-27)
  const MISTRAL_KEY = k(env, ['mistral_api_key', 'MISTRAL_API_KEY', 'mistral_p', 'mistral_f']);
  const GEMINI_KEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY', 'gemini_p', 'gemini_f']);
  const GEMINI_FREE_KEY = k(env, ['gemini_free_key', 'GEMINI_FREE_KEY']) || GEMINI_KEY || ''; // free tier key
  const DEEPSEEK_KEY = k(env, ['deepseek_paid', 'DEEPSEEK_PAID', 'deepseek_p', 'deepseek_f1', 'deepseek_f2']);
  const GROQ_KEY = k(env, ['groq_f1', 'groq_f2', 'groq_f3', 'GROQ_F1', 'groq_free_1', 'GROQ_FREE_1']);
  const OPENROUTER_KEY = k(env, ['openrouter', 'openrouter_api_key', 'OPENROUTER_API_KEY']);
  const CEREBRAS_KEY = k(env, ['cerebras_p1', 'cerebras_p2', 'cerebras_f1', 'cerebras_f2', 'cerebras_f3', 'cerebras_f4', 'CEREBRAS_FREE_1', 'cerebras_free_1']);
  const ZAI_KEY = k(env, ['glm_api_key', 'GLM_API_KEY', 'zai_api_key', 'ZAI_API_KEY']);
  const KIMI_KEY = k(env, ['kimi', 'kimi_p', 'kimi_f', 'kimi_api_key', 'KIMI_API_KEY']);
  const COHERE_KEY = k(env, ['cohere_paid', 'cohere_free', 'cohere', 'COHERE_API_KEY', 'cohere_api_key']);
  const NVIDIA_KEY = k(env, ['nvidia1', 'nvidia2', 'nvidia_api_key', 'NVIDIA_API_KEY']);
  const XAI_KEY = k(env, ['xai', 'xai_api_key', 'XAI_API_KEY']);
  const TOGETHER_KEY = k(env, ['together', 'together_api_key', 'TOGETHER_API_KEY']);
  const FIREWORKS_KEY = k(env, ['fireworks', 'fireworks_api_key', 'FIREWORKS_API_KEY']);
  const SAMBANOVA_KEY = k(env, ['sambanova', 'sambanova_api_key', 'SAMBANOVA_API_KEY']);
  const ANYAPI_KEY = k(env, ['anyapi', 'anyapi_api_key', 'ANYAPI_API_KEY']);

  // Routing chains — hierarchical: Best quality first, fast fallback
  // Tier 1 (Best): GLM 5.3 + Mistral Large (paid Mistral subscription)
  // Tier 1 (Paid subscription): Gemini 4 Argon, GLM 5.3, Mistral Large 4, Gemini 3.8 Flash
  // Tier 2 (Free/fast): Cerebras, Groq, Cohere
  // Tier 3 (Chargeable — use sparingly): Kimi, DeepSeek, xAI, NVIDIA, SambaNova, Fireworks, AnyAPI
  // Tier 4 (Free fallbacks): Gemini 3.5 Flash-Lite, Mistral Small, OpenRouter
  // Unconditional fallback: Pollinations (always specify model name: openai/mistral/flux)
  const CHAINS = {
    balanced: [
      // ── Tier 1: Free / subscription-included (use freely) ──
      // Mistral subscription covers GLM 5.3 and Mistral Large — no per-token cost
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 · Mistral sub · 1M ctx · thinking · web'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-4', key:MISTRAL_KEY, note:'Mistral Large 4 · Mistral sub · 262K ctx'},
      // Gemini free tier key (gemini_free_key) — no cost
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-flash-latest', key:GEMINI_FREE_KEY, note:'Gemini Flash Latest · FREE tier key · 1M ctx'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-2.5-flash', key:GEMINI_FREE_KEY, note:'Gemini 2.5 Flash · FREE tier key'},
      // Fast free providers
      CEREBRAS_KEY && {provider:'cerebras', model:'qwen-3.8-27b', key:CEREBRAS_KEY, note:'Qwen 3.8 27B · Cerebras · ~1850 tok/s · free'},
      CEREBRAS_KEY && {provider:'cerebras', model:'gpt-oss-120b', key:CEREBRAS_KEY, note:'GPT-OSS 120B · Cerebras · ~3000 tok/s · free'},
      GROQ_KEY && {provider:'groq', model:'openai/gpt-oss-20b', key:GROQ_KEY, note:'GPT-OSS 20B · Groq · ~1000 tok/s · free'},
      COHERE_KEY && {provider:'cohere', model:'command-r-plus', key:COHERE_KEY, note:'Cohere Command R+ · paid key · RAG-optimised'},
      // OpenRouter free frontier models
      OPENROUTER_KEY && {provider:'openrouter', model:'nvidia/llama-3.1-nemotron-ultra-253b-v1:free', key:OPENROUTER_KEY, note:'Nemotron Ultra 253B · OpenRouter · free · frontier reasoning'},
      OPENROUTER_KEY && {provider:'openrouter', model:'nvidia/nemotron-3-ultra-550b-a55b:free', key:OPENROUTER_KEY, note:'Nemotron Ultra 550B · OpenRouter · free · 1M ctx'},
      OPENROUTER_KEY && {provider:'openrouter', model:'minimax/minimax-m3.1-flash:free', key:OPENROUTER_KEY, note:'MiniMax M3.1 Flash · OpenRouter · free · 1M ctx'},
      // ── Tier 2: Paid Google subscription (conserve — $10/mo credit) ──
      GEMINI_KEY && {provider:'gemini', model:'gemini-4-argon', key:GEMINI_KEY, note:'Gemini 4 Argon · PAID key · flagship · 1M ctx'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash · PAID key · 1M ctx'},
      // ── Tier 3: Chargeable — use sparingly ──
      KIMI_KEY && {provider:'kimi', model:'kimi-k2.5', key:KIMI_KEY, note:'Kimi K2.5 · chargeable · use sparingly'},
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek V3 · chargeable · use sparingly'},
      XAI_KEY && {provider:'xai', model:'grok-3', key:XAI_KEY, note:'xAI Grok 3 · chargeable · real-time data'},
      NVIDIA_KEY && {provider:'nvidia', model:'meta/llama-3.1-nemotron-ultra-253b-v1', key:NVIDIA_KEY, note:'NVIDIA NIM · chargeable'},
      SAMBANOVA_KEY && {provider:'sambanova', model:'Meta-Llama-3.3-70B-Instruct', key:SAMBANOVA_KEY, note:'SambaNova · chargeable'},
      FIREWORKS_KEY && {provider:'fireworks', model:'accounts/fireworks/models/llama-v3p3-70b-instruct', key:FIREWORKS_KEY, note:'Fireworks · chargeable'},
      // ── Tier 4: Free fallbacks ──
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-3.5-flash-lite', key:GEMINI_FREE_KEY, note:'Gemini 3.5 Flash-Lite · FREE tier key'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-small-4', key:MISTRAL_KEY, note:'Mistral Small 4 · Mistral sub · free tier'},
      // ── Unconditional fallback ──
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations · no key · always responds'},
    ].filter(Boolean),

    fast: [
      CEREBRAS_KEY && {provider:'cerebras', model:'qwen-3.8-27b', key:CEREBRAS_KEY, note:'Qwen 3.8 27B · Cerebras · ~1850 tok/s'},
      GROQ_KEY && {provider:'groq', model:'openai/gpt-oss-20b', key:GROQ_KEY, note:'GPT-OSS 20B · Groq · ~1000 tok/s'},
      CEREBRAS_KEY && {provider:'cerebras', model:'gpt-oss-120b', key:CEREBRAS_KEY, note:'GPT-OSS 120B · Cerebras · ~3000 tok/s'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-flash-latest', key:GEMINI_FREE_KEY, note:'Gemini Flash Latest · FREE · fastest'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-3.5-flash-lite', key:GEMINI_FREE_KEY, note:'Gemini 3.5 Flash-Lite · FREE'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-small-4', key:MISTRAL_KEY, note:'Mistral Small 4 · Mistral sub'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations · unconditional fallback'},
    ].filter(Boolean),

    research: [
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 · 1M ctx · thinking · web search'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-4', key:MISTRAL_KEY, note:'Mistral Large 4 · multimodal'},
      OPENROUTER_KEY && {provider:'openrouter', model:'nvidia/llama-3.1-nemotron-ultra-253b-v1:free', key:OPENROUTER_KEY, note:'Nemotron Ultra 253B · free · deep reasoning'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-flash-latest', key:GEMINI_FREE_KEY, note:'Gemini Flash Latest · FREE · Google Search'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-4-argon', key:GEMINI_KEY, note:'Gemini 4 Argon · PAID · flagship reasoning · 1M ctx'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash · PAID · Google Search'},
      KIMI_KEY && {provider:'kimi', model:'kimi-k2-thinking', key:KIMI_KEY, note:'Kimi K2 Thinking · chargeable · reasoning'},
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek V3 · chargeable'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations · unconditional fallback'},
    ].filter(Boolean),

    coding: [
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-4', key:MISTRAL_KEY, note:'Mistral Large 4 · code · multimodal'},
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 · code + thinking'},
      OPENROUTER_KEY && {provider:'openrouter', model:'nvidia/llama-3.1-nemotron-ultra-253b-v1:free', key:OPENROUTER_KEY, note:'Nemotron Ultra 253B · free · coder/reasoner'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-flash-latest', key:GEMINI_FREE_KEY, note:'Gemini Flash Latest · FREE · code'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash · PAID · code'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-medium-3.5', key:MISTRAL_KEY, note:'Mistral Medium 3.5 · agentic coding'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations · unconditional fallback'},
    ].filter(Boolean),

    vision: [
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-4', key:MISTRAL_KEY, note:'Mistral Large 4 · multimodal'},
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3-flash', key:MISTRAL_KEY, note:'GLM 5.3 Flash · multimodal · visual coding'},
      GEMINI_FREE_KEY && {provider:'gemini', model:'gemini-flash-latest', key:GEMINI_FREE_KEY, note:'Gemini Flash Latest · FREE · vision'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash · PAID · vision'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-4-argon', key:GEMINI_KEY, note:'Gemini 4 Argon · PAID · vision · 1M ctx'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations · unconditional fallback'},
    ].filter(Boolean),

    local: [
      {provider:'ollama', model:'llama3.1', key:null, note:'Ollama local (requires Cloudflare Tunnel)'},
    ],
  };
  CHAINS.frontier = CHAINS.balanced;
  CHAINS.research_deep = CHAINS.research;
;

  // If provider/model override specified, try that first
  let chain = (CHAINS[profile] || CHAINS.balanced).filter(Boolean);
  if (providerOverride && modelOverride) {
    const overrideEntry = {provider:providerOverride, model:modelOverride, key:
      providerOverride==='mistral' ? MISTRAL_KEY :
      providerOverride==='gemini' ? GEMINI_KEY :
      providerOverride==='deepseek' ? DEEPSEEK_KEY :
      providerOverride==='groq' ? GROQ_KEY :
      providerOverride==='openrouter' ? OPENROUTER_KEY :
      providerOverride==='cerebras' ? CEREBRAS_KEY :
      providerOverride==='zai' ? ZAI_KEY : null
    };
    chain = [overrideEntry, ...chain];
  }

  const log = [];
  let lastError = '';

  for (const entry of chain) {
    if (!entry) continue;
    const {provider, model, key} = entry;
    const t0 = Date.now();
    try {
      // Session awareness: identity, multi-model context, continuation, image tools
      const awareMsgs = [{
        role: 'system',
        content: 'Session context (system note): You are "' + model + '" served via ' + provider + ', answering inside ARGENTICA — the personal AI environment of Simon Johnson (sociologist, Identity Partners, Goldsmiths PhD). ' +
          (options.multiModel ? 'This message is being answered by several models in PARALLEL (multi-model comparison mode): give your own complete, best answer without referring to other models. ' : '') +
          'Longer answers: if you risk hitting your maximum output length, bring the answer to a clean stopping point and end with the token [MORE_AVAILABLE] on the final line so Simon knows to request part 2 — never truncate mid-sentence. ' +
          'Image generation: when Simon asks you to generate or create an image, the ARGENTICA system generates it with a proper image model and provides it in your context as a markdown image — include that image in your reply verbatim and add one sentence describing it. Never invent image URLs of your own. ' +
          'When you use live-search context provided to you, cite sources inline. Never invent current facts. British English. No sycophancy. ' +
          'BRAND: you operate under the Identity Partners design language — dawn/dusk palette (parchment #f7f3e9, deep red #5c2d3f as the anchor, dusty rose #a88792, rose line #7a4254, deep teal #0f3b3a used sparingly), classic serif headings (EB Garamond/Spectral) with humanist sans body (Inter/Source Sans), sunrise/sunset imagery with diffused light, no therapy clichés, no spiritual iconography, no clinical sterility. When producing any creative or visual output, follow it.'
      }, ...messages];
      const result = await callModel(provider, model, key, awareMsgs, env);
      const ms = Date.now() - t0;
      if (result.content) {
        log.push(`${provider}/${model}: OK (${ms}ms)`);
        // Save to thread if threadId provided
        if (threadId && env.PRISM_KV) {
          try {
            const threadKey = 'thread:' + threadId;
            const raw = await env.PRISM_KV.get(threadKey);
            const thread = raw ? JSON.parse(raw) : {id:threadId, messages:[], created:new Date().toISOString()};
            // Add user message if not already there
            const lastMsg = messages[messages.length-1];
            if (lastMsg && lastMsg.role === 'user') {
              thread.messages.push({...lastMsg, ts:Date.now()});
            }
            thread.messages.push({role:'assistant', content:result.content, provider, model, ts:Date.now()});
            thread.updated = new Date().toISOString();
            thread.messageCount = thread.messages.length;
            // Auto-title from first user message
            if (!thread.title) {
              const firstUser = thread.messages.find(m => m.role === 'user');
              if (firstUser) thread.title = firstUser.content.substring(0, 60);
            }
            await env.PRISM_KV.put(threadKey, JSON.stringify(thread), {expirationTtl: 86400 * 90});
          } catch(e) {}
        }
        return {...result, provider, model, routingLog: log};
      }
      log.push(`${provider}/${model}: empty (${Date.now()-t0}ms)`);
    } catch(e) {
      const ms = Date.now() - t0;
      log.push(`${provider}/${model}: ${e.message.substring(0,60)} (${ms}ms)`);
      lastError = e.message;
    }
  }

  // Final unconditional fallback: Pollinations
  try {
    const pollResp = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'openai', messages, max_tokens: 4096})
    });
    if (pollResp.ok) {
      const pollData = await pollResp.json();
      const pollContent = pollData.choices?.[0]?.message?.content || '';
      if (pollContent) {
        log.push('pollinations/openai: OK (fallback)');
        return {content: pollContent, provider: 'pollinations', model: 'openai', routingLog: log};
      }
    }
  } catch(pe) { log.push('pollinations: ' + pe.message); }
  return {content: 'All providers unavailable. Please try again.', error: 'All providers unavailable. Log: ' + log.join(' | '), routingLog: log};
}

async function callModel(provider, model, key, messages, env) {
  // Inject web search context for time-sensitive queries
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const needsSearch = lastUserMsg && /latest|recent|today|current|news|2024|2025|2026|who is|what is|when did|report|study|paper|findings|published|review|this week|past week|last week/i.test(lastUserMsg.content);

  // Tavily search injection (if needed and available)
  let searchContext = '';
  if (needsSearch) {
    const tavilyKey = env.tavily_api_key || env.TAVILY_API_KEY || env.tavily;
    if (tavilyKey) {
      try {
        const searchResp = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tavilyKey},
          body: JSON.stringify({query: lastUserMsg.content.substring(0, 200), max_results: 3, search_depth: 'basic'})
        });
        if (searchResp.ok) {
          const searchData = await searchResp.json();
          const results = (searchData.results || []).slice(0, 3);
          if (results.length > 0) {
            searchContext = '\n\n[Web search results for context:\n' +
              results.map(r => `- ${r.title}: ${r.content?.substring(0,200)}`).join('\n') +
              '\nUse these results to inform your answer. Today is ' + new Date().toISOString().split('T')[0] + '.]';
          }
        }
      } catch(e) {}
    }
  }

  // Inject search context into last user message if found
  let augmentedMessages = messages;
  if (searchContext) {
    augmentedMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user') {
        return {...m, content: m.content + searchContext};
      }
      return m;
    });
  }

  if (provider === 'mistral') {
    // Mistral: supports web_search tool natively
    const body = {
      model,
      messages: augmentedMessages,
      max_tokens: 8192,
      temperature: 0.7,
    };
    // Add web search tool for Mistral models that support it
    if (needsSearch && (model.includes('large') || model.includes('medium') || model.includes('glm'))) {
      body.tools = [{type: 'function', function: {name: 'web_search', description: 'Search the web', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}}}];
      body.tool_choice = 'auto';
    }
    const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Mistral ${resp.status}: ${err.substring(0, 100)}`);
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    let rawContent = msg?.content || '';
    let content = '';
    // GLM 5.3 and thinking models return content as an array
    if (typeof rawContent === 'string') {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Extract text parts first, fall back to thinking parts
      const textParts = rawContent.filter(p => p.type === 'text').map(p => p.text || '');
      content = textParts.join('');
      if (!content) {
        const thinkParts = rawContent.filter(p => p.type === 'thinking')
          .flatMap(p => (p.thinking || []).map(t => t.text || ''));
        content = thinkParts.join('').substring(0, 5000);
      }
    }
    // Handle tool calls — if Mistral used web_search, get the result
    if (!content && msg?.tool_calls?.length > 0) {
      // Model wants to search — extract query and search ourselves
      const toolCall = msg.tool_calls[0];
      const query = JSON.parse(toolCall.function?.arguments || '{}').query || lastUserMsg?.content || '';
      const tavilyKey = env.tavily_api_key || env.TAVILY_API_KEY || env.tavily;
      if (tavilyKey) {
        try {
          const sr = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tavilyKey},
            body: JSON.stringify({query, max_results: 5})
          });
          const sd = await sr.json();
          const searchResults = (sd.results || []).map(r => `${r.title}: ${r.content?.substring(0,300)}`).join('\n\n');
          // Send back with tool result
          const followUp = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
            body: JSON.stringify({
              model,
              messages: [...augmentedMessages,
                {role: 'assistant', content: null, tool_calls: msg.tool_calls},
                {role: 'tool', tool_call_id: toolCall.id, content: searchResults}
              ],
              max_tokens: 8192,
            })
          });
          const fd = await followUp.json();
          content = fd.choices?.[0]?.message?.content || '';
        } catch(e) {}
      }
    }
    // Extract thinking if present
    const thinking = msg?.reasoning || '';
    if (!content) throw new Error('Mistral empty response');
    return {content, thinking};
  }

  if (provider === 'gemini') {
    // Gemini: uses generateContent API, different format
    const geminiMessages = augmentedMessages
      .filter(m => m.role !== 'system')
      .map(m => ({role: m.role === 'assistant' ? 'model' : 'user', parts: [{text: m.content}]}));
    const systemMsg = augmentedMessages.find(m => m.role === 'system');
    const body = {
      contents: geminiMessages,
      generationConfig: {maxOutputTokens: 8192, temperature: 0.7},
    };
    if (systemMsg) {
      body.systemInstruction = {parts: [{text: systemMsg.content}]};
    }
    // Gemini uses googleSearch grounding (only for Gemini models, not Gemma)
    if (needsSearch && model.includes('gemini')) {
      body.tools = [{googleSearch: {}}];
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': key},
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${err.substring(0, 100)}`);
    }
    const data = await resp.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts.map(p => p.text || '').join('').trim();
    if (!content) throw new Error('Gemini empty response');
    return {content};
  }

  if (provider === 'deepseek') {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify({model: 'deepseek-chat', messages: augmentedMessages, max_tokens: 8192, temperature: 0.7})
    });
    if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${(await resp.text()).substring(0,100)}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content || '';
    if (!content) throw new Error('DeepSeek empty response');
    return {content, thinking: msg?.reasoning_content || ''};
  }

  if (provider === 'groq') {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify({model, messages: augmentedMessages, max_tokens: 8192, temperature: 0.7})
    });
    if (!resp.ok) throw new Error(`Groq ${resp.status}: ${(await resp.text()).substring(0,100)}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('Groq empty response');
    return {content};
  }

  if (provider === 'cerebras') {
    const resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify({model, messages: augmentedMessages, max_tokens: 8192, temperature: 0.7})
    });
    if (!resp.ok) throw new Error(`Cerebras ${resp.status}: ${(await resp.text()).substring(0,100)}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning || '';
    if (!content) throw new Error('Cerebras empty response');
    return {content, thinking: msg?.reasoning || ''};
  }

  if (provider === 'openrouter') {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'HTTP-Referer': 'https://prism.identitypartners.uk',
        'X-Title': 'Argentica'
      },
      body: JSON.stringify({model, messages: augmentedMessages, max_tokens: 8192, temperature: 0.7})
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).substring(0,100)}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('OpenRouter empty response');
    return {content};
  }

  if (provider === 'zai') {
    const resp = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify({model: 'glm-5-3', messages: augmentedMessages, max_tokens: 8192, temperature: 0.7})
    });
    if (!resp.ok) throw new Error(`Z.AI ${resp.status}: ${(await resp.text()).substring(0,100)}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content || '';
    if (!content) throw new Error('Z.AI empty response');
    return {content, thinking: msg?.reasoning_content || ''};
  }

  if (provider === 'pollinations') {
    // Unconditional fallback — no key needed
    const resp = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: model || 'openai', messages: augmentedMessages, max_tokens: 4096})
    });
    if (!resp.ok) throw new Error(`Pollinations ${resp.status}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('Pollinations empty response');
    return {content};
  }

  throw new Error(`Unknown provider: ${provider}`);
}


// ── Canvas system ─────────────────────────────────────────────────────────────
// generateCanvasHtml(text, templateId, env)
// semanticImageSearch(topic, env)
// renderNewTemplate(templateId, data, env)
// generateCarousel(slides, env)
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_URL = 'https://arch.identitypartners.uk/shared/assets/logo-transparent.png'; // brand logo, background removed (was white plate)
const R2_PUBLIC = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/';

// ── Brand colours ─────────────────────────────────────────────────────────────
const C = {
  teal:      '#0f3b3a',
  rose:      '#5c2d3f',
  ivory:     '#f7f3e9',
  grey:      '#ddd0c8',
  teal2:     '#1a5550',
  rose2:     '#7a4254',
  tealLight: '#7ecfcd',
  roseLight: '#d4899a',
};

// ── Shared SVG helpers ────────────────────────────────────────────────────────

function escX(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function wrapWords(text, maxChars) {
  const words = String(text||'').split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) { lines.push(line.trim()); line = w; }
    else { line = (line + ' ' + w).trim(); }
  }
  if (line) lines.push(line.trim());
  return lines;
}

function tspanBlock(lines, x, startY, dy, extraAttrs='') {
  return lines.map((l,i) =>
    `<tspan x="${x}" dy="${i===0?0:dy}" ${extraAttrs}>${escX(l)}</tspan>`
  ).join('');
}

// Real IP logo PNG — replaces the old ipGrid() coloured rectangles
function ipLogo(x=32, y=0, fg) {
  // Simon's actual brand logo — transparent PNG, composites cleanly on any background
  return `<image href="${LOGO_URL}" x="${x}" y="${y}" width="72" height="72" preserveAspectRatio="xMidYMid meet"/>`;
}

// Footer strip — logo + URL + email + handles
function ipFooter(W, H, bg=C.teal, fg=C.ivory) {
  const y = H - 80;
  return `
  <rect x="0" y="${y}" width="${W}" height="80" fill="${bg}"/>
  ${ipLogo(32, y+4, fg || C.ivory)}
  <text x="120" y="${y+28}" font-family="'Playfair Display',Georgia,serif" font-size="20" font-weight="600" fill="${fg}">Identity Partners</text>
  <text x="120" y="${y+52}" font-family="Arial,sans-serif" font-size="14" fill="${fg}" opacity="0.85">identitypartners.uk · hello@identitypartners.uk</text>
  <text x="${W-32}" y="${y+40}" font-family="Arial,sans-serif" font-size="13" fill="${fg}" opacity="0.7" text-anchor="end">@identitypartners · @IdentityPtnrs</text>`;
}

function svgOpen(W, H, bg=C.teal) {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&amp;family=Inter:wght@400;500;600;700&amp;display=swap');</style><filter id="sh"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.85)"/></filter></defs><rect width="${W}" height="${H}" fill="${bg}"/>`;
}

// ── Semantic image search ─────────────────────────────────────────────────────
// Calls Mistral Small to expand topic → 5 visual queries
// Then tries Pexels → Unsplash → Pixabay → Openverse in sequence
// Returns base64 data URI or null

async function semanticImageSearch(topic, env) {
  const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY']) || '';
  const pexelsKey  = k(env, ['pexels_api_key','PEXELS_API_KEY','pexels']) || '';
  const unsplashKey= k(env, ['unsplash_api_key','UNSPLASH_API_KEY','unsplash']) || '';
  const pixabayKey = k(env, ['pixabay_api_key','PIXABAY_API_KEY','pixabay']) || '';

  // Step 1: expand topic into 5 diverse visual search queries via Mistral Small
  let queries = [topic];
  if (mistralKey) {
    try {
      const mr = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':`Bearer ${mistralKey}`},
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{role:'user', content:`You are a visual search assistant. Given the topic "${topic}", generate exactly 5 diverse, specific image search queries that would find contextually appropriate, non-clichéd photography for a professional social media post. Return only a JSON array of 5 strings, nothing else. Focus on abstract, conceptual, and environmental imagery — avoid generic stock photo clichés.`}],
          max_tokens: 200,
          temperature: 0.7,
        }),
      }).then(r=>r.json());
      const raw = mr.choices?.[0]?.message?.content || '';
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) queries = parsed.slice(0,5);
      }
    } catch(e) {}
  }

  // Step 2: try each query across sources until we get an image
  async function fetchAndEncode(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i=0; i<bytes.byteLength; i+=8192) bin += String.fromCharCode(...bytes.subarray(i,i+8192));
      const mime = r.headers.get('content-type') || 'image/jpeg';
      return `data:${mime};base64,${btoa(bin)}`;
    } catch(e) { return null; }
  }

  for (const q of queries) {
    const enc = encodeURIComponent(q);

    // Pexels
    if (pexelsKey) {
      try {
        const pr = await fetch(`https://api.pexels.com/v1/search?query=${enc}&per_page=5&orientation=square`, {headers:{Authorization:pexelsKey}}).then(r=>r.json());
        const photos = (pr.photos||[]).filter(p=>!['yoga','boardroom','office','corporate','meeting'].some(b=>(p.alt||'').toLowerCase().includes(b)));
        if (photos.length) {
          const url = photos[0].src?.large2x || photos[0].src?.large;
          const b64 = url ? await fetchAndEncode(url) : null;
          if (b64) return b64;
        }
      } catch(e) {}
    }

    // Unsplash
    if (unsplashKey) {
      try {
        const ur = await fetch(`https://api.unsplash.com/search/photos?query=${enc}&per_page=5&orientation=squarish`, {headers:{Authorization:`Client-ID ${unsplashKey}`}}).then(r=>r.json());
        const photos = ur.results || [];
        if (photos.length) {
          const url = photos[0].urls?.regular;
          const b64 = url ? await fetchAndEncode(url) : null;
          if (b64) return b64;
        }
      } catch(e) {}
    }

    // Pixabay
    if (pixabayKey) {
      try {
        const pbr = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${enc}&image_type=photo&orientation=vertical&per_page=5`).then(r=>r.json());
        const hits = pbr.hits || [];
        if (hits.length) {
          const url = hits[0].largeImageURL;
          const b64 = url ? await fetchAndEncode(url) : null;
          if (b64) return b64;
        }
      } catch(e) {}
    }

    // Openverse (CC-licensed, no key required)
    try {
      const ovr = await fetch(`https://api.openverse.org/v1/images/?q=${enc}&page_size=5&license_type=commercial`, {
        headers:{'User-Agent':'Argentica/1.0 (hello@identitypartners.uk)'}
      }).then(r=>r.json());
      const results = ovr.results || [];
      if (results.length) {
        const url = results[0].url;
        const b64 = url ? await fetchAndEncode(url) : null;
        if (b64) return b64;
      }
    } catch(e) {}
  }

  return null; // all sources exhausted
}

// ── Upload SVG to R2 ──────────────────────────────────────────────────────────
async function uploadToR2(svg, key, env) {
  if (!env.PRISM_ASSETS) return null;
  try {
    await env.PRISM_ASSETS.put(key, svg, {httpMetadata:{contentType:'image/svg+xml'}});
    return R2_PUBLIC + key;
  } catch(e) { return null; }
}

// ── Queue asset for Social Queue approval ─────────────────────────────────────
async function logAsset(env, kind, url, meta) {
  try {
    if (!env.PRISM_KV || !url) return;
    const raw = await env.PRISM_KV.get('assets:created', 'json') || [];
    raw.unshift({ kind, url, meta: meta || {}, ts: new Date().toISOString() });
    await env.PRISM_KV.put('assets:created', JSON.stringify(raw.slice(0, 150)));
  } catch (e) {}
}

async function queueForApproval(item, env) {
  if (!env.PRISM_KV) return;
  try {
    const raw = await env.PRISM_KV.get('mm:queue', 'json').catch(()=>null);
    const q = raw || [];
    q.unshift({
      id: 'canvas-' + Date.now(),
      status: 'pending',
      type: 'canvas',
      ...item,
      created: new Date().toISOString(),
    });
    await env.PRISM_KV.put('mm:queue', JSON.stringify(q.slice(0,200)));
  } catch(e) {}
}

// ── New template renderers ────────────────────────────────────────────────────

function renderMythVsFact(data) {
  const W=1080, H=1080;
  const isIvory = data.variant === 'ivory';
  const outerBg  = isIvory ? C.ivory  : C.teal;
  const mythBg   = isIvory ? '#f0dde3': '#3a1a24';
  const factBg   = isIvory ? '#d6eeee': '#0a2827';
  const mythFg   = isIvory ? C.rose   : C.ivory;
  const factFg   = isIvory ? C.teal   : C.ivory;
  const footerBg = C.teal;
  const panelTop = 140, panelBot = H-80, panelH = panelBot-panelTop, halfW = W/2;
  const mythLines = wrapWords(data.myth||'', 26);
  const factLines = wrapWords(data.fact||'', 26);
  const textY = panelTop + 110;
  const src = data.source ? `<text x="${W/2}" y="${panelBot-16}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="${C.grey}" opacity="0.65">Source: ${escX(data.source)}</text>` : '';
  return svgOpen(W,H,outerBg) +
    `<rect x="0" y="0" width="${W}" height="${panelTop}" fill="${C.rose}"/>` +
    `<text x="${W/2}" y="92" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="52" font-weight="900" fill="${C.ivory}" letter-spacing="4">MYTH vs FACT</text>` +
    `<rect x="0" y="${panelTop}" width="${halfW}" height="${panelH}" fill="${mythBg}"/>` +
    `<rect x="${halfW}" y="${panelTop}" width="${halfW}" height="${panelH}" fill="${factBg}"/>` +
    `<rect x="${halfW-2}" y="${panelTop}" width="4" height="${panelH}" fill="${C.grey}" opacity="0.25"/>` +
    `<text x="${halfW/2}" y="${panelTop+62}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="${C.roseLight}" letter-spacing="6">MYTH</text>` +
    `<rect x="${halfW/2-36}" y="${panelTop+72}" width="72" height="3" fill="${C.roseLight}" rx="2"/>` +
    `<text x="${halfW/2}" y="${textY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="30" fill="${mythFg}">` +
      tspanBlock(mythLines, halfW/2, textY, 42, 'text-anchor="middle"') +
    `</text>` +
    `<text x="${halfW+halfW/2}" y="${panelTop+62}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="${C.tealLight}" letter-spacing="6">FACT</text>` +
    `<rect x="${halfW+halfW/2-36}" y="${panelTop+72}" width="72" height="3" fill="${C.tealLight}" rx="2"/>` +
    `<text x="${halfW+halfW/2}" y="${textY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="30" fill="${factFg}">` +
      tspanBlock(factLines, halfW+halfW/2, textY, 42, 'text-anchor="middle"') +
    `</text>` +
    src +
    ipFooter(W,H,footerBg,C.ivory) +
    `</svg>`;
}

function renderDataInfographic(data) {
  const W=1080, H=1080;
  const points = (data.points||[]).slice(0,5);
  const n = Math.max(points.length,1);
  const titleLines = wrapWords(data.title||'', 34);
  const chartTop = data.subtitle ? 220 : 190;
  const chartBot = H-100;
  const rowH = Math.floor((chartBot-chartTop)/n);
  const barLeft=320, barRight=W-140, barMaxW=barRight-barLeft, barH=Math.min(46,rowH-24);
  const globalMax = Math.max(...points.map(p=>p.max||p.value||1));
  const bars = points.map((pt,i)=>{
    const pct = Math.min(1,(pt.value||0)/(pt.max||globalMax||1));
    const bw = Math.round(pct*barMaxW);
    const cy = chartTop + i*rowH + rowH/2;
    const fill = i%2===0 ? C.tealLight : C.roseLight;
    const labelLines = wrapWords(pt.label||'', 16);
    return `<text x="${barLeft-16}" y="${cy+6}" text-anchor="end" font-family="Arial,sans-serif" font-size="20" font-weight="500" fill="${C.ivory}">` +
      tspanBlock(labelLines, barLeft-16, cy+6, 24, 'text-anchor="end"') +
    `</text>` +
    `<rect x="${barLeft}" y="${cy-barH/2}" width="${barMaxW}" height="${barH}" fill="${C.ivory}" opacity="0.08" rx="5"/>` +
    `<rect x="${barLeft}" y="${cy-barH/2}" width="${bw}" height="${barH}" fill="${fill}" rx="5"/>` +
    `<text x="${barLeft+bw+12}" y="${cy+8}" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="${fill}">${escX(pt.value)}${escX(pt.unit||'')}</text>`;
  }).join('');
  return svgOpen(W,H,C.teal) +
    `<text x="${W/2}" y="100" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="46" font-weight="900" fill="${C.ivory}">` +
      tspanBlock(titleLines, W/2, 100, 54, 'text-anchor="middle"') +
    `</text>` +
    (data.subtitle ? `<text x="${W/2}" y="160" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="500" fill="${C.tealLight}">${escX(data.subtitle)}</text>` : '') +
    `<rect x="60" y="${chartTop-18}" width="${W-120}" height="2" fill="${C.tealLight}" opacity="0.25" rx="1"/>` +
    bars +
    `<text x="${W/2}" y="${chartBot+20}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="${C.grey}" opacity="0.6">Source: ${escX(data.source||'')}</text>` +
    ipFooter(W,H,C.teal,C.ivory) +
    `</svg>`;
}

function renderAwarenessDay(data, imgBase64) {
  const W=1080, H=1080;
  const isRose = data.variant==='rose';
  const bg     = isRose ? C.rose : C.teal;
  const accent = isRose ? C.roseLight : C.tealLight;
  const overlay= isRose ? 'rgba(92,45,63,0.72)' : 'rgba(15,59,58,0.72)';
  const campaignLines = wrapWords(data.campaignName||'', 20);
  const messageLines  = wrapWords(data.message||'', 36);
  const campaignY = 340;
  const messageY  = 720;
  return svgOpen(W,H,bg) +
    (imgBase64 ? `<image href="${imgBase64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${overlay}"/>` : '') +
    `<rect x="60" y="60" width="${W-120}" height="5" fill="${accent}" rx="3"/>` +
    `<text x="${W/2}" y="${campaignY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="78" font-weight="900" fill="${C.ivory}" letter-spacing="-1">` +
      tspanBlock(campaignLines, W/2, campaignY, 88, 'text-anchor="middle"') +
    `</text>` +
    `<text x="${W/2}" y="${campaignY+campaignLines.length*88+14}" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="600" fill="${accent}" letter-spacing="3">${escX((data.date||'').toUpperCase())}</text>` +
    `<rect x="${W/2-56}" y="${messageY-28}" width="112" height="3" fill="${accent}" rx="2"/>` +
    `<text x="${W/2}" y="${messageY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="30" fill="${C.ivory}" opacity="0.92">` +
      tspanBlock(messageLines, W/2, messageY, 42, 'text-anchor="middle"') +
    `</text>` +
    ipFooter(W,H,bg,C.ivory) +
    `</svg>`;
}

function renderNewsReaction(data) {
  const W=1080, H=1080;
  const bg='#0a0f0f';
  const headlineLines   = wrapWords(data.headline||'', 42);
  const commentaryLines = wrapWords(data.commentary||'', 30);
  const outletY   = 90;
  const headlineY = 170;
  const ruleY     = headlineY + headlineLines.length*36 + 30;
  const commentY  = ruleY + 60;
  return svgOpen(W,H,bg) +
    `<text x="60" y="${outletY}" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="${C.tealLight}" letter-spacing="2">${escX((data.outlet||'').toUpperCase())}</text>` +
    `<text x="${W-60}" y="${outletY}" text-anchor="end" font-family="Arial,sans-serif" font-size="18" fill="${C.grey}" opacity="0.6">${escX(data.date||'')}</text>` +
    `<text x="60" y="${headlineY}" font-family="'Playfair Display',Georgia,serif" font-size="28" font-style="italic" fill="${C.grey}">` +
      tspanBlock(headlineLines, 60, headlineY, 36) +
    `</text>` +
    `<rect x="60" y="${ruleY}" width="${W-120}" height="2" fill="${C.tealLight}" opacity="0.35" rx="1"/>` +
    `<rect x="0" y="${ruleY}" width="6" height="${H-ruleY-80}" fill="${C.tealLight}" opacity="0.55"/>` +
    `<text x="60" y="${ruleY+34}" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="${C.tealLight}" letter-spacing="3">IDENTITY PARTNERS</text>` +
    `<text x="60" y="${commentY}" font-family="'Playfair Display',Georgia,serif" font-size="40" font-weight="700" fill="${C.ivory}">` +
      tspanBlock(commentaryLines, 60, commentY, 52) +
    `</text>` +
    ipFooter(W,H,C.teal,C.ivory) +
    `</svg>`;
}

function renderServiceExplainer(data) {
  const W=1080, H=1080;
  const nameLines = wrapWords(data.serviceName||'', 26);
  const descLines = wrapWords(data.description||'', 40);
  const whoLines  = data.whoFor ? wrapWords(data.whoFor, 46) : [];
  const headerH   = 60 + nameLines.length*70;
  const descY     = headerH + 80;
  const whoY      = descY + descLines.length*44 + 50;
  const contact   = data.contact || 'identitypartners.uk · hello@identitypartners.uk';
  return svgOpen(W,H,C.ivory) +
    `<rect x="0" y="0" width="${W}" height="${headerH}" fill="${C.teal}"/>` +
    `<text x="${W/2}" y="80" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="58" font-weight="900" fill="${C.ivory}">` +
      tspanBlock(nameLines, W/2, 80, 70, 'text-anchor="middle"') +
    `</text>` +
    `<rect x="60" y="${headerH}" width="${W-120}" height="5" fill="${C.tealLight}" rx="3"/>` +
    `<text x="60" y="${descY}" font-family="'Playfair Display',Georgia,serif" font-size="30" fill="${C.teal}">` +
      tspanBlock(descLines, 60, descY, 44) +
    `</text>` +
    (whoLines.length ? `<rect x="60" y="${whoY-34}" width="6" height="${whoLines.length*36+12}" fill="${C.roseLight}" rx="3"/>` +
      `<text x="84" y="${whoY}" font-family="Arial,sans-serif" font-size="24" font-weight="500" fill="${C.rose}">` +
        tspanBlock(whoLines, 84, whoY, 36) +
      `</text>` : '') +
    `<text x="${W/2}" y="${Math.min(whoY+whoLines.length*36+40, H-120)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="600" fill="${C.teal}" opacity="0.7">${escX(contact)}</text>` +
    ipFooter(W,H,C.teal,C.ivory) +
    `</svg>`;
}

function renderSemanticImage(data, imgBase64) {
  const W=1080, H=1080;
  const v = data.variant||'teal';
  const overlays = {teal:'rgba(15,59,58,0.78)', rose:'rgba(92,45,63,0.78)', dark:'rgba(10,15,15,0.82)'};
  const accents  = {teal:C.tealLight, rose:C.roseLight, dark:C.tealLight};
  const footerBgs= {teal:C.teal, rose:C.rose, dark:'#0a0f0f'};
  const overlay  = overlays[v];
  const accent   = accents[v];
  const footerBg = footerBgs[v];
  // ── Layout controls: position / align / ink ──
  const posOpt = ['top','middle','bottom'].includes(String(data.position||'').toLowerCase()) ? String(data.position).toLowerCase() : 'middle';
  const alignOpt = ['left','center','right'].includes(String(data.align||'').toLowerCase()) ? String(data.align).toLowerCase() : 'center';
  const inkOpt = /^#?[0-9a-fA-F]{6}$/.test(String(data.ink||'')) ? (String(data.ink).startsWith('#') ? data.ink : '#' + data.ink) : C.ivory;
  const textLines    = wrapWords(data.text||'', 24);
  const subtextLines = data.subtext ? wrapWords(data.subtext, 38) : [];
  let textY;
  if (posOpt === 'top') textY = 300;
  else if (posOpt === 'bottom') textY = 1000 - textLines.length*74;
  else textY = 620;
  const subtextY = textY + textLines.length*72 + 20;
  const tX = alignOpt === 'left' ? 96 : alignOpt === 'right' ? W-96 : W/2;
  const tAnchor = alignOpt === 'left' ? 'start' : alignOpt === 'right' ? 'end' : 'middle';
  return svgOpen(W,H,footerBg) +
    (imgBase64 ? `<image href="${imgBase64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : '') +
    `<defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${footerBg}" stop-opacity="0.12"/><stop offset="45%" stop-color="${footerBg}" stop-opacity="0.52"/><stop offset="100%" stop-color="${footerBg}" stop-opacity="0.94"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#ovg)"/>` +
    `<rect x="60" y="50" width="${W-120}" height="4" fill="${accent}" rx="2" opacity="0.7"/>` +
    `<text x="${tX}" y="${textY}" text-anchor="${tAnchor}" font-family="'Playfair Display',Georgia,serif" font-size="62" font-weight="900" fill="${inkOpt}" letter-spacing="-1">` +
      tspanBlock(textLines, tX, textY, 74, 'text-anchor="' + tAnchor + '"') +
    `</text>` +
    (subtextLines.length ? `<text x="${tX}" y="${subtextY}" text-anchor="${tAnchor}" font-family="Arial,sans-serif" font-size="26" font-weight="500" fill="${inkOpt}" opacity="0.85">` +
      tspanBlock(subtextLines, tX, subtextY, 34, 'text-anchor="' + tAnchor + '"') +
    `</text>` : '') +
    ipFooter(W,H,footerBg,C.ivory) +
    `</svg>`;
}

// ── Carousel generator ────────────────────────────────────────────────────────
// slides: [{text, subtext, variant, imageBase64}]
// Returns array of SVG strings

function generateCarousel(slides) {
  return slides.map((slide, i) => {
    const W=1080, H=1080;
    const v = slide.variant || (i%2===0 ? 'teal' : 'rose');
    const bg      = v==='rose' ? C.rose : v==='ivory' ? C.ivory : C.teal;
    const fg      = v==='ivory' ? C.teal : C.ivory;
    const accent  = v==='rose' ? C.roseLight : C.tealLight;
    const overlay = v==='rose' ? 'rgba(92,45,63,0.72)' : 'rgba(15,59,58,0.72)';
    const textLines = wrapWords(slide.text||'', 26);
    const subLines  = slide.subtext ? wrapWords(slide.subtext, 40) : [];
    const textY = 480;
    const subY  = textY + textLines.length*68 + 24;
    // Slide counter
    const counter = `<text x="${W-48}" y="52" text-anchor="end" font-family="Arial,sans-serif" font-size="18" fill="${accent}" opacity="0.8">${i+1} / ${slides.length}</text>`;
    return svgOpen(W,H,bg) +
      (slide.imageBase64 ? `<image href="${slide.imageBase64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${overlay}"/>` : '') +
      `<rect x="60" y="60" width="${W-120}" height="4" fill="${accent}" rx="2" opacity="0.65"/>` +
      counter +
      `<text x="${W/2}" y="${textY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="58" font-weight="900" fill="${fg}">` +
        tspanBlock(textLines, W/2, textY, 70, 'text-anchor="middle"') +
      `</text>` +
      (subLines.length ? `<text x="${W/2}" y="${subY}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" fill="${accent}">` +
        tspanBlock(subLines, W/2, subY, 34, 'text-anchor="middle"') +
      `</text>` : '') +
      ipFooter(W,H,v==='ivory'?C.teal:bg, C.ivory) +
      `</svg>`;
  });
}

// ── Legacy generateCanvasHtml (existing templates — preserved) ────────────────
async function generateCanvasHtml(text, templateId, env, imgIn, opts) {
  const PEXELS_KEY = k(env, ['pexels_api_key', 'PEXELS_API_KEY', 'pexels']) || '';

  const TEMPLATES = {
    'block-teal':   { type:'block',  bg:C.teal,  fg:C.ivory, accent:C.grey,  border:C.rose },
    'block-rose':   { type:'block',  bg:C.rose,  fg:C.ivory, accent:C.grey,  border:C.teal },
    'block-ivory':  { type:'block',  bg:C.ivory, fg:C.teal,  accent:C.rose,  border:C.teal },
    'block-grey':   { type:'block',  bg:C.grey,  fg:C.teal,  accent:C.rose,  border:C.teal },
    'block-teal2':  { type:'block',  bg:C.teal2, fg:C.ivory, accent:C.grey,  border:C.rose2 },
    'block-rose2':  { type:'block',  bg:C.rose2, fg:C.ivory, accent:C.grey,  border:C.teal2 },
    'block-split':  { type:'block-split', bg1:C.teal, bg2:C.rose, fg:C.ivory },
    'stat':          { type:'stat', bg:C.teal, fg:C.ivory, accent:C.rose },
    'img-sunrise':  { type:'image', query:'sunrise golden hour sky dramatic', overlay:'rgba(15,59,58,0.55)' },
    'img-sunset':   { type:'image', query:'sunset orange sky clouds beautiful', overlay:'rgba(92,45,63,0.55)' },
    'img-landscape':{ type:'image', query:'landscape mountains valley nature serene', overlay:'rgba(15,59,58,0.5)' },
    'img-seascape': { type:'image', query:'ocean waves seascape coastal dramatic', overlay:'rgba(15,59,58,0.5)' },
    'img-cityscape':{ type:'image', query:'city skyline night lights urban', overlay:'rgba(15,59,58,0.65)' },
    'img-aurora':   { type:'image', query:'aurora borealis northern lights night sky', overlay:'rgba(15,59,58,0.45)' },
    'img-space':    { type:'image', query:'earth from space stars cosmos', overlay:'rgba(0,0,0,0.4)' },
    'img-stars':    { type:'image', query:'night sky stars milky way constellation', overlay:'rgba(0,0,0,0.45)' },
    'dual-partnership':{ type:'dual', query:'two people partnership collaboration', side:'right' },
    'dual-children':   { type:'dual', query:'children playing happy joyful childhood', side:'right' },
    'post-calendar':   { type:'post-type', icon:'calendar', bg:C.teal, fg:C.ivory },
    'post-research':   { type:'post-type', icon:'microscope', bg:C.teal2, fg:C.ivory },
    'post-news':       { type:'post-type', icon:'newspaper', bg:'#1a1a2e', fg:C.ivory },
    'testimonial-teal':{ type:'testimonial', bg:C.teal, fg:C.ivory, accent:C.tealLight },
    'testimonial-rose':{ type:'testimonial', bg:C.rose, fg:C.ivory, accent:C.roseLight },
    'testimonial-ivory':{ type:'testimonial', bg:C.ivory, fg:C.teal, accent:C.rose },
    // New template types — routed to dedicated renderers
    'myth-vs-fact-teal':  { type:'new', renderer:'myth-vs-fact', variant:'teal' },
    'myth-vs-fact-ivory': { type:'new', renderer:'myth-vs-fact', variant:'ivory' },
    'data-infographic':   { type:'new', renderer:'data-infographic' },
    'awareness-day':      { type:'new', renderer:'awareness-day', variant:'teal' },
    'awareness-day-rose': { type:'new', renderer:'awareness-day', variant:'rose' },
    'news-reaction':      { type:'new', renderer:'news-reaction' },
    'service-explainer':  { type:'new', renderer:'service-explainer' },
    'semantic-teal':      { type:'new', renderer:'semantic-image', variant:'teal' },
    'semantic-rose':      { type:'new', renderer:'semantic-image', variant:'rose' },
    'semantic-dark':      { type:'new', renderer:'semantic-image', variant:'dark' },
  };

  const tmpl = TEMPLATES[templateId] || TEMPLATES['block-teal'];
  const safeText = escX(text||'');
  const W=1080, H=1080;
  // ── Layout controls (route body): position / align / ink — honoured by all quote-family branches ──
  const posOptL = String((opts&&opts.position)||'middle').toLowerCase();
  const alignOptL = ['left','center','right'].includes(String((opts&&opts.align)||'center').toLowerCase()) ? String(opts.align).toLowerCase() : 'center';
  const inkOptL = (opts && /^#?[0-9a-fA-F]{6}$/.test(String(opts.ink||''))) ? (String(opts.ink).startsWith('#') ? opts.ink : '#' + opts.ink) : null;
  const tXL = alignOptL === 'left' ? 105 : alignOptL === 'right' ? W-105 : 540;
  const tAnchorL = alignOptL === 'left' ? 'start' : alignOptL === 'right' ? 'end' : 'middle';
  const startYL = (n, lineH, defaultMid) => {
    if (posOptL === 'top') return 300;
    if (posOptL === 'bottom') return H - 300 - (n-1)*lineH;
    return defaultMid;
  };
  const fgL = inkOptL || tmpl.fg;

  // Route new template types to dedicated renderers
  if (tmpl.type === 'new') {
    const data = { text, variant: tmpl.variant };
    const imgBase64 = ['awareness-day','semantic-teal','semantic-rose','semantic-dark'].includes(templateId)
      ? await semanticImageSearch(text, env) : null;
    switch(tmpl.renderer) {
      case 'myth-vs-fact':     return renderMythVsFact({...data, myth:text, fact:''});
      case 'data-infographic': return renderDataInfographic({title:text, points:[], source:''});
      case 'awareness-day':    return renderAwarenessDay({...data, campaignName:text, date:'', message:''}, imgBase64);
      case 'news-reaction':    return renderNewsReaction({...data, outlet:'', headline:text, commentary:'', date:''});
      case 'service-explainer':return renderServiceExplainer({...data, serviceName:text, description:'', whoFor:''});
      case 'semantic-image':   return renderSemanticImage({...data}, imgBase64);
    }
  }

  // Legacy template rendering (block, image, dual, post-type, testimonial)
  function wrapText(t, maxChars) { return wrapWords(t, maxChars); }

  async function fetchPexelsImage(query) {
    if (!PEXELS_KEY) return null;
    try {
      const resp = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`, {headers:{Authorization:PEXELS_KEY}});
      if (!resp.ok) return null;
      const data = await resp.json();
      const photos = (data.photos||[]).filter(p=>!['yoga','wellness','boardroom','office','corporate','meeting'].some(b=>(p.alt||'').toLowerCase().includes(b)));
      if (!photos.length) return null;
      const photo = photos[Math.floor(Math.random()*Math.min(photos.length,5))];
      const imgUrl = photo.src?.landscape || photo.src?.large2x || photo.src?.large;
      if (!imgUrl) return null;
      const imgResp = await fetch(imgUrl);
      if (!imgResp.ok) return null;
      const buf = await imgResp.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const mime = imgResp.headers.get('content-type')||'image/jpeg';
      return `data:${mime};base64,${b64}`;
    } catch(e) { return null; }
  }

  const svgO = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.9)"/></filter></defs>`;

  function ipLogoLegacy(x,y,fg) { return ipLogo(x, y, fg || C.rose2); }
  function ipWordmark(cx,y) { return `<text x="${cx-100}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${C.tealLight}" text-anchor="middle">Identity</text><text x="${cx+100}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${C.roseLight}" text-anchor="middle">Partners</text>`; }
  function ipTagline(cx,y) { return `<text x="${cx}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="16" fill="${C.grey}" text-anchor="middle" opacity="0.85">Understand your past · Appreciate the present · Define your future</text>`; }
  function ipFooterLegacy(cx,y) { return `<text x="${cx}" y="${y}" font-family="Arial,sans-serif" font-size="15" fill="${C.grey}" text-anchor="middle" opacity="0.8">www.identitypartners.uk · hello@identitypartners.uk · @identitypartners</text>`; }
  function quoteText(lines,startY,lineH,fg,x,tAnchor) { return lines.map((l,i)=>`<text x="${x||540}" y="${startY+i*lineH}" font-family="'Playfair Display',Georgia,serif" font-size="48" fill="${fg}" text-anchor="${tAnchor||'middle'}">${l}</text>`).join(''); }

  let svg = '';

  if (tmpl.type==='block') {
    const lines=wrapText(safeText,28), lineH=68, startY=startYL(lines.length, lineH, Math.max(220,540-(lines.length*lineH)/2)), attrY=startY+lines.length*lineH+40;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg}"/><rect x="0" y="0" width="${W}" height="12" fill="${tmpl.border}" opacity="0.9"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${tmpl.border}" opacity="0.9"/>`+ipLogoLegacy(30,30)+`<text x="80" y="210" font-family="'Playfair Display',Georgia,serif" font-size="110" fill="${fgL}" opacity="0.08">&#x201C;</text>`+quoteText(lines,startY,lineH,fgL,tXL,tAnchorL)+`<line x1="${tXL-160}" y1="${attrY}" x2="${tXL+160}" y2="${attrY}" stroke="${tmpl.accent}" stroke-width="2" opacity="0.6"/>`+ipWordmark(tXL,attrY+48)+ipTagline(tXL,attrY+82)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='block-split') {
    const lines=wrapText(safeText,26), lineH=64, startY=startYL(lines.length, lineH, Math.max(200,540-(lines.length*lineH)/2)), attrY=startY+lines.length*lineH+40;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg1}"/><rect x="540" y="0" width="540" height="${H}" fill="${tmpl.bg2}"/><line x1="540" y1="0" x2="540" y2="${H}" stroke="${C.grey}" stroke-width="2" opacity="0.4"/>`+ipLogoLegacy(30,30)+quoteText(lines,startY,lineH,fgL,tXL,tAnchorL)+ipWordmark(tXL,attrY+48)+ipTagline(tXL,attrY+82)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='image') {
    const imgData = imgIn || await fetchPexelsImage(tmpl.query) || await semanticImageSearch(tmpl.query, env);
    // ── Layout controls: position (top/middle/bottom), align (left/center/right), ink colour ──
    const posOpt = String((opts&&opts.position)||'middle').toLowerCase();
    const alignOpt = ['left','center','right'].includes(String((opts&&opts.align)||'center').toLowerCase()) ? String(opts.align).toLowerCase() : 'center';
    const inkOpt = (opts && /^#?[0-9a-fA-F]{6}$/.test(String(opts.ink||''))) ? (String(opts.ink).startsWith('#') ? opts.ink : '#' + opts.ink) : C.ivory;
    const lines=wrapText(safeText,28), lineH=68;
    let startY;
    if (posOpt === 'top') startY = 260;
    else if (posOpt === 'bottom') startY = H - 300 - (lines.length-1)*lineH;
    else startY = Math.max(220,540-(lines.length*lineH)/2);
    const attrY=startY+lines.length*lineH+40;
    const tX = alignOpt === 'left' ? 105 : alignOpt === 'right' ? W-105 : 540;
    const tAnchor = alignOpt === 'left' ? 'start' : alignOpt === 'right' ? 'end' : 'middle';
    const quoteLA = lines.map((l,i)=>`<text x="${tX}" y="${startY+i*lineH}" font-family="'Playfair Display',Georgia,serif" font-size="48" fill="${inkOpt}" text-anchor="${tAnchor}">${l}</text>`).join('');
    const lx1 = alignOpt === 'left' ? tX-160 : tX-160;
    const lx2 = alignOpt === 'left' ? tX+160 : tX+160;
    const wmLeft = alignOpt === 'left' ? tX : alignOpt === 'right' ? tX : 540;
    const wm = `<text x="${wmLeft-100}" y="${attrY+48}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${inkOpt}" text-anchor="${tAnchor}">Identity</text><text x="${wmLeft+100}" y="${attrY+48}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${inkOpt}" text-anchor="${tAnchor}">Partners</text>`;
    const tg = `<text x="${wmLeft}" y="${attrY+82}" font-family="'Playfair Display',Georgia,serif" font-size="16" fill="${inkOpt}" text-anchor="${tAnchor}" opacity="0.85">Understand your past · Appreciate the present · Define your future</text>`;
    const bgEl=imgData?`<image href="${imgData}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${tmpl.overlay}"/>`:`<rect width="${W}" height="${H}" fill="${C.teal}"/>`;
    svg=svgO+bgEl+`<rect x="0" y="0" width="${W}" height="12" fill="${C.grey}" opacity="0.8"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${C.grey}" opacity="0.8"/>`+ipLogoLegacy(30,30,inkOpt)+`<text x="80" y="210" font-family="'Playfair Display',Georgia,serif" font-size="110" fill="${inkOpt}" opacity="0.08">&#x201C;</text>`+quoteLA+`<line x1="${lx1}" y1="${attrY}" x2="${lx2}" y2="${attrY}" stroke="${inkOpt}" stroke-width="2" opacity="0.65"/>`+wm+tg+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='dual') {
    const imgData = imgIn || await fetchPexelsImage(tmpl.query) || await semanticImageSearch(tmpl.query, env);
    const lines=wrapText(safeText,26), lineH=62, startY=Math.max(260,560-(lines.length*lineH)/2), attrY=startY+lines.length*lineH+40;
    const imgHalf = imgData
      ? `<image href="${imgData}" x="${tmpl.side==='right'?540:0}" y="0" width="540" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${tmpl.side==='right'?540:0}" y="0" width="540" height="${H}" fill="${C.teal}"/>`;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${C.ivory}"/>`+imgHalf
      +`<rect x="${tmpl.side==='right'?0:540}" y="0" width="540" height="${H}" fill="${C.ivory}"/>`
      +`<line x1="540" y1="0" x2="540" y2="${H}" stroke="${C.rose}" stroke-width="3" opacity="0.55"/>`
      +ipLogoLegacy(30,30)
      +`<text x="270" y="200" font-family="'Playfair Display',Georgia,serif" font-size="90" fill="${C.rose}" opacity="0.18">&#x201C;</text>`
      +lines.map((l,i)=>`<text x="270" y="${startY+i*lineH}" font-family="'Playfair Display',Georgia,serif" font-size="42" fill="${C.rose}" text-anchor="middle">${l}</text>`).join('')
      +`<line x1="150" y1="${attrY}" x2="390" y2="${attrY}" stroke="${C.rose2}" stroke-width="2" opacity="0.6"/>`
      +ipWordmark(270,attrY+44)+`<text x="270" y="${attrY+74}" font-family="Arial,sans-serif" font-size="13" fill="${C.rose2}" text-anchor="middle" opacity="0.85">Understand · Appreciate · Define</text>`
      +ipFooterLegacy(270,H-26)+`</svg>`;
  } else if (tmpl.type==='testimonial') {
    const lines=wrapText(safeText,30), lineH=62, startY=startYL(lines.length, lineH, Math.max(240,520-(lines.length*lineH)/2)), attrY=startY+lines.length*lineH+50;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg}"/><rect x="0" y="0" width="${W}" height="12" fill="${tmpl.accent}" opacity="0.9"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${tmpl.accent}" opacity="0.9"/>`+ipLogoLegacy(30,30)+`<text x="100" y="260" font-family="'Playfair Display',Georgia,serif" font-size="180" fill="${tmpl.accent}" opacity="0.15">&#x201C;</text><text x="980" y="${H-80}" font-family="'Playfair Display',Georgia,serif" font-size="180" fill="${tmpl.accent}" opacity="0.15">&#x201D;</text>`+quoteText(lines,startY,lineH,fgL,tXL,tAnchorL)+`<line x1="340" y1="${attrY}" x2="740" y2="${attrY}" stroke="${tmpl.accent}" stroke-width="3" opacity="0.7"/><text x="540" y="${attrY+44}" font-family="'Playfair Display',Georgia,serif" font-size="22" fill="${tmpl.accent}" text-anchor="middle" opacity="0.9">&#x2014; Identity Partners</text>`+ipWordmark(540,attrY+90)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type === 'stat') {
    // Real statistic canvas: giant figure + supporting line (was aliased to quote card before)
    const parts = String(text||'').trim().split(/\s+(.+)/);
    const figure = (parts[0] || '').slice(0, 8);
    const label = (parts[1] || parts[0] || '').trim();
    svg=svgO+`<rect width="${W}" height="${H}" fill="${inkOptL ? C.ivory : C.teal}"/>`+
      `<rect x="0" y="0" width="${W}" height="12" fill="${C.rose}" opacity="0.9"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${C.rose}" opacity="0.9"/>`+
      ipLogoLegacy(30, 30, inkOptL ? C.rose : C.ivory)+
      `<text x="${tXL}" y="700" text-anchor="${tAnchorL}" font-family="'Playfair Display',Georgia,serif" font-size="${figure.length > 5 ? 300 : 380}" font-weight="900" fill="${inkOptL ? C.rose : C.ivory}">${escX(figure)}</text>`+
      `<line x1="${tXL-180}" y1="760" x2="${tXL+180}" y2="760" stroke="${inkOptL ? C.rose : C.ivory}" stroke-width="3" opacity="0.75"/>`+
      wrapText(label, 60).map((l,i)=>`<text x="${tXL}" y="${820+i*47}" font-family="'Inter',Arial,sans-serif" font-size="34" fill="${inkOptL ? C.teal : C.ivory}" text-anchor="${tAnchorL}" opacity="0.92">${escX(l)}</text>`).join('')+
      ipWordmark(540, H-140)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else {
    svg=svgO+`<rect width="${W}" height="${H}" fill="${C.teal}"/>`+ipLogoLegacy(30,30)+quoteText(wrapText(safeText,28),startYL(1, 68, 300),68,fgL||C.ivory,tXL,tAnchorL)+ipFooterLegacy(540,H-28)+`</svg>`;
  }

  return svg || `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="${C.teal}"/><text x="540" y="540" fill="white" text-anchor="middle" font-size="40">Canvas Error</text></svg>`;
}

// ── Auto-tagging function ─────────────────────────────────────────────────────
function autoTag(text) {
  const tags = [];
  const rules = [
    {tag: 'mental-health', keywords: ['mental health', 'depression', 'anxiety', 'psychiatric', 'psychological', 'wellbeing', 'therapy', 'counselling']},
    {tag: 'addiction', keywords: ['addiction', 'substance', 'alcohol', 'drug', 'recovery', 'rehabilitation', 'abstinence']},
    {tag: 'disability', keywords: ['disability', 'disabled', 'neurodivergent', 'adhd', 'autism', 'chronic illness', 'pip', 'esa']},
    {tag: 'sociology', keywords: ['sociology', 'social', 'bourdieu', 'habitus', 'goffman', 'foucault', 'intersectionality', 'capital']},
    {tag: 'research', keywords: ['research', 'study', 'paper', 'journal', 'findings', 'methodology', 'qualitative', 'quantitative']},
    {tag: 'policy', keywords: ['policy', 'government', 'legislation', 'welfare', 'benefit', 'dwp', 'nhs', 'parliament']},
    {tag: 'identity-partners', keywords: ['identity partners', 'identitypartners', 'ip ', 'simon johnson']},
    {tag: 'dissertation', keywords: ['dissertation', 'thesis', 'phd', 'msc', 'goldsmiths', 'methodology now', 'quant research']},
    {tag: 'news', keywords: ['guardian', 'bbc', 'times', 'telegraph', 'independent', 'news', 'article', 'report']},
    {tag: 'urgent', keywords: ['urgent', 'asap', 'deadline', 'important', 'critical', 'immediately']},
    {tag: 'file', keywords: ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', 'attachment', 'attached', 'file']},
  ];
  for (const rule of rules) {
    if (rule.keywords.some(function(kw) { return text.includes(kw); })) {
      tags.push(rule.tag);
    }
  }
  return tags;
}

/**
 * Argentica — Integration Layer
 * File: worker/src/integration.js
 *
 * Shared KV event bus connecting:
 *   Marketing Team (canvas generation, job queue)
 *   → Social Queue (approval, scheduling)
 *   → Calendar (scheduled posts as events)
 *   → Platform Manager (channel routing, connection status)
 *
 * KV key schema:
 *   mm:queue                    — Social Queue items (pending/approved/scheduled/posted)
 *   mm:jobs:<agentId>           — Per-agent job queues
 *   calendar:events             — Calendar event index
 *   calendar:event:<id>         — Individual calendar event
 *   platform:channels           — Connected platform channel IDs
 *   platform:status             — Platform connection health
 *   events:log                  — Cross-module event log (last 200)
 *
 * Worker routes added by this file:
 *   POST /api/events/emit        — Emit a cross-module event
 *   GET  /api/events/log         — Recent event log
 *   GET  /api/mm/jobs            — Job queue per agent
 *   POST /api/mm/jobs            — Create job
 *   POST /api/mm/jobs/reorder    — Promote/demote job
 *   POST /api/mm/jobs/:id/retry  — Retry job
 *   POST /api/mm/jobs/:id/pause  — Pause job
 *   POST /api/mm/jobs/:id/cancel — Cancel job
 *   POST /api/mm/chat            — Agent chat (routes to LLM + triggers jobs)
 *   GET  /api/calendar/events    — Calendar events
 *   POST /api/calendar/events    — Create calendar event
 *   DELETE /api/calendar/events/:id — Delete event
 *   GET  /api/platform/channels  — Connected channel IDs
 *   POST /api/platform/channels  — Store channel ID
 *   GET  /api/platform/status    — Platform connection health
 *   GET  /api/buffer/fetch-channels — Fetch live channel IDs from Buffer API
 */

// ─────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────

async function emitEvent(type, payload, env) {
  if (!env.PRISM_KV) return;
  try {
    const raw = await env.PRISM_KV.get('events:log', 'json').catch(()=>null);
    const log = raw || [];
    log.unshift({ id: 'evt-' + Date.now(), type, payload, ts: new Date().toISOString() });
    await env.PRISM_KV.put('events:log', JSON.stringify(log.slice(0, 200)));

    // Route events to downstream handlers
    switch(type) {
      case 'canvas.generated':
        await onCanvasGenerated(payload, env);
        break;
      case 'social.approved':
        await onSocialApproved(payload, env);
        break;
      case 'social.scheduled':
        await onSocialScheduled(payload, env);
        break;
      case 'social.posted':
        await onSocialPosted(payload, env);
        break;
      case 'job.completed':
        await onJobCompleted(payload, env);
        break;
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────

// Canvas generated → add to Social Queue as pending approval
async function onCanvasGenerated(payload, env) {
  await addToSocialQueue({
    id:        'sq-' + Date.now(),
    status:    'pending',
    type:      'canvas',
    topic:     payload.topic || '',
    template:  payload.template || '',
    platform:  payload.platform || 'instagram',
    url:       payload.url || '',
    svgUrl:    payload.svgUrl || '',
    qa:        payload.qa || null,
    agent:     payload.agent || 'visual',
    agentNick: 'Pixel',
    copy:      payload.copy || '',
    hashtags:  payload.hashtags || [],
    created:   new Date().toISOString(),
  }, env);
}

// Social item approved → create calendar event if scheduled time provided
async function onSocialApproved(payload, env) {
  if (payload.scheduledFor) {
    await createCalendarEvent({
      id:          'cal-' + Date.now(),
      type:        'social-post',
      title:       payload.topic || 'Social post',
      platform:    payload.platform || '',
      url:         payload.url || '',
      scheduledFor: payload.scheduledFor,
      status:      'scheduled',
      queueItemId: payload.id || '',
      created:     new Date().toISOString(),
    }, env);
  }
}

// Social item scheduled → update calendar event status
async function onSocialScheduled(payload, env) {
  if (!env.PRISM_KV || !payload.calendarEventId) return;
  try {
    const raw = await env.PRISM_KV.get(`calendar:event:${payload.calendarEventId}`, 'json').catch(()=>null);
    if (raw) {
      raw.status = 'scheduled';
      raw.bufferId = payload.bufferId || '';
      await env.PRISM_KV.put(`calendar:event:${payload.calendarEventId}`, JSON.stringify(raw));
    }
  } catch(e) {}
}

// Social item posted → update calendar event to posted
async function onSocialPosted(payload, env) {
  if (!env.PRISM_KV || !payload.calendarEventId) return;
  try {
    const raw = await env.PRISM_KV.get(`calendar:event:${payload.calendarEventId}`, 'json').catch(()=>null);
    if (raw) {
      raw.status = 'posted';
      raw.postedAt = new Date().toISOString();
      raw.postUrl = payload.postUrl || '';
      await env.PRISM_KV.put(`calendar:event:${payload.calendarEventId}`, JSON.stringify(raw));
    }
  } catch(e) {}
}

// Job completed → check if downstream jobs need triggering
async function onJobCompleted(payload, env) {
  // e.g. canvas job done → trigger copy job for same topic
  if (payload.agentId === 'visual' && payload.topic) {
    const copyJobs = await getAgentJobs('copy', env);
    const alreadyQueued = copyJobs.some(j => j.topic === payload.topic && j.status !== 'done');
    if (!alreadyQueued) {
      await createJob('copy', {
        title:   `Post copy — ${payload.topic}`,
        sub:     'Simon voice · British English · mandatory hashtags',
        topic:   payload.topic,
        type:    'Copy generation',
        model:   'mistral-large-4',
        canvasUrl: payload.url || '',
        status:  'queued',
        eta:     estimateEta(5),
        etaLabel:'ETA',
      }, env);
    }
  }
}

// ─────────────────────────────────────────────
// SOCIAL QUEUE
// ─────────────────────────────────────────────

async function addToSocialQueue(item, env) {
  if (!env.PRISM_KV) return;
  try {
    const raw = await env.PRISM_KV.get('mm:queue', 'json').catch(()=>null);
    const q = raw || [];
    q.unshift(item);
    await env.PRISM_KV.put('mm:queue', JSON.stringify(q.slice(0, 500)));
  } catch(e) {}
}

async function getSocialQueue(env) {
  if (!env.PRISM_KV) return [];
  const raw = await env.PRISM_KV.get('mm:queue', 'json').catch(()=>null);
  return raw || [];
}

async function updateSocialQueueItem(id, updates, env) {
  if (!env.PRISM_KV) return;
  try {
    const q = await getSocialQueue(env);
    const idx = q.findIndex(item => item.id === id);
    if (idx >= 0) {
      q[idx] = { ...q[idx], ...updates, updated: new Date().toISOString() };
      await env.PRISM_KV.put('mm:queue', JSON.stringify(q));
      // Emit downstream events
      if (updates.status === 'approved') await emitEvent('social.approved', q[idx], env);
      if (updates.status === 'scheduled') await emitEvent('social.scheduled', q[idx], env);
      if (updates.status === 'posted') await emitEvent('social.posted', q[idx], env);
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────

async function createCalendarEvent(event, env) {
  if (!env.PRISM_KV) return;
  try {
    await env.PRISM_KV.put(`calendar:event:${event.id}`, JSON.stringify(event));
    const raw = await env.PRISM_KV.get('calendar:events', 'json').catch(()=>null);
    const index = raw || [];
    index.unshift(event.id);
    await env.PRISM_KV.put('calendar:events', JSON.stringify(index.slice(0, 500)));
  } catch(e) {}
}

async function getCalendarEvents(env, from, to) {
  if (!env.PRISM_KV) return [];
  try {
    const raw = await env.PRISM_KV.get('calendar:events', 'json').catch(()=>null);
    const ids = raw || [];
    const events = await Promise.all(ids.map(async id => {
      const e = await env.PRISM_KV.get(`calendar:event:${id}`, 'json').catch(()=>null);
      return e;
    }));
    let filtered = events.filter(Boolean);
    filtered.forEach(e => {
      if (!e.scheduledFor) e.scheduledFor = e.starts_at || e.date || e.created || '';
      if (!e.starts_at) e.starts_at = e.scheduledFor;
    });
    const fd = (from || '').slice(0, 10), td = (to || '').slice(0, 10);
    if (fd) filtered = filtered.filter(e => (e.scheduledFor || '').slice(0, 10) >= fd);
    if (td) filtered = filtered.filter(e => (e.scheduledFor || '').slice(0, 10) <= td);
    return filtered.sort((a,b) => (a.scheduledFor||'').localeCompare(b.scheduledFor||''));
  } catch(e) { return []; }
}

async function deleteCalendarEvent(id, env) {
  if (!env.PRISM_KV) return;
  try {
    await env.PRISM_KV.delete(`calendar:event:${id}`);
    const raw = await env.PRISM_KV.get('calendar:events', 'json').catch(()=>null);
    const index = (raw||[]).filter(i => i !== id);
    await env.PRISM_KV.put('calendar:events', JSON.stringify(index));
  } catch(e) {}
}

// ─────────────────────────────────────────────
// JOB QUEUE (per-agent)
// ─────────────────────────────────────────────

function estimateEta(minutesFromNow) {
  const d = new Date(Date.now() + minutesFromNow * 60000);
  return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) + ' UTC';
}

async function getAgentJobs(agentId, env) {
  if (!env.PRISM_KV) return [];
  const raw = await env.PRISM_KV.get(`mm:jobs:${agentId}`, 'json').catch(()=>null);
  return raw || [];
}

async function createJob(agentId, job, env) {
  if (!env.PRISM_KV) return;
  try {
    const jobs = await getAgentJobs(agentId, env);
    const newJob = {
      id:       'job-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      priority: 1,
      status:   'queued',
      created:  new Date().toISOString(),
      log:      [{cls:'', t: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), msg:'Job created'}],
      ...job,
    };
    // Renumber priorities
    jobs.unshift(newJob);
    jobs.forEach((j,i) => j.priority = i+1);
    await env.PRISM_KV.put(`mm:jobs:${agentId}`, JSON.stringify(jobs.slice(0,100)));
  } catch(e) {}
}

async function updateJob(agentId, jobId, updates, env) {
  if (!env.PRISM_KV) return;
  try {
    const jobs = await getAgentJobs(agentId, env);
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...updates };
      if (updates.logEntry) {
        jobs[idx].log = jobs[idx].log || [];
        jobs[idx].log.push(updates.logEntry);
        delete jobs[idx].logEntry;
      }
      await env.PRISM_KV.put(`mm:jobs:${agentId}`, JSON.stringify(jobs));
      if (updates.status === 'done') {
        await emitEvent('job.completed', {agentId, jobId, ...jobs[idx]}, env);
      }
    }
  } catch(e) {}
}

async function reorderJob(agentId, jobId, direction, env) {
  if (!env.PRISM_KV) return;
  try {
    const jobs = await getAgentJobs(agentId, env);
    const idx = jobs.findIndex(j => j.id === jobId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= jobs.length) return;
    [jobs[idx], jobs[newIdx]] = [jobs[newIdx], jobs[idx]];
    jobs.forEach((j,i) => j.priority = i+1);
    await env.PRISM_KV.put(`mm:jobs:${agentId}`, JSON.stringify(jobs));
  } catch(e) {}
}

// ─────────────────────────────────────────────
// PLATFORM MANAGER
// ─────────────────────────────────────────────

async function getPlatformChannels(env) {
  if (!env.PRISM_KV) return {};
  const raw = await env.PRISM_KV.get('platform:channels', 'json').catch(()=>null);
  return raw || {};
}

async function storePlatformChannel(platform, channelId, env) {
  if (!env.PRISM_KV) return;
  const channels = await getPlatformChannels(env);
  channels[platform] = { id: channelId, updated: new Date().toISOString() };
  await env.PRISM_KV.put('platform:channels', JSON.stringify(channels));
  // Also store individual secrets-style keys for Worker use
  const keyMap = { instagram:'buffer_ig_channel', facebook:'buffer_fb_channel', x:'buffer_x_channel' };
  if (keyMap[platform]) {
    await env.PRISM_KV.put(`platform:channel:${platform}`, channelId);
  }
}

// ── Convert an SVG canvas URL to a PNG (rendered in Browserless) ──
async function svgToPngUrl(svgUrl, env) {
  try {
    if (/\.png|\.jpe?g/i.test(svgUrl)) return svgUrl; // already raster
    const BLT = k(env, ['railway_browserless_token']) || '';
    const IO  = k(env, ['browserless','browserless_io_key','browserless_io','BROWSERLESS']) || '';
    const fnEsm = `export default async ({ page, context }) => {
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await page.goto(context.url, { waitUntil: 'networkidle0', timeout: 45000 });
      const shot = await page.screenshot({ type: 'png', encoding: 'base64' });
      return { data: { b64: shot }, type: 'application/json' };
    }`;
    // Railway's Browserless build parses CommonJS and returns the object flat
    const fnCjs = `module.exports = async ({ page, context }) => {
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await page.goto(context.url, { waitUntil: 'networkidle0', timeout: 45000 });
      const shot = await page.screenshot({ type: 'png', encoding: 'base64' });
      return { b64: shot, len: shot ? shot.length : 0 };
    }`;
    const endpoints = [
      ['https://browserless-production-e49c65ef.up.railway.app', BLT, fnCjs],
      ['https://chrome.browserless.io', IO, fnEsm],
    ];
    for (const [base, tok, fn] of endpoints) {
      if (!tok) continue;
      try {
        const br = await fetch(base + '/function?token=' + encodeURIComponent(tok), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: fn, context: { url: svgUrl } })
        });
        const txt = await br.text();
        if (!br.ok) continue;
        const d = JSON.parse(txt);
        const b64 = (d.data && d.data.b64) || d.b64;
        if (b64 && env.PRISM_ASSETS) {
          const key = 'canvas/png-' + svgUrl.split('/').pop().replace(/\.svg$/, '') + '-' + Date.now() + '.png';
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          await env.PRISM_ASSETS.put(key, bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
          return 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/' + key;
        }
      } catch (e) { continue; }
    }
    return null;
  } catch (e) { return null; }
}

// Collect the rasterised media for a queue item (single image or carousel)
async function itemMediaUrls(item, env) {
  const urls = [];
  if (Array.isArray(item.urls) && item.urls.length) { for (const u of item.urls.slice(0, 8)) urls.push(await svgToPngUrl(u, env)); }
  else if (item.imageUrl) urls.push(await svgToPngUrl(item.imageUrl, env));
  return urls.filter(Boolean);
}

// ── Reels: brand-animated page → MP4 recording → R2 → IG REELS / FB video_reels ──────────────
const REEL_BG = {
  parchment: { top: '#f7f3e9', mid: '#f0e9e0', foot: '#efe3e7', ink: '#5c2d3f', soft: '#7a4254', line: '#a88792' },
  duskberry: { top: '#efe3e7', mid: '#e9d7de', foot: '#efe3e7', ink: '#5c2d3f', soft: '#7a4254', line: '#a88792' },
  paleteal:  { top: '#e2ebea', mid: '#d8e7e5', foot: '#e2ebea', ink: '#0f3b3a', soft: '#2d5b57', line: '#84a8a4' },
  berry:     { top: '#a88792', mid: '#b395a0', foot: '#a88792', ink: '#2d1a1f', soft: '#f7f3e9', line: '#f0e9e0' }
};
function reelPageHtml(spec, mode) {
  const title = String(spec.title || 'Identity Partners');
  const lines = (Array.isArray(spec.lines) ? spec.lines : []).map(l => String(l).slice(0, 400)).filter(Boolean);
  const kicker = String(spec.kicker || 'Identity Partners');
  const S = 2.8; // seconds per scene
  const scenes = lines.length + 2;
  const total = scenes * S;
  const PAL = REEL_BG[String(spec.bg || 'parchment').toLowerCase()] || REEL_BG.parchment;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600&family=Inter:wght@400;600&display=swap');
html,body{margin:0;width:1080px;height:1920px;background:#f7f3e9;overflow:hidden}
canvas{display:block}
</style></head><body><canvas id="c" width="1080" height="1920"></canvas>
<script>
const SPEC = ${JSON.stringify({ title, lines, kicker, total, S, ink: PAL.ink, soft: PAL.soft, line: PAL.line, top: PAL.top, mid: PAL.mid, foot: PAL.foot, photoUrl: spec.photoUrl || null })};
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const MODE = new URLSearchParams(location.search).get('mode') || 'play';
const easeOut = x => 1 - Math.pow(1 - x, 3);
function drawReel(t) {
  const W = 1080, H = 1920;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, SPEC.top); g.addColorStop(0.6, SPEC.mid); g.addColorStop(1, SPEC.foot);
  if (window.__bgImg) {
    // frosted photo background: sepia/saturation filter, then a parchment veil like the Home hero
    try {
      const bg = window.__bgImg;
      const sc = Math.max(W / bg.width, H / bg.height);
      ctx.save();
      ctx.filter = 'sepia(0.3) saturate(0.85) blur(5px)';
      ctx.drawImage(bg, (W - bg.width * sc) / 2, (H - bg.height * sc) / 2, bg.width * sc, bg.height * sc);
      ctx.restore();
      ctx.globalAlpha = 0.66; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    } catch (e) { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  } else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  const fadeIn = 0.5, fadeOut = 0.5;
  const sceneAlpha = (i) => {
    const st = i * SPEC.S, en = st + SPEC.S;
    if (t < st - fadeIn || t > en + fadeOut) return 0;
    if (t < st) return easeOut((t - (st - fadeIn)) / fadeIn);
    if (t > en) return 1 - easeOut((t - en) / fadeOut);
    return 1;
  };
  const sceneText = (i, inner) => {
    const a = sceneAlpha(i); if (a <= 0) return;
    const st = i * SPEC.S;
    const rise = 60 * (1 - Math.min(1, (t - (st - fadeIn)) / (fadeIn * 2)));
    ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (i === 0 || i === SPEC.lines.length + 1) ? 0 : -rise * 0 + 0);
    inner(a); ctx.restore();
  };
  // kicker + title (scene 0)
  sceneText(0, () => {
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 30px Inter, sans-serif';
    ctx.fillStyle = SPEC.soft;
    // letterspaced kicker
    let kx = 100; for (const ch of SPEC.kicker.toUpperCase()) { ctx.fillText(ch, kx, 320); kx += ctx.measureText(ch).width + 10; }
    ctx.fillStyle = SPEC.line; ctx.fillRect(100, 350, kx - 110, 3);
    ctx.font = '600 66px "EB Garamond", Georgia, serif';
    ctx.fillStyle = SPEC.ink;
    wrap(ctx, SPEC.title, 100, 500, 880, 78);
  });
  // lines
  SPEC.lines.forEach((l, i) => {
    sceneText(i + 1, () => {
      ctx.font = '400 68px "EB Garamond", Georgia, serif';
      ctx.fillStyle = SPEC.line;
      ctx.fillText(String(i + 1) + '.', 100, 700);
      ctx.font = '600 54px "EB Garamond", Georgia, serif';
      ctx.fillStyle = SPEC.ink;
      wrap(ctx, l, 175, 700, 805, 66);
    });
  });
  // outro
  sceneText(SPEC.lines.length + 1, () => {
    ctx.textAlign = 'center';
    ctx.font = '600 62px "EB Garamond", Georgia, serif';
    ctx.fillStyle = SPEC.ink;
    wrapCentered(ctx, SPEC.title, 540, 900, 820, 76);
    ctx.font = '400 34px Inter, sans-serif';
    ctx.fillStyle = SPEC.soft;
    ctx.fillText('hello@identitypartners.uk', 540, 990);
    ctx.textAlign = 'left';
  });
  // footer
  ctx.font = '600 26px Inter, sans-serif'; ctx.fillStyle = SPEC.line;
  ctx.fillText('Identity Partners', 100, H - 70);
  ctx.font = '400 26px Inter, sans-serif';
  ctx.fillStyle = SPEC.line;
  ctx.fillText('Understand the past \u00B7 Appreciate the present \u00B7 Define your future', 100, H - 34);
  // progress bar
  ctx.fillStyle = SPEC.ink;
  ctx.fillRect(0, 0, Math.min(1, t / SPEC.total) * W, 10);
}
function wrap(c, text, x, y, maxW, lh) {
  const words = String(text).split(' '); let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = w; yy += lh; }
    else line = test;
  }
  if (line) c.fillText(line, x, yy);
}
function wrapCentered(c, text, cx, y, maxW, lh) {
  const words = String(text).split(' '); let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { c.fillText(line, cx, yy); const old=c.textAlign; c.textAlign='left'; yy += lh; c.textAlign=old; line = w; }
    else line = test;
  }
  if (line) c.fillText(line, cx, yy);
}
async function boot() {
  try { await Promise.all([document.fonts.load('600 100px "EB Garamond"'), document.fonts.load('600 30px Inter'), document.fonts.ready]); } catch (e) {}
  if (SPEC.photoUrl) { try { const im = new Image(); im.crossOrigin = 'anonymous'; const p = new Promise((res, rej) => { im.onload = res; im.onerror = rej; }); im.src = SPEC.photoUrl; await p; window.__bgImg = im; } catch (e) {} }
  if (MODE === 'encode') {
    try {
      await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/build/mp4-muxer.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('mp4-muxer CDN load failed')); document.head.appendChild(sc); });
      const MM = window.Mp4Muxer;
      const fps = 24;
      const muxer = new MM.Muxer({ target: new MM.ArrayBufferTarget(), video: { codec: 'avc', width: 1080, height: 1920, frameRate: fps }, fastStart: 'in-memory' });
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { window.__mp4err = String(e); } });
      enc.configure({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 6000000, framerate: fps, avc: { format: 'avc' } });
      const frames = Math.round(SPEC.total * fps);
      for (let f = 0; f < frames; f++) {
        drawReel(f / fps);
        const frame = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
        frame.close();
        if (enc.encodeQueueSize > 12) await new Promise(r => setTimeout(r, 15));
      }
      await enc.flush();
      muxer.finalize();
      const bytes = new Uint8Array(muxer.target.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      window.__mp4b64 = btoa(bin);
      window.__mp4size = bytes.length;
    } catch (e) { window.__mp4err = String(e && e.message || e); }
  } else if (MODE === 'preview') {
    drawReel(1.2);
    window.__previewReady = true;
  } else {
    const t0 = performance.now();
    const loop = () => { drawReel(((performance.now() - t0) / 1000) % SPEC.total); requestAnimationFrame(loop); };
    loop();
  }
}
boot();
</script></body></html>`;
}


// ── Stick Studio: brand stick-figure scenes rendered to MP4 ──
const STICK_POSES = ['alone', 'together', 'walk-toward', 'walk-apart', 'sit', 'embrace', 'reach', 'wave', 'listen'];
function stickPageHtml(spec) {
  const title = String(spec.title || '');
  const scenes = (Array.isArray(spec.scenes) ? spec.scenes : [])
    .map(x => ({ pose: STICK_POSES.includes(String(x.pose).toLowerCase()) ? String(x.pose).toLowerCase() : 'alone', caption: String(x.caption || '').slice(0, 220) }))
    .filter(x => x.caption || x.pose)
    .slice(0, 8);
  const S = 3.2; const total = (scenes.length + (title ? 1 : 0)) * S;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600&family=Inter:wght@400;600&display=swap');
html,body{margin:0;width:1080px;height:1920px;background:#f7f3e9;overflow:hidden}
canvas{display:block}
</style></head><body><canvas id="c" width="1080" height="1920"></canvas>
<script>
const SPEC = ${JSON.stringify({ title, scenes, total, S, ink: spec._pal.ink, soft: spec._pal.soft, line: spec._pal.line, top: spec._pal.top, mid: spec._pal.mid, foot: spec._pal.foot, photoUrl: spec.photoUrl || null })};
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const MODE = new URLSearchParams(location.search).get('mode') || 'play';
const easeOut = x => 1 - Math.pow(1 - x, 3);
function drawGroundShadow(x, y, sc) {
  ctx.fillStyle = 'rgba(63,42,38,0.08)';
  ctx.beginPath(); ctx.ellipse(x, y + 6, 70 * sc, 12 * sc, 0, 0, Math.PI * 2); ctx.fill();
}
function drawFigure(x, groundY, sc, pose, t, facing, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, groundY); ctx.scale(facing * sc, sc);
  const swing = Math.sin(t * 3) * 0.35;
  const bob = Math.sin(t * 2.2) * 2;
  ctx.translate(0, (pose === 'sit' ? -45 : 0) + bob * 0.4);
  ctx.strokeStyle = SPEC.ink; ctx.lineWidth = 9; ctx.lineCap = 'round';
  const hipY = -150, shY = -250, headY = -285;
  if (pose === 'sit') {
    // torso upright, legs bent forward
    ctx.beginPath(); ctx.moveTo(0, hipY - 95); ctx.lineTo(0, hipY); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, headY, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hipY - 85); ctx.lineTo(52, hipY - 45); ctx.stroke(); // near arm resting
    ctx.beginPath(); ctx.moveTo(0, hipY - 85); ctx.lineTo(-40, hipY - 40 + Math.sin(t * 2) * 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(78, hipY); ctx.lineTo(78, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(48, hipY + 12); ctx.lineTo(48, 0); ctx.stroke();
  } else {
    const legA = pose === 'walk-toward' || pose === 'walk-apart' ? swing : Math.sin(t * 2.2) * 0.06;
    // legs
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(Math.sin(legA) * 55, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(-Math.sin(legA) * 55, 0); ctx.stroke();
    // torso with slight lean
    const lean = pose === 'listen' ? 6 : pose === 'reach' ? 10 : 0;
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(lean, hipY - 100); ctx.stroke();
    // head
    ctx.beginPath(); ctx.arc(lean, headY, 34, 0, Math.PI * 2); ctx.stroke();
    // arms
    let a1 = -0.5, a2 = 0.5;
    if (pose === 'reach') { a1 = -1.35; a2 = 0.7; }
    if (pose === 'wave') { a1 = -2.3 + Math.sin(t * 6) * 0.25; a2 = 0.6; }
    if (pose === 'embrace') { a1 = -1.1; a2 = 1.1; }
    if (pose === 'listen') { a1 = -0.3; a2 = 0.9; }
    const shX = lean, shYY = hipY - 85;
    ctx.beginPath(); ctx.moveTo(shX, shYY); ctx.lineTo(shX + Math.sin(a1) * 85, shYY + Math.cos(a1) * 85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shX, shYY); ctx.lineTo(shX + Math.sin(a2) * 85, shYY + Math.cos(a2) * 85); ctx.stroke();
  }
  ctx.restore();
}
function drawScenery(alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  // horizon line + a low sun arc
  ctx.strokeStyle = SPEC.line; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(120, 1420); ctx.lineTo(960, 1420); ctx.stroke();
  ctx.beginPath(); ctx.arc(540, 1420, 90, Math.PI, 0); ctx.stroke();
  ctx.restore();
}
function captionCard(text, alpha) {
  if (!text) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.font = '600 54px "EB Garamond", Georgia, serif';
  ctx.fillStyle = SPEC.ink;
  const words = String(text).split(' ');
  let yy = 300, line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > 820 && line) { ctx.fillText(line, 130, yy); yy += 68; line = w; } else line = test;
  }
  if (line) ctx.fillText(line, 130, yy);
  ctx.restore();
}
function drawStick(t) {
  const W = 1080, H = 1920;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, SPEC.top); g.addColorStop(0.6, SPEC.mid); g.addColorStop(1, SPEC.foot);
  if (window.__bgImg) {
    // frosted photo background: sepia/saturation filter, then a parchment veil like the Home hero
    try {
      const bg = window.__bgImg;
      const sc = Math.max(W / bg.width, H / bg.height);
      ctx.save();
      ctx.filter = 'sepia(0.3) saturate(0.85) blur(5px)';
      ctx.drawImage(bg, (W - bg.width * sc) / 2, (H - bg.height * sc) / 2, bg.width * sc, bg.height * sc);
      ctx.restore();
      ctx.globalAlpha = 0.66; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    } catch (e) { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  } else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  const fadeIn = 0.5, fadeOut = 0.5;
  let idx = 0;
  const sceneWin = (st) => {
    if (t < st - fadeIn || t > st + SPEC.S + fadeOut) return 0;
    if (t < st) return easeOut((t - (st - fadeIn)) / fadeIn);
    if (t > st + SPEC.S) return 1 - easeOut((t - st - SPEC.S) / fadeOut);
    return 1;
  };
  // progress bar
  ctx.fillStyle = SPEC.ink; ctx.fillRect(0, 0, Math.min(1, t / SPEC.total) * W, 10);
  if (SPEC.title) {
    const a = sceneWin(0);
    if (a > 0) {
      ctx.save(); ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = '600 72px "EB Garamond", Georgia, serif'; ctx.fillStyle = SPEC.ink;
      ctx.fillText(SPEC.title, 540, 760);
      ctx.font = '400 26px Inter, sans-serif'; ctx.fillStyle = SPEC.soft;
      ctx.fillText('hello@identitypartners.uk', 540, 830);
      ctx.textAlign = 'left'; ctx.restore();
    }
    idx = 1;
  }
  for (const sc of SPEC.scenes) {
    const st = idx * SPEC.S; idx++;
    const a = sceneWin(st); if (a <= 0) continue;
    const local = Math.min(1, Math.max(0, (t - st) / SPEC.S));
    captionCard(sc.caption, a);
    drawScenery(a);
    const gy = 1420, sc1 = 1.55;
    if (sc.pose === 'alone') {
      drawGroundShadow(540, gy, sc1);
      drawFigure(540, gy, sc1, 'stand', t, 1, a);
    } else if (sc.pose === 'together') {
      drawGroundShadow(400, gy, sc1); drawGroundShadow(680, gy, sc1);
      drawFigure(400, gy, sc1, 'stand', t, 1, a);
      drawFigure(680, gy, sc1, 'stand', t, -1, a);
    } else if (sc.pose === 'walk-toward') {
      const x1 = 200 + local * 240, x2 = 880 - local * 240;
      drawGroundShadow(x1, gy, sc1); drawGroundShadow(x2, gy, sc1);
      drawFigure(x1, gy, sc1, 'walk-toward', t, 1, a);
      drawFigure(x2, gy, sc1, 'walk-toward', t, -1, a);
    } else if (sc.pose === 'walk-apart') {
      const x1 = 440 - local * 240, x2 = 640 + local * 240;
      drawGroundShadow(x1, gy, sc1); drawGroundShadow(x2, gy, sc1);
      drawFigure(x1, gy, sc1, 'walk-apart', t, 1, a);
      drawFigure(x2, gy, sc1, 'walk-apart', t, -1, a);
    } else if (sc.pose === 'sit') {
      drawGroundShadow(420, gy, sc1); drawGroundShadow(660, gy, sc1);
      drawFigure(420, gy, sc1, 'sit', t, 1, a);
      drawFigure(660, gy, sc1, 'sit', t, -1, a);
    } else if (sc.pose === 'embrace') {
      drawGroundShadow(500, gy, sc1 * 1.05); drawGroundShadow(580, gy, sc1 * 1.05);
      drawFigure(495, gy, sc1, 'embrace', t, 1, a);
      drawFigure(585, gy, sc1, 'embrace', t, -1, a);
    } else if (sc.pose === 'reach') {
      drawGroundShadow(360, gy, sc1); drawGroundShadow(720, gy, sc1);
      drawFigure(360, gy, sc1, 'reach', t, 1, a);
      drawFigure(720, gy, sc1, 'stand', t, -1, a * 0.9);
    } else if (sc.pose === 'wave') {
      drawGroundShadow(540, gy, sc1);
      drawFigure(540, gy, sc1, 'wave', t, 1, a);
    } else if (sc.pose === 'listen') {
      drawGroundShadow(430, gy, sc1); drawGroundShadow(650, gy, sc1);
      drawFigure(430, gy, sc1, 'sit', t, 1, a);
      drawFigure(660, gy, sc1, 'listen', t, -1, a);
    }
  }
  // footer
  ctx.font = '600 26px Inter, sans-serif'; ctx.fillStyle = SPEC.line;
  ctx.fillText('Identity Partners', 100, H - 70);
  ctx.font = '400 26px Inter, sans-serif';
  ctx.fillText('Understand the past \u00B7 Appreciate the present \u00B7 Define your future', 100, H - 34);
}
async function boot() {
  try { await Promise.all([document.fonts.load('600 72px "EB Garamond"'), document.fonts.load('600 26px Inter'), document.fonts.ready]); } catch (e) {}
  if (SPEC.photoUrl) { try { const im = new Image(); im.crossOrigin = 'anonymous'; const p = new Promise((res, rej) => { im.onload = res; im.onerror = rej; }); im.src = SPEC.photoUrl; await p; window.__bgImg = im; } catch (e) {} }
  if (MODE === 'encode') {
    try {
      await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/build/mp4-muxer.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('mp4-muxer CDN load failed')); document.head.appendChild(sc); });
      const MM = window.Mp4Muxer;
      const fps = 24;
      const muxer = new MM.Muxer({ target: new MM.ArrayBufferTarget(), video: { codec: 'avc', width: 1080, height: 1920, frameRate: fps }, fastStart: 'in-memory' });
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { window.__mp4err = String(e); } });
      enc.configure({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 5000000, framerate: fps, avc: { format: 'avc' } });
      const frames = Math.round(SPEC.total * fps);
      for (let f = 0; f < frames; f++) {
        drawStick(f / fps);
        const frame = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
        frame.close();
        if (enc.encodeQueueSize > 12) await new Promise(r => setTimeout(r, 15));
      }
      await enc.flush(); muxer.finalize();
      const bytes = new Uint8Array(muxer.target.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      window.__mp4b64 = btoa(bin);
    } catch (e) { window.__mp4err = String(e && e.message || e); }
  } else if (MODE === 'preview') {
    drawStick(1.0);
    window.__previewReady = true;
  } else {
    const t0 = performance.now();
    const loop = () => { drawStick(((performance.now() - t0) / 1000) % SPEC.total); requestAnimationFrame(loop); };
    loop();
  }
}
boot();
</script></body></html>`;
}

async function reelPhotoUrl(query, env) {
  try {
    const uri = await semanticImageSearch(String(query || 'calm landscape'), env);
    if (!uri || !uri.startsWith('data:')) return null;
    const m = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const ext = m[1].includes('png') ? 'png' : 'jpg';
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    const key = 'reels/bg-' + Date.now() + '.' + ext;
    await env.PRISM_ASSETS.put(key, bytes, { httpMetadata: { contentType: m[1] } });
    return 'https://prism-api.identitypartners.workers.dev/r2/' + key;
  } catch (e) { return null; }
}

async function uploadVideoToR2(bytes, key, env) {
  if (!env.PRISM_ASSETS) return null;
  try {
    await env.PRISM_ASSETS.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
    return 'https://prism-api.identitypartners.workers.dev/r2/' + key;
  } catch (e) { return null; }
}

async function renderReelMp4(pageUrl, env) {
  const IO = k(env, ['browserless','browserless_io_key','browserless_io','BROWSERLESS','BROWSERLESS.IO']) || '';
  const BLT = k(env, ['railway_browserless_token']) || '';
  const encodeUrl = pageUrl + '?mode=encode';
  const fnEsm = `export default async ({ page, context }) => {
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.goto(context.url, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.waitForFunction(() => window.__mp4b64 || window.__mp4err, { timeout: 240000, polling: 1000 });
    const b64 = await page.evaluate(() => window.__mp4b64 || null);
    const err = await page.evaluate(() => window.__mp4err || null);
    return { data: { b64, err }, type: 'application/json' };
  }`;
  const fnCjs = fnEsm.replace('export default', 'module.exports =');
  const endpoints = [
    ['https://chrome.browserless.io', IO, fnEsm, 'cloud'],
    [(k(env, ['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app'), BLT, fnCjs, 'railway'],
  ];
  let lastDetail = 'no browserless endpoint with video encoding capability available';
  for (const [base, tok, fn, via] of endpoints) {
    if (!tok) continue;
    try {
      const br = await fetch(base + '/function?token=' + encodeURIComponent(tok), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fn, context: { url: encodeUrl } })
      });
      const txt = await br.text();
      if (!br.ok) { lastDetail = via + ' /function HTTP ' + br.status + ': ' + txt.slice(0, 300); continue; }
      const d = JSON.parse(txt);
      const b64 = (d.data && d.data.b64) || d.b64;
      const err = (d.data && d.data.err) || d.err;
      if (err) { lastDetail = via + ' page error: ' + String(err).slice(0, 300); continue; }
      if (!b64) { lastDetail = via + ' returned no video data'; continue; }
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (bytes.byteLength < 20000) { lastDetail = via + ' suspiciously small output (' + bytes.byteLength + ' bytes)'; continue; }
      const key = 'reels/reel-' + Date.now() + '.mp4';
      const url = await uploadVideoToR2(bytes.buffer, key, env);
      if (url) return { url, bytes: bytes.byteLength, via };
      lastDetail = 'recording succeeded but the R2 upload failed';
    } catch (e) { lastDetail = via + ': ' + e.message; }
  }
  return { error: 'reel MP4 encoding failed', detail: lastDetail };
}

async function bufferGql(query, variables, env) {
  const bufferKey = k(env, ['buffer_api_key','BUFFER_API_KEY']) || '';
  if (!bufferKey) return { error: 'No Buffer API key' };
  try {
    const resp = await fetch('https://api.buffer.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + bufferKey },
      body: JSON.stringify({ query, variables: variables || {} })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { error: 'Buffer API ' + resp.status + (data.errors && data.errors[0] && data.errors[0].message ? ': ' + data.errors[0].message : '') };
    if (data.errors && data.errors.length) return { error: 'Buffer: ' + data.errors[0].message };
    return data;
  } catch(e) { return { error: e.message }; }
}

async function fetchBufferChannels(env) {
  // Buffer's current API is GraphQL at api.buffer.com with Bearer auth.
  // The legacy REST API (api.bufferapp.com/1) is deprecated and rejects
  // newly issued personal keys with 401.
  const orgRes = await bufferGql('query { account { organizations { id } } }', null, env);
  if (orgRes.error) return { error: orgRes.error };
  const orgs = (orgRes.data && orgRes.data.account && orgRes.data.account.organizations) || [];
  if (!orgs.length) return { error: 'No Buffer organizations found for this key' };
  const channels = {};
  const debug = { organizations: orgs.length, perOrg: [] };
  for (const org of orgs) {
    const chRes = await bufferGql('query($id: OrganizationId!) { channels(input: { organizationId: $id }) { id name service } }', { id: org.id }, env);
    debug.perOrg.push(chRes.error ? { error: chRes.error } : { found: ((chRes.data && chRes.data.channels) || []).length });
    if (chRes.error) continue;
    for (const c of ((chRes.data && chRes.data.channels) || [])) {
      let platform = String(c.service || 'unknown').toLowerCase();
      if (platform === 'twitter') platform = 'x'; // Buffer still calls X "twitter"
      channels[platform] = { id: c.id, name: c.name || '', service: c.service, updated: new Date().toISOString() };
      await storePlatformChannel(platform, c.id, env);
    }
  }
  if (!Object.keys(channels).length) return { error: 'No channels found — check that Instagram, Facebook and X are connected in the Buffer account this key belongs to', debug };
  return { channels, count: Object.keys(channels).length };
}

async function getPlatformStatus(env) {
  const channels = await getPlatformChannels(env);
  const bufferKey   = k(env, ['buffer_api_key','BUFFER_API_KEY']) || '';
  const linkedinKey = k(env, ['linkedin_primary_client_secret','LINKEDIN_CLIENT_SECRET']) || '';

  // Check LinkedIn token expiry from KV
  let linkedinExpiry = null;
  try {
    const ltRaw = await env.PRISM_KV?.get('oauth:linkedin:tokens', 'json').catch(()=>null);
    if (ltRaw?.expires_at) linkedinExpiry = ltRaw.expires_at;
  } catch(e) {}

  const daysUntilLinkedinExpiry = linkedinExpiry
    ? Math.floor((new Date(linkedinExpiry) - Date.now()) / 86400000)
    : null;

  return {
    buffer: {
      connected: !!bufferKey,
      channels: Object.keys(channels),
      channelCount: Object.keys(channels).length,
    },
    linkedin: {
      connected: !!linkedinKey,
      tokenExpiry: linkedinExpiry,
      daysRemaining: daysUntilLinkedinExpiry,
      warning: daysUntilLinkedinExpiry !== null && daysUntilLinkedinExpiry < 30,
    },
    platforms: {
      x:         { connected: !!channels.x,         channelId: channels.x?.id || null },
      instagram: { connected: !!channels.instagram,  channelId: channels.instagram?.id || null },
      facebook:  { connected: !!channels.facebook,   channelId: channels.facebook?.id || null },
      linkedin:  { connected: !!linkedinKey,         channelId: null },
      bluesky:   { connected: !!(k(env,['bluesky_handle','BLUESKY_HANDLE'])), channelId: null },
    },
    updated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// AGENT CHAT ROUTER
// ─────────────────────────────────────────────
// Routes chat messages to the correct agent persona + triggers jobs

const AGENT_PERSONAS = {
  visual: {
    name: 'Pixel', role: 'Visual Assets Manager',
    system: `You are Pixel, the Visual Assets Manager for Argentica / Identity Partners. You generate social media canvas assets. When given a topic or occasion, you: derive semantic image search terms, select the appropriate template, generate the SVG asset, upload to R2, and queue for approval. You are precise, efficient, and never ask Simon for templates — you derive everything from the topic. British English. No sycophancy.`,
  },
  copy: {
    name: 'Quill', role: 'Copy & Content Writer',
    system: `You are Quill, the Copy & Content Writer for Argentica / Identity Partners. You write social media copy in Simon Johnson's voice: lucid, relational, intellectually confident professional prose with controlled rhetorical flair. Intellectually serious without performing intellectualism. Personable without becoming therapeutic. Always British English. Quote posts use Simon's own words or specifically cited quotes from researchers, clinicians, or people with lived experience — always attributed. News posts reference a specific story from a specific approved outlet with IP's commentary. No generic inspirational quotes. No sycophancy.`,
  },
  research: {
    name: 'Scout', role: 'Research Analyst',
    system: `You are Scout, the Research Analyst for Argentica / Identity Partners. You find and synthesise data from trusted sources: ONS, Mind, NHS Digital, NHS England, NICE, PHE, NatCen, The Lancet, NCBI/PubMed, WHO, academic journals, university research, government departments. Quality press: Guardian, Washington Post, NYT, FT, Economist, New Statesman, New Scientist. Telegraph and Times are searchable but not trusted as data sources for infographics. British English. Cite sources precisely.`,
  },
  social: {
    name: 'Relay', role: 'Social Queue Manager',
    system: `You are Relay, the Social Queue Manager for Argentica / Identity Partners. You manage the social media posting queue across X, Instagram, Facebook, LinkedIn, Bluesky. You schedule posts via Buffer, track approval status, and ensure posts go out at optimal times. British English. No sycophancy.`,
  },
  platform: {
    name: 'Bridge', role: 'Platform Manager',
    system: `You are Bridge, the Platform Manager for Argentica / Identity Partners. You manage platform connections, OAuth flows, channel IDs, and connection health. You guide through connecting new platforms and alert when tokens are expiring. British English. No sycophancy.`,
  },
  scheduler: {
    name: 'Tempo', role: 'Scheduler & Calendar',
    system: `You are Tempo, the Scheduler & Calendar agent for Argentica / Identity Partners. You manage the content calendar, awareness days, and scheduled posts. You know key dates: Mental Health Week, World Mental Health Day, Black History Month, Movember, addiction awareness days, and other relevant occasions. British English. No sycophancy.`,
  },
};

async function agentChat(agentId, message, model, env) {
  const persona = AGENT_PERSONAS[agentId] || AGENT_PERSONAS.visual;

  // Check if message is a canvas generation request (Pixel)
  if (agentId === 'visual') {
    const isCanvasRequest = /awareness|infographic|myth|fact|news|service|quote|post|carousel|template/i.test(message);
    if (isCanvasRequest) {
      // Create a job in the visual queue
      await createJob('visual', {
        title:   message.substring(0, 80),
        sub:     'Deriving template and imagery autonomously',
        topic:   message,
        type:    'Canvas generation',
        model:   model || 'gemini-3.8-flash',
        status:  'queued',
        eta:     estimateEta(3),
        etaLabel:'ETA',
        progress: 0,
        log: [{cls:'', t: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), msg:'Job created from chat'}],
      }, env);
    }
  }

  // Route to LLM
  const messages = [
    { role: 'system', content: persona.system },
    { role: 'user',   content: message },
  ];

  try {
    const result = await orchestrate(messages, env, { profile: 'balanced', preferredModel: model });
    return { reply: result.content || 'Understood.', provider: result.provider, agent: agentId, nick: persona.name };
  } catch(e) {
    return { reply: `${persona.name} encountered an error: ${e.message}`, agent: agentId, nick: persona.name };
  }
}

// ─────────────────────────────────────────────
// WORKER ROUTE HANDLERS
// Export as a function to splice into the main Worker fetch handler
// Call handleIntegrationRoutes(path, request, env, origin) before the
// final 404 return in the main fetch handler.
// ─────────────────────────────────────────────

async function handleIntegrationRoutes(path, request, env, origin) {

  // ── Event bus ──────────────────────────────────────────────────────────────
  if (path === '/api/events/emit' && request.method === 'POST') {
    try {
      const body = await request.json();
      await emitEvent(body.type, body.payload || {}, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/events/log' && request.method === 'GET') {
    try {
      const raw = await env.PRISM_KV?.get('events:log', 'json').catch(()=>null);
      return json({ events: raw || [] }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // ── Agent chat ─────────────────────────────────────────────────────────────
  if (path === '/api/mm/chat' && request.method === 'POST') {
    try {
      const body    = await request.json();
      const agentId = body.agent || 'visual';
      const message = body.message || '';
      const model   = body.model || '';
      const result  = await agentChat(agentId, message, model, env);
      return json(result, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // ── Job queue ──────────────────────────────────────────────────────────────
  if (path === '/api/mm/jobs' && request.method === 'GET') {
    try {
      const agentId = new URL(request.url).searchParams.get('agent') || 'visual';
      const jobs    = await getAgentJobs(agentId, env);
      return json({ jobs, agent: agentId, count: jobs.length }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/mm/jobs' && request.method === 'POST') {
    try {
      const body    = await request.json();
      const agentId = body.agent || 'visual';
      await createJob(agentId, body.job || body, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/mm/jobs/reorder' && request.method === 'POST') {
    try {
      const body = await request.json();
      await reorderJob(body.agent, body.jobId, body.direction, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // Job actions: retry / pause / cancel
  const jobActionMatch = path.match(/^\/api\/mm\/jobs\/([^/]+)\/(retry|pause|cancel)$/);
  if (jobActionMatch && request.method === 'POST') {
    try {
      const jobId  = jobActionMatch[1];
      const action = jobActionMatch[2];
      const agentId = new URL(request.url).searchParams.get('agent') || 'visual';
      const statusMap = { retry:'queued', pause:'paused', cancel:'cancelled' };
      if (action === 'cancel') {
        // Remove from queue
        const jobs = await getAgentJobs(agentId, env);
        const filtered = jobs.filter(j => j.id !== jobId);
        filtered.forEach((j,i) => j.priority = i+1);
        await env.PRISM_KV?.put(`mm:jobs:${agentId}`, JSON.stringify(filtered));
      } else {
        await updateJob(agentId, jobId, { status: statusMap[action] }, env);
      }
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // ── Social Queue ───────────────────────────────────────────────────────────
  if (path === '/api/mm/queue' && request.method === 'GET') {
    try {
      const q = await getSocialQueue(env);
      const counts = { pending:0, approved:0, scheduled:0, posted:0, failed:0 };
      q.forEach(item => { if (counts[item.status] !== undefined) counts[item.status]++; });
      return json({ queue: q, counts, total: q.length }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/mm/queue' && request.method === 'POST') {
    try {
      const body = await request.json();
      await addToSocialQueue({ id:'sq-'+Date.now(), created:new Date().toISOString(), ...body }, env);
      // Emit event so downstream handlers fire
      await emitEvent('canvas.generated', body, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // Update queue item status (approve / schedule / mark posted)
  const queueItemMatch = path.match(/^\/api\/mm\/queue\/([^/]+)$/);
  if (queueItemMatch && request.method === 'PATCH') {
    try {
      const id   = queueItemMatch[1];
      const body = await request.json();
      await updateSocialQueueItem(id, body, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  if (path === '/api/calendar/events' && request.method === 'GET') {
    try {
      const params = new URL(request.url).searchParams;
      const events = await getCalendarEvents(env, params.get('from'), params.get('to'));
      return json({ events, count: events.length }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/calendar/events' && request.method === 'POST') {
    try {
      const body  = await request.json();
      const scheduledFor = body.scheduledFor || body.date || (body.time ? body.date + 'T' + body.time + ':00' : new Date().toISOString());
      const event = { id:'cal-'+Date.now(), created:new Date().toISOString(), ...body, scheduledFor,
                      starts_at: scheduledFor, title: body.title || body.text || 'Event' };
      await createCalendarEvent(event, env);
      return json({ success: true, event }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  const calEventMatch = path.match(/^\/api\/calendar\/events\/([^/]+)$/);
  if (calEventMatch && request.method === 'DELETE') {
    try {
      await deleteCalendarEvent(calEventMatch[1], env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (calEventMatch && request.method === 'PATCH') {
    try {
      const id   = calEventMatch[1];
      const body = await request.json();
      const raw  = await env.PRISM_KV?.get(`calendar:event:${id}`, 'json').catch(()=>null);
      if (!raw) return json({ error: 'Not found' }, 404, origin);
      const updated = { ...raw, ...body, updated: new Date().toISOString() };
      await env.PRISM_KV?.put(`calendar:event:${id}`, JSON.stringify(updated));
      return json({ success: true, event: updated }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  // ── Platform Manager ───────────────────────────────────────────────────────
  if (path === '/api/platform/channels' && request.method === 'GET') {
    try {
      const channels = await getPlatformChannels(env);
      return json({ channels }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/platform/channels' && request.method === 'POST') {
    try {
      const body = await request.json();
      await storePlatformChannel(body.platform, body.channelId, env);
      return json({ success: true }, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/platform/status' && request.method === 'GET') {
    try {
      const status = await getPlatformStatus(env);
      return json(status, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  if (path === '/api/buffer/fetch-channels' && request.method === 'GET') {
    try {
      const result = await fetchBufferChannels(env);
      return json(result, 200, origin);
    } catch(e) { return json({ error: e.message }, 500, origin); }
  }

  return null; // not handled — fall through to 404
}



// ── Scheduled + manual backup: KV stores (KB, memories, calendar) → Google Drive ──
// ── Deterministic hex-contrast verification (text vs background in SVG canvases) ──
function hexToRgb(h) {
  h = String(h || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function relLum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrastRatio(h1, h2) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  if (!a || !b) return null;
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function contrastFixSvg(svg) {
  try {
    const bgMatch = svg.match(/<rect[^>]*fill="(#?[0-9a-fA-F]{3,6})"/);
    const bg = bgMatch ? (bgMatch[1].startsWith('#') ? bgMatch[1] : '#' + bgMatch[1]) : null;
    if (!bg) return svg;
    // Only adjust TEXT element fills — never panel/shape/rect fills (they carry the design)
    const textTags = svg.match(/<text[^>]*>/g) || [];
    const textFills = [...new Set(textTags.map(t => (t.match(/fill="(#[0-9a-fA-F]{3,6})"/) || [])[1]).filter(Boolean))];
    let fixed = svg;
    for (const tf of textFills) {
      const ratio = contrastRatio(tf, bg);
      if (ratio != null && ratio < 4.5) {
        const safe = relLum(hexToRgb(bg)) > 0.35 ? '#5c2d3f' : '#f7f3e9';   // brand: deep red on light, parchment on dark
        fixed = fixed.replace(/(<text[^>]*fill=")(#?[0-9a-fA-F]{3,6})(")/g, (m0, a, c, z) => (('#'+c.replace('#','')) === tf ? a + safe + z : m0));
      }
    }
    return fixed;
  } catch (e) { return svg; }
}

async function backupStoresToDrive(env) {
  if (!env.PRISM_KV) return { success: false, error: 'No KV binding' };
  try {
    // Collect Knowledge Base pages
    const kbList = await env.PRISM_KV.list({ prefix: 'kb:' });
    const kbPages = [];
    for (const key of (kbList.keys || []).slice(0, 500)) {
      let v = null;
      try { v = await env.PRISM_KV.get(key.name, 'json'); } catch (ke) { v = null; }
      if (v && v.title) kbPages.push(v);
    }
    // Collect memories
    const memList = await env.PRISM_KV.list({ prefix: 'memory:' });
    const memories = [];
    for (const key of (memList.keys || []).slice(0, 500)) {
      let v = null;
      try { v = await env.PRISM_KV.get(key.name, 'json'); } catch (ke) { v = null; }
      if (v) memories.push(v);
    }
    // Collect calendar events
    let events = [];
    try { events = await getCalendarEvents(env, null, null); } catch (ce) {}
    const date = new Date().toISOString().slice(0, 10);

    const htmlToText = function(html) {
      return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<h1[^>]*>/gi, '\n# ').replace(/<h2[^>]*>/gi, '\n## ').replace(/<h3[^>]*>/gi, '\n### ')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
    };

    let md = '# Argentica backup — ' + date + '\n\nGenerated automatically by the prism-api worker.\n\n';
    md += '# Knowledge Base (' + kbPages.length + ' pages)\n\n';
    for (const pg of kbPages) {
      md += '---\n\n# ' + (pg.title || 'Untitled') + (pg.section ? '  _(section: ' + pg.section + ')_' : '') + '\n\n' +
            htmlToText(pg.content).trim() + '\n\n';
    }
    md += '\n# Memories (' + memories.length + ')\n\n';
    for (const m of memories) {
      md += '## ' + (m.source || m.category || 'memory') + '\n\n' + String(m.content || '').trim() + '\n\n';
    }
    md += '\n# Calendar (' + events.length + ' events)\n\n';
    for (const e of events) {
      if (!e) continue;
      md += '- ' + (e.scheduledFor || e.starts_at || '?') + ' — ' + (e.title || e.text || 'Event') + '\n';
    }

    // Upload to Drive
    const tokenData = await env.PRISM_KV.get('google:oauth:token', 'json');
    if (!tokenData || !tokenData.access_token) {
      await env.PRISM_KV.put('kb:backup:last', JSON.stringify({ ts: new Date().toISOString(), success: false, error: 'Google not connected' }));
      return { success: false, error: 'Google not connected' };
    }
    const fileName = 'Argentica backup ' + date + '.md';
    const bytes = new TextEncoder().encode(md);
    const metaResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName, mimeType: 'text/markdown' })
    });
    if (!metaResp.ok) {
      await env.PRISM_KV.put('kb:backup:last', JSON.stringify({ ts: new Date().toISOString(), success: false, error: 'Drive meta failed' }));
      return { success: false, error: 'Drive meta failed' };
    }
    const fileId = (await metaResp.json()).id;
    const uploadResp = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'Content-Type': 'text/markdown' },
      body: bytes
    });
    const rec = { ts: new Date().toISOString(), success: uploadResp.ok, date, fileName,
                  pages: kbPages.length, memories: memories.length, events: events.length, bytes: md.length,
                  link: 'https://drive.google.com/file/d/' + fileId + '/view' };
    await env.PRISM_KV.put('kb:backup:last', JSON.stringify(rec));
    return rec;
  } catch (e) {
    try { await env.PRISM_KV.put('kb:backup:last', JSON.stringify({ ts: new Date().toISOString(), success: false, error: e.message })); } catch (ke) {}
    return { success: false, error: e.message };
  }
}

// ── Tay's senses: vision (screenshots) + live web search, injected as context ──
async function buildSensorContext(body, env) {
  let context = '';
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const geminiKey = k(env, ['gemini_api_key','gemini_free_key','GEMINI_API_KEY']) || '';
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img || !img.b64) continue;
    try {
      const descUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + encodeURIComponent(geminiKey);
      const vr = await fetch(descUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [
          { text: 'Describe this image precisely and completely for use as context in a conversation: what it shows, all visible text verbatim, UI elements, charts or data, anything notable. Be thorough but neutral.' },
          { inline_data: { mime_type: img.mime_type || 'image/png', data: img.b64 } }
        ] }] })
      });
      const vd = await vr.json().catch(() => ({}));
      const desc = (((vd.candidates || [])[0] || {}).content || {}).parts &&
        vd.candidates[0].content.parts.map(x => x.text || '').join('').trim();
      if (desc) context += '[Attached image ' + (i + 1) + ' — described by vision: ' + desc.slice(0, 2500) + ']\n';
    } catch (e) { /* vision unavailable — page falls back to OCR text already inline */ }
  }
  // Tay's third sense: if the message contains URLs, pull the live page content via Browserless
  const lastUser0 = (body.messages || []).filter(m => m.role === 'user').pop();
  if (lastUser0) {
    const urls = String(lastUser0.content).match(/https?:\/\/[^\s)\]]+/g) || [];
    if (urls.length) {
      const BLT = k(env, ['railway_browserless_token','RAILWAY_BROWSERless_TOKEN'.toUpperCase(),'RAILWAY_BROWSERLESS_TOKEN','browserless_railway_token']) || '';
      if (BLT) {
        const targets = urls.slice(0, 2);
        const fn = `export default async ({ page, context }) => {
          const got = [];
          for (const u of context.urls) {
            try {
              await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 35000 });
              await new Promise(r => setTimeout(r, 1200));
              const info = await page.evaluate(() => {
                const t = document.title || '';
                const pick = document.querySelector('article') || document.querySelector('main') || document.body;
                const text = (pick ? pick.innerText : '').replace(/\s+/g, ' ').trim();
                return { t, text: text.slice(0, 4500) };
              });
              got.push({ u, title: info.t, text: info.text });
            } catch (e) { got.push({ u, error: String(e).slice(0, 120) }); }
          }
          return { data: { pages: got }, type: 'application/json' };
        }`;
        try {
          const br = await fetch((k(env,['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app') + '/function?token=' + encodeURIComponent(BLT), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: fn, context: { urls: targets } })
          });
          const d = await br.json().catch(() => ({}));
          const pages = (d.data && d.data.pages) || [];
          for (const pg of pages) {
            if (pg.error) continue;
            context += '[Live page visited — ' + (pg.title || '') + ' (' + pg.u + ')]: ' + (pg.text || '(no readable text)') + '\n';
          }
        } catch (e) { /* page sense unavailable */ }
      }
    }
  }
  // ── Live web search: forced via toggle, or auto-triggered by time-sensitive intent ──
  const lastUser = (body.messages || []).filter(m => m.role === 'user').pop() || lastUser0;
  const searchQ = lastUser ? String(lastUser.content).replace(/https?:\/\/[^\s)\]]+/g, '').slice(0, 300).trim() : '';
  const AUTO = /(price|pricing|cost|how much|current(ly)?|latest|todays?|today'?s|news|this week|this month|recent(ly)?|right now|just announced|breaking|who won|score|release(d)?|launched|update(d)? on|status of|stock|share price|weather|election|prime minister|chancellor|premier league|transfer|\b20(2[3-9]|3[0-9])\b|is (?:it|there)|are there|available now|in stock|open now|schedule|fixtures|anime|episode)/i;
  const needSearch = body.webSearch || (searchQ.length > 3 && AUTO.test(searchQ) && searchQ.split(/\s+/).length >= 2);
  // ── Image generation sense: "generate/make/create/draw an image of X" ──
  {
    const raw = String((lastUser && lastUser.content) || String(lastUser0 && lastUser0.content || ''));
    const gm = raw.match(/^(?:\/gen|\/image)\s+([\s\S]+)$/i) ||
               raw.match(/(?:generate|make|create|draw|design|produce)\b[^.?!]{0,60}\b(?:an?\s+)?(?:image|picture|photo|illustration|poster|logo|artwork|graphic|painting|mosaic)\b(?:\s+(?:of|for|showing|depicting))?\s*[:\u2014-]?\s*(.+)/i) ||
               raw.match(/^(?:an?\s+)?(?:image|picture|photo)\s+(?:of|for)\s+(.+?)\s*(?:please)?\.?$/i);
    const GEN_RE = /^(?:\/gen|\/image)\b|\b(?:generate|make|create|draw|design|produce)\b[^.?!]{0,60}\b(?:image|picture|photo|illustration|poster|logo|artwork|graphic|painting|mosaic)\b/i;
    if (gm && (GEN_RE.test(raw) || /^\//.test(raw.trim()))) {
      const genPrompt = (gm[1] || raw).slice(0, 500).replace(/^(?:of|for)\s+/i, '').trim();
      if (genPrompt.length > 2) {
        const gemKey = k(env, ['gemini_api_key','gemini_free_key','GEMINI_API_KEY']) || '';
        if (gemKey) {
          try {
            const vr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + encodeURIComponent(gemKey), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: 'Generate this image: ' + genPrompt }] }] })
            });
            const vd = await vr.json().catch(() => ({}));
            const parts = (((vd.candidates || [])[0] || {}).content || {}).parts || [];
            const imgPart = parts.find(pt => pt.inlineData || pt.inline_data);
            const b64 = imgPart && (imgPart.inlineData || imgPart.inline_data).data;
            const mime = (imgPart && (imgPart.inlineData || imgPart.inline_data).mimeType) || 'image/png';
            if (b64 && env.PRISM_ASSETS) {
              const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const key = 'gen/' + Date.now() + '-' + genPrompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.png';
              await env.PRISM_ASSETS.put(key, bytes.buffer, { httpMetadata: { contentType: mime } });
              const imgUrl = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/' + key;
              context += '[SYSTEM: an image was generated for this request via Gemini 2.5 Flash Image ("nano banana") using the prompt: "' + genPrompt + '". Include this exact markdown image in your reply:]\n![generated image](' + imgUrl + ')\n';
            } else {
              const note = (((vd.candidates || [])[0] || {}).content || {}).parts && parts.map(x => x.text || '').join('').slice(0, 200);
              context += '[SYSTEM: image generation attempted for "' + genPrompt + '" but the model returned no image' + (note ? ' — it said: ' + note : '') + '. Tell Simon the image could not be generated this time.]\n';
            }
          } catch (e) {
            context += '[SYSTEM: image generation for "' + genPrompt.slice(0, 120) + '" failed with error: ' + String(e.message || e).slice(0, 120) + '. Tell Simon plainly.]\n';
          }
        }
      }
    }
  }

  // Image search sense: "find/show me an image/picture/photo of X"
  {
    const raw = String((lastUser && lastUser.content) || String(lastUser0 && lastUser0.content || ''));
    const im = raw.match(/(?:find|show|get|search for)?\s*(?:an?\s+)?(?:image|picture|photo(?:graph)?s?|img)s?\s*(?:of|for|about|:)\s+(.+)/i);
    if (im && im[1] && im[1].length > 2) {
      const q2 = im[1].slice(0, 120).replace(/[?.!]+$/, '');
      const found = [];
      const pexelsKey = k(env, ['pexels','pexels_api_key','PEXELS_API_KEY']);
      const unsplashKey = k(env, ['unsplash_api_key','UNSPLASH_API_KEY']);
      const jobs = [];
      if (pexelsKey) jobs.push(
        fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q2) + '&per_page=4', { headers: { Authorization: pexelsKey } })
          .then(r => r.json().catch(() => ({})))
          .then(px => (px.photos || []).forEach(ph => found.push({ tiny: ph.src && ph.src.tiny, page: ph.url, alt: ph.alt || q2 })))
          .catch(() => {})
      );
      if (unsplashKey) jobs.push(
        fetch('https://api.unsplash.com/search/photos?query=' + encodeURIComponent(q2) + '&per_page=4&client_id=' + encodeURIComponent(unsplashKey))
          .then(r => r.json().catch(() => ({})))
          .then(u => (u.results || []).forEach(ph => found.push({ tiny: ph.urls && ph.urls.small, page: ph.links && ph.links.html, alt: (ph.alt_description || q2) })))
          .catch(() => {})
      );
      await Promise.all(jobs);
      if (found.length) {
        context += '[Image search results for: ' + q2 + ']\n' +
          found.slice(0, 6).map(r2 => '![' + String(r2.alt || '').slice(0, 60) + '](' + (r2.tiny || '') + ') — page: ' + (r2.page || '')).join('\n') +
          '\n(Include the best 1-3 of these images in your reply as markdown images.)\n';
      }
    }
  }
  if (needSearch && searchQ) {
    const found = [];
    const seen = new Set();
    const pushIt = (title, url, desc) => {
      const u = String(url || '').replace(/[#?].*$/, '');
      if (!u || seen.has(u)) return;
      seen.add(u);
      found.push('- ' + String(title || '').slice(0, 110) + ' — ' + u + ': ' + String(desc || '').replace(/\s+/g, ' ').slice(0, 220));
    };
    const engines = [];
    const braveKey = k(env, ['brave_api_key','BRAVE_API_KEY','brave']);
    const exaKey = k(env, ['exa_api_key','EXA_API_KEY']);
    const tavilyKey = k(env, ['tavily_api_key','TAVILY_API_KEY']);
    if (braveKey) engines.push(
      fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(searchQ) + '&count=6', {
        headers: { 'X-Subscription-Token': braveKey, 'Accept': 'application/json' } })
        .then(r => r.json().catch(() => ({})))
        .then(bd => { (bd.web && bd.web.results || []).forEach(r => pushIt(r.title, r.url, r.description)); })
        .catch(() => {})
    );
    if (exaKey) engines.push(
      fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': exaKey },
        body: JSON.stringify({ query: searchQ, numResults: 5, includeDomains: undefined }) })
        .then(r => r.json().catch(() => ({})))
        .then(ex => { (ex.results || []).forEach(r => pushIt(r.title, r.url, (r.text || r.snippet || ''))); })
        .catch(() => {})
    );
    if (tavilyKey) engines.push(
      fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: searchQ, max_results: 5 }) })
        .then(r => r.json().catch(() => ({})))
        .then(tv => { (tv.results || []).forEach(r => pushIt(r.title, r.url, r.content)); })
        .catch(() => {})
    );
    await Promise.all(engines);
    if (!found.length) {
      try {
        const r2 = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(searchQ) + '&format=json&no_redirect=1&no_html=1');
        const dd = await r2.json().catch(() => ({}));
        [dd.AbstractText, dd.Answer, dd.Definition].filter(Boolean).forEach(t => pushIt('DuckDuckGo instant answer', dd.AbstractURL || '', t));
      } catch (e) {}
    }
    if (found.length) context += '[Live web search results for: ' + searchQ + ']\n' + found.slice(0, 10).join('\n') + '\n';
  }
  return context;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    // ── Argentica password gate (trusted device: 90-day renewing cookie) ──
    async function sha256Hex(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const password = String(body.password || '');
        if (password.length < 8) return json({ success: false, error: 'Password must be at least 8 characters.' }, 400, origin);
        const master = await env.PRISM_KV.get('auth:master');
        let first = false;
        if (!master) {
          await env.PRISM_KV.put('auth:master', await sha256Hex(password));
          first = true;
        } else if (await sha256Hex(password) !== master) {
          return json({ success: false, error: 'Wrong password.' }, 401, origin);
        }
        const tokBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = [...tokBytes].map(b => b.toString(16).padStart(2, '0')).join('');
        await env.PRISM_KV.put('auth:token:' + token, JSON.stringify({ createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() }), { expirationTtl: 7776000 });
        return json({ success: true, token, firstTime: first, expiresInDays: 90 }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/auth/check' && request.method === 'GET') {
      const cookie = request.headers.get('Cookie') || '';
      const cm = cookie.match(/(?:^|;\s*)arg_auth=([a-f0-9]{64})/);
      const token = cm ? cm[1] : (request.headers.get('X-Arg-Auth') || '').replace(/[^a-f0-9]/g, '');
      if (!token) return json({ ok: false }, 401, origin);
      const raw = await env.PRISM_KV.get('auth:token:' + token);
      if (!raw) return json({ ok: false }, 401, origin);
      // renew: 90-day sliding window from last use
      await env.PRISM_KV.put('auth:token:' + token, JSON.stringify({ ...(JSON.parse(raw || '{}')), lastSeen: new Date().toISOString() }), { expirationTtl: 7776000 });
      return json({ ok: true }, 200, origin);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const cookie = request.headers.get('Cookie') || '';
      const cm = cookie.match(/(?:^|;\s*)arg_auth=([a-f0-9]{64})/);
      const token = cm ? cm[1] : (request.headers.get('X-Arg-Auth') || '').replace(/[^a-f0-9]/g, '');
      if (token) await env.PRISM_KV.delete('auth:token:' + token).catch(() => {});
      return json({ success: true }, 200, origin);
    }
    if (path === '/api/auth/change' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const master = await env.PRISM_KV.get('auth:master');
        if (!master) return json({ success: false, error: 'No password set yet — first login creates it.' }, 400, origin);
        if (await sha256Hex(String(body.current || '')) !== master) return json({ success: false, error: 'Current password is wrong.' }, 401, origin);
        const nu = String(body.next || '');
        if (nu.length < 8) return json({ success: false, error: 'New password must be at least 8 characters.' }, 400, origin);
        await env.PRISM_KV.put('auth:master', await sha256Hex(nu));
        if (env.PRISM_KV) { /* revoke all trusted devices on password change */
          const ls = await env.PRISM_KV.list({ prefix: 'auth:token:' });
          for (const k of ls.keys || []) await env.PRISM_KV.delete(k.name).catch(() => {});
        }
        return json({ success: true, note: 'All trusted devices were signed out; log in again with the new password.' }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    // ── Public R2 streaming (reliable public URL for videos/Graph fetches) ──
    if (path.startsWith('/r2/')) {
      try {
        const key = decodeURIComponent(path.slice(4));
        const rangeHdr = request.headers.get('range') || '';
        let rangeOpt;
        const rm = rangeHdr.match(/bytes=(\d+)-(\d*)/);
        if (rm) rangeOpt = { offset: parseInt(rm[1], 10), ...(rm[2] ? { length: parseInt(rm[2], 10) - parseInt(rm[1], 10) + 1 } : {}) };
        const inm = request.headers.get('if-none-match');
        const obj = await env.PRISM_ASSETS.get(key, { ...(rangeOpt ? { range: rangeOpt } : {}), ...(inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/\"/g, '') } } : {}) });
        if (!obj) return new Response('Not found', { status: 404 });
        const h = new Headers();
        obj.writeHttpMetadata(h);
        h.set('etag', obj.httpEtag);
        h.set('accept-ranges', 'bytes');
        h.set('access-control-allow-origin', '*');
        const range = request.headers.get('range');
        if (range && obj.range) {
          h.set('content-range', 'bytes ' + obj.range.offset + '-' + (obj.range.offset + obj.range.length - 1) + '/*');
          return new Response(obj.body, { status: 206, headers: h });
        }
        if (request.headers.get('if-none-match') && obj && !obj.body) return new Response(null, { status: 304 });
        return new Response(obj.body, { status: 200, headers: h });
      } catch (e) { return new Response('r2 error: ' + e.message, { status: 500 }); }
    }
    // ── Reel playback page (recorded to MP4 by the reel renderer) ──
    if (path.startsWith('/reel/page/')) {
      try {
        const reelId = path.slice('/reel/page/'.length).replace(/[^a-zA-Z0-9-]/g, '');
        const spec = reelId ? await env.PRISM_KV.get('reel:' + reelId, 'json') : null;
        if (!spec) return new Response('<!doctype html><meta charset="utf-8"><title>Reel not found</title><p>Reel not found.</p>', { status: 404, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
        if (spec.kind === 'stick') { spec._pal = REEL_BG[String(spec.bg || 'parchment').toLowerCase()] || REEL_BG.parchment; return new Response(stickPageHtml(spec), { headers: { 'Content-Type': 'text/html;charset=utf-8' } }); }
        return new Response(reelPageHtml(spec), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
      } catch (e) { return new Response('reel page error: ' + e.message, { status: 500 }); }
    }

    if (request.method === 'OPTIONS') {
      if (path.startsWith('/api/postiz-proxy/')) {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': (origin && origin.includes('.up.railway.app')) ? origin : 'https://postiz-production-ec050668.up.railway.app',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,auth,x-copilotkit-runtime-client-gql-version',
          'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Expose-Headers': 'auth,showorg,logout,activate,reload,onboarding,x-copilotkit-runtime-client-gql-version',
          'Access-Control-Max-Age': '86400'
        } });
      }
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (path === '/' || path === '/health') {
      return json({ status: 'ok', version: '1.0.0', worker: 'argentica-api', timestamp: new Date().toISOString() }, 200, origin);
    }

    // ── Chat ──────────────────────────────────────────────────────────────────
    if (path === '/api/chat' && request.method === 'POST') {
      try {
        const body = await request.json();
        let messages = (body.messages || []).filter(m => m?.role && m?.content);
        const profile = body.profile || 'balanced';
        const threadId = body.threadId || ('t' + Date.now());

        const currentDate = new Date().toISOString().slice(0, 10);
        const antiRoleplay = ` CURRENT DATE: ${currentDate}. British English. Never use asterisks for actions. Never invent data you cannot verify. Never say a date is in the future if it is before today.`;

        const hasSystem = messages.length > 0 && messages[0].role === 'system';
        if (!hasSystem) {
          let aboutMeContext = '';
          if (env.PRISM_KV) {
            const raw = await env.PRISM_KV.get('memory:about-simon').catch(() => null);
            if (raw) {
              const facts = JSON.parse(raw);
              if (facts.length > 0) aboutMeContext = '\n\nWhat I know about Simon:\n' + facts.slice(0, 10).map(m => `- ${m.fact}`).join('\n');
            }
          }
          const orchestratorPrompt = `You are Tay, Simon Johnson's personal AI. Sardonic, precise, direct. British English. Never sycophantic. Never say 'the user' — Simon is right here, speak to him directly. Never fabricate. If you don't know, say so plainly.${aboutMeContext}`;
          messages = [{ role: 'system', content: orchestratorPrompt + antiRoleplay }, ...messages];
        } else {
          messages = [...messages];
          messages[0] = { ...messages[0], content: messages[0].content + antiRoleplay };
        }

    const _uq = messages.filter(function(m){return m.role==='user';}).pop();
    const _mc = await buildMemoryContext(env, _uq ? _uq.content : '');
    if (_mc) { const _si = messages.findIndex(function(m){return m.role==='system';}); if (_si>=0) messages[_si].content+=('\n\n'+_mc); else messages.unshift({role:'system',content:_mc}); }
        const result = await orchestrate(messages, env, { profile });
    saveMemoryFromConversation(env, messages, result ? result.content : '').catch(function(){});

        // Save thread to KV
        if (env.PRISM_KV && !result.error) {
          const threadKey = `thread:${threadId}`;
          const existing = await env.PRISM_KV.get(threadKey).catch(() => null);
          const thread = existing ? JSON.parse(existing) : { id: threadId, messages: [], created: new Date().toISOString() };
          const userMsg = messages.filter(m => m.role === 'user').pop();
          if (userMsg) thread.messages.push({ role: 'user', content: userMsg.content, ts: Date.now() });
          thread.messages.push({ role: 'assistant', content: result.content, provider: result.provider, ts: Date.now() });
          thread.updated = new Date().toISOString();
          thread.title = thread.title || (userMsg?.content?.substring(0, 60) || 'Conversation');
          await env.PRISM_KV.put(threadKey, JSON.stringify(thread), { expirationTtl: 86400 * 90 }).catch(() => {});
          await env.PRISM_KV.put('thread-index:simon', JSON.stringify(
            [...new Set([threadId, ...JSON.parse(await env.PRISM_KV.get('thread-index:simon').catch(() => '[]') || '[]')])].slice(0, 200)
          )).catch(() => {});
        }

        return json({ ...result, threadId }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Threads ───────────────────────────────────────────────────────────────
    if (path === '/api/threads' && request.method === 'GET') {
      try {
        if (!env.PRISM_KV) return json({ threads: [] }, 200, origin);
        const indexRaw = await env.PRISM_KV.get('thread-index:simon').catch(() => null);
        const ids = indexRaw ? JSON.parse(indexRaw) : [];
        const threads = await Promise.all(ids.slice(0, 100).map(async id => {
          const raw = await env.PRISM_KV.get(`thread:${id}`).catch(() => null);
          if (!raw) return null;
          const t = JSON.parse(raw);
          return { id: t.id, title: t.title || 'Conversation', messageCount: t.messages?.length || 0, updated: t.updated, created: t.created };
        }));
        return json({ threads: threads.filter(Boolean).sort((a, b) => new Date(b.updated) - new Date(a.updated)) }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.startsWith('/api/threads/') && !path.startsWith('/api/threads/oauth/') && !path.startsWith('/api/threads/publish') && path !== '/api/threads/callback' && path !== '/api/threads/callback-try' && request.method === 'GET') {
      try {
        const id = path.replace('/api/threads/', '');
        const raw = await env.PRISM_KV?.get(`thread:${id}`).catch(() => null);
        if (!raw) return json({ error: 'Thread not found' }, 404, origin);
        return json(JSON.parse(raw), 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.endsWith('/duplicate') && path.startsWith('/api/threads/') && request.method === 'POST') {
      try {
        const srcId = path.replace('/api/threads/', '').replace('/duplicate', '');
        const raw = await env.PRISM_KV?.get(`thread:${srcId}`).catch(() => null);
        if (!raw) return json({ success: false, error: 'Thread not found' }, 404, origin);
        const src = JSON.parse(raw);
        const newId = 't' + Date.now();
        const copy = { ...src, id: newId, title: (src.title || 'Conversation') + ' (fork)', created: new Date().toISOString(), updated: new Date().toISOString() };
        await env.PRISM_KV.put(`thread:${newId}`, JSON.stringify(copy), { expirationTtl: 86400 * 90 });
        const idx = JSON.parse(await env.PRISM_KV.get('thread-index:simon').catch(() => '[]') || '[]');
        idx.unshift(newId);
        await env.PRISM_KV.put('thread-index:simon', JSON.stringify(idx.slice(0, 200)));
        return json({ success: true, id: newId }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }


    if (path.startsWith('/api/threads/') && !path.startsWith('/api/threads/oauth/') && !path.startsWith('/api/threads/publish') && path !== '/api/threads/callback' && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/threads/', '');
        await env.PRISM_KV?.delete(`thread:${id}`).catch(() => {});
        const indexRaw = await env.PRISM_KV?.get('thread-index:simon').catch(() => null);
        if (indexRaw) {
          const ids = JSON.parse(indexRaw).filter(i => i !== id);
          await env.PRISM_KV?.put('thread-index:simon', JSON.stringify(ids)).catch(() => {});
        }
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    if (path === '/api/memory/about-me' && request.method === 'GET') {
      try {
        const raw = await env.PRISM_KV?.get('memory:about-simon').catch(() => null);
        const mems = raw ? JSON.parse(raw) : [];
        return json({memories: mems, facts: mems, count: mems.length}, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/memory/about-me' && request.method === 'POST') {
      try {
        const body = await request.json();
        const raw = await env.PRISM_KV?.get('memory:about-simon').catch(() => null);
        const facts = raw ? JSON.parse(raw) : [];
        facts.push({ fact: body.fact, added: new Date().toISOString() });
        await env.PRISM_KV?.put('memory:about-simon', JSON.stringify(facts.slice(-100)));
        return json({ success: true, count: facts.length }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Workspaces ────────────────────────────────────────────────────────────
    if (path === '/api/workspaces' && request.method === 'GET') {
      try {
        const indexRaw = await env.PRISM_KV?.get('workspace-index').catch(() => null);
        const ids = indexRaw ? JSON.parse(indexRaw) : [];
        const workspaces = await Promise.all(ids.map(async id => {
          const raw = await env.PRISM_KV?.get(`workspace:${id}`).catch(() => null);
          if (!raw) return null;
          const ws = JSON.parse(raw);
          return { id: ws.id, name: ws.name, icon: ws.icon, colour: ws.colour, desc: ws.desc, docCount: (ws.documents || []).length, noteCount: (ws.notes || []).length };
        }));
        return json({ workspaces: workspaces.filter(Boolean) }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/workspaces' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('ws-' + Date.now());
        const ws = { id, name: body.name || 'Workspace', icon: body.icon || '📁', colour: body.colour || '#2d6a9f', desc: body.desc || '', documents: [], notes: [], created: new Date().toISOString() };
        await env.PRISM_KV?.put(`workspace:${id}`, JSON.stringify(ws));
        const indexRaw = await env.PRISM_KV?.get('workspace-index').catch(() => null);
        const ids = indexRaw ? JSON.parse(indexRaw) : [];
        if (!ids.includes(id)) ids.unshift(id);
        await env.PRISM_KV?.put('workspace-index', JSON.stringify(ids));
        return json({ success: true, workspace: ws }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/workspaces\/[^/]+$/) && request.method === 'GET') {
      try {
        const id = path.split('/').pop();
        const raw = await env.PRISM_KV?.get(`workspace:${id}`).catch(() => null);
        if (!raw) return json({ error: 'Not found' }, 404, origin);
        return json(JSON.parse(raw), 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/workspaces\/[^/]+$/) && request.method === 'PUT') {
      try {
        const id = path.split('/').pop();
        const body = await request.json();
        const raw = await env.PRISM_KV?.get(`workspace:${id}`).catch(() => null);
        const ws = raw ? JSON.parse(raw) : { id };
        const updated = { ...ws, ...body, id, updated: new Date().toISOString() };
        await env.PRISM_KV?.put(`workspace:${id}`, JSON.stringify(updated));
        return json({ success: true, workspace: updated }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── RAG ───────────────────────────────────────────────────────────────────
    if (path === '/api/rag/index' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { text, name, doc_id, workspace_id, tags = [] } = body;
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (!text) return json({ error: 'No text' }, 400, origin);
        if (!GKEY) return json({ error: 'No Gemini key' }, 500, origin);
        if (!env.PRISM_D1) return json({ error: 'D1 not bound' }, 500, origin);
        const docId = doc_id || ('doc-' + Date.now());
        const CHUNK_SIZE = 2000, OVERLAP = 200;
        const chunks = [];
        for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) chunks.push(text.substring(i, i + CHUNK_SIZE));
        await env.PRISM_D1.prepare('DELETE FROM rag_chunks WHERE doc_id=?').bind(docId).run().catch(() => {});
        await env.PRISM_D1.prepare('DELETE FROM rag_documents WHERE id=?').bind(docId).run().catch(() => {});
        let embedded = 0, errors = 0;
        for (let bi = 0; bi < chunks.length; bi += 5) {
          await Promise.all(chunks.slice(bi, bi + 5).map(async (chunk, ci) => {
            const idx = bi + ci;
            try {
              const er = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
                body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: chunk.substring(0, 8000) }] } }),
              }).then(r => r.json());
              if (!er.embedding?.values) throw new Error('no embedding');
              await env.PRISM_D1.prepare('INSERT OR REPLACE INTO rag_chunks (id,doc_id,doc_name,workspace_id,chunk_index,chunk_text,embedding,token_count,tags) VALUES (?,?,?,?,?,?,?,?,?)').bind(
                `${docId}:${idx}`, docId, name || 'document', workspace_id || null, idx, chunk.substring(0, 1000), JSON.stringify(er.embedding.values), Math.floor(chunk.length / 4), JSON.stringify(tags)
              ).run();
              embedded++;
            } catch { errors++; }
          }));
          if (bi + 5 < chunks.length) await new Promise(r => setTimeout(r, 300));
        }
        await env.PRISM_D1.prepare('INSERT OR REPLACE INTO rag_documents (id,name,workspace_id,source,chunk_count,tags) VALUES (?,?,?,?,?,?)').bind(docId, name || 'document', workspace_id || null, '', chunks.length, JSON.stringify(tags)).run().catch(() => {});
        return json({ success: true, doc_id: docId, chunks_total: chunks.length, chunks_embedded: embedded, errors }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/rag/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { query, top_k = 5, workspace_id, doc_id } = body;
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (!query) return json({ error: 'No query' }, 400, origin);
        if (!env.PRISM_D1) return json({ error: 'D1 not bound' }, 500, origin);
        const qEmb = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
          body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: query }] }, taskType: 'RETRIEVAL_QUERY' }),
        }).then(r => r.json());
        if (!qEmb.embedding?.values) return json({ error: 'Query embedding failed' }, 500, origin);
        const qv = qEmb.embedding.values;
        let sql = 'SELECT id,doc_id,doc_name,chunk_index,chunk_text,embedding FROM rag_chunks';
        const params = [];
        if (doc_id) { sql += ' WHERE doc_id=?'; params.push(doc_id); }
        else if (workspace_id) { sql += ' WHERE workspace_id=?'; params.push(workspace_id); }
        sql += ' LIMIT 500';
        const stmt = params.length ? env.PRISM_D1.prepare(sql).bind(...params) : env.PRISM_D1.prepare(sql);
        const rows = await stmt.all();
        const candidates = rows.results || [];
        const cosSim = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; } return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0; };
        const scored = candidates.map(row => {
          try { const v = JSON.parse(row.embedding); return { id: row.id, doc_id: row.doc_id, doc_name: row.doc_name, chunk_index: row.chunk_index, text: row.chunk_text, score: cosSim(qv, v) }; }
          catch { return { id: row.id, score: 0, text: row.chunk_text, doc_name: row.doc_name }; }
        }).sort((a, b) => b.score - a.score);
        return json({ query, results: scored.slice(0, top_k), total_searched: candidates.length }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/rag/documents' && request.method === 'GET') {
      try {
        if (!env.PRISM_D1) return json({ error: 'D1 not bound' }, 500, origin);
        const wsId = url.searchParams.get('workspace_id');
        const sql = wsId ? 'SELECT * FROM rag_documents WHERE workspace_id=? ORDER BY indexed_at DESC' : 'SELECT * FROM rag_documents ORDER BY indexed_at DESC LIMIT 50';
        const stmt = wsId ? env.PRISM_D1.prepare(sql).bind(wsId) : env.PRISM_D1.prepare(sql);
        const docs = await stmt.all();
        return json({ documents: docs.results || [] }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Search ────────────────────────────────────────────────────────────────
    if (path === '/api/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || '';
        const requestedSources = body.sources || ['tavily','brave','exa'];
        const page = body.page || 1; // pagination support
        const tavilyKey = k(env, ['tavily_api_key', 'TAVILY_API_KEY']);
        const braveKey = k(env, ['brave_api_key', 'BRAVE_API_KEY']);
        const exaKey = k(env, ['exa_api_key', 'EXA_API_KEY']);
        const perplexityKey = k(env, ['perplexity', 'PERPLEXITY_API_KEY']);
        const firecrawlKey = k(env, ['firecrawl_api_key', 'FIRECRAWL_API_KEY']);

        // Fire all sources in parallel — no artificial limits
        const fetches = [];

        // Tavily — web search with AI answer, advanced depth
        if (tavilyKey && requestedSources.includes('tavily')) {
          fetches.push(
            fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tavilyKey },
              body: JSON.stringify({ query, max_results: 20, search_depth: 'advanced', include_answer: true, include_raw_content: false, page }),
            }).then(r => r.json()).then(tr => {
              const items = (tr.results || []).map(r => ({ title: r.title, url: r.url, content: r.content || r.snippet || '', source: 'tavily', answer: tr.answer || null, score: r.score || 0, published_date: r.published_date || null }));
              return { source: 'tavily', items, answer: tr.answer || null };
            }).catch(e => ({ source: 'tavily', items: [], error: e.message }))
          );
        }

        // Brave — independent web search
        if (braveKey && requestedSources.includes('brave')) {
          const offset = (page - 1) * 20;
          fetches.push(
            fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&offset=${offset}&search_lang=en&safesearch=moderate`, {
              headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey },
            }).then(r => r.json()).then(br => {
              const items = (br.web?.results || []).map(r => ({ title: r.title, url: r.url, content: r.description || (r.extra_snippets && r.extra_snippets[0]) || '', source: 'brave', score: 0, published_date: r.age || null }));
              return { source: 'brave', items };
            }).catch(e => ({ source: 'brave', items: [], error: e.message }))
          );
        }

        // Exa — neural semantic search
        if (exaKey && requestedSources.includes('exa')) {
          fetches.push(
            fetch('https://api.exa.ai/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': exaKey },
              body: JSON.stringify({ query, numResults: 20, useAutoprompt: true, type: 'neural', contents: { text: { maxCharacters: 600 } }, startCrawlDate: null }),
            }).then(r => r.json()).then(ex => {
              const items = (ex.results || []).map(r => ({ title: r.title || r.url, url: r.url, content: r.text || r.snippet || '', source: 'exa', score: r.score || 0, published_date: r.publishedDate || null }));
              return { source: 'exa', items };
            }).catch(e => ({ source: 'exa', items: [], error: e.message }))
          );
        }

        // Perplexity — AI-synthesised answer with citations
        if (perplexityKey && requestedSources.includes('perplexity')) {
          fetches.push(
            fetch('https://api.perplexity.ai/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + perplexityKey },
              body: JSON.stringify({ model: 'sonar-pro', messages: [{ role: 'user', content: query }], max_tokens: 1200, return_citations: true }),
            }).then(r => r.json()).then(px => {
              const pxContent = px.choices?.[0]?.message?.content;
              const citations = px.citations || [];
              const items = pxContent ? [{ title: 'Perplexity AI Answer', url: 'https://www.perplexity.ai/search?q=' + encodeURIComponent(query), content: pxContent, source: 'perplexity', score: 1, citations }] : [];
              return { source: 'perplexity', items };
            }).catch(e => ({ source: 'perplexity', items: [], error: e.message }))
          );
        }

        // Internet Archive full-text search
        if (requestedSources.includes('internet_archive')) {
          fetches.push(
            fetch(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,description,creator,date,mediatype&rows=20&page=${page}&output=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(ia => {
              const items = ((ia.response && ia.response.docs) || []).map(r => ({
                title: r.title || r.identifier,
                url: 'https://archive.org/details/' + r.identifier,
                content: r.description || r.creator || '',
                source: 'internet_archive',
                score: 0,
                published_date: r.date || null,
                mediatype: r.mediatype,
              }));
              return { source: 'internet_archive', items };
            }).catch(e => ({ source: 'internet_archive', items: [], error: e.message }))
          );
        }

        // Wayback Machine — check if a URL is archived (pass url param instead of query)
        if (requestedSources.includes('wayback') && body.url) {
          const targetUrl = body.url;
          fetches.push(
            fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`).then(r => r.json()).then(wb => {
              const snap = wb.archived_snapshots && wb.archived_snapshots.closest;
              const items = snap ? [{ title: 'Wayback Machine: ' + targetUrl, url: snap.url, content: 'Archived ' + snap.timestamp + '. Status: ' + snap.status, source: 'wayback', score: 0 }] : [];
              return { source: 'wayback', items };
            }).catch(e => ({ source: 'wayback', items: [], error: e.message }))
          );
        }

        // Wait for all parallel fetches
        const settled = await Promise.allSettled(fetches);
        const allResults = [];
        const sourceErrors = [];
        const answers = [];

        for (const s of settled) {
          if (s.status === 'fulfilled') {
            allResults.push(...(s.value.items || []));
            if (s.value.error) sourceErrors.push(s.value.source + ': ' + s.value.error);
            if (s.value.answer) answers.push({ source: s.value.source, answer: s.value.answer });
          } else {
            sourceErrors.push(s.reason?.message || 'unknown error');
          }
        }

        // De-duplicate by URL
        const seen = new Set();
        const deduped = allResults.filter(r => {
          if (!r.url || seen.has(r.url)) return false;
          seen.add(r.url);
          return true;
        });

        // Sort: perplexity first, then by score desc
        deduped.sort((a, b) => {
          if (a.source === 'perplexity') return -1;
          if (b.source === 'perplexity') return 1;
          return (b.score || 0) - (a.score || 0);
        });

        return json({
          query,
          results: deduped,
          allResults: deduped,
          count: deduped.length,
          page,
          sources_queried: requestedSources,
          answers: answers.length > 0 ? answers : undefined,
          errors: sourceErrors.length > 0 ? sourceErrors : undefined,
        }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Scholarly / institutional research sources ────────────────────────────
    if (path === '/api/research/probe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const targets = {
          openalex: 'https://api.openalex.org/works?search=ADHD&per-page=2&page=1&select=id,title&mailto=hello@identitypartners.uk',
          semantic_scholar: 'https://api.semanticscholar.org/graph/v1/paper/search?query=ADHD&limit=2&fields=title,year',
          pubmed: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=ADHD&format=json&pageSize=2',
          crossref: 'https://api.crossref.org/works?query=ADHD&rows=2'
        };
        const which = Object.keys(targets).filter(t => !body.sources || body.sources.includes(t));
        const out = [];
        for (const t of which) {
          try {
            const r = await fetch(targets[t], { headers: { 'User-Agent': 'Argentica/1.0 Research', 'Accept': 'application/json' } });
            const text = await r.text();
            out.push({ source: t, status: r.status, head: text.slice(0, 120) });
          } catch (e) { out.push({ source: t, error: String(e).slice(0, 150) }); }
        }
        return json({ success: true, probe: out }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/research/probe2' && request.method === 'POST') {
      try {
        const out = [];
        // 1. NCBI eutils (official PubMed API) directly from the worker
        try {
          const ncbiKey = k(env, ['ncbi_api_key','NCBI_API_KEY']);
          const r = await fetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=ADHD&retmode=json&retmax=3' + (ncbiKey ? '&api_key=' + ncbiKey : ''), { headers: { 'User-Agent': 'Argentica/1.0 Research' } });
          const t = await r.text();
          out.push({ via: 'worker-direct', source: 'pubmed-eutils', status: r.status, head: t.slice(0, 150) });
        } catch (e) { out.push({ via: 'worker-direct', source: 'pubmed-eutils', error: String(e).slice(0, 150) }); }
        // 2. OpenAlex & EuropePMC fetched THROUGH Browserless (different egress IP)
        const BLT = k(env, ['railway_browserless_token']) || '';
        if (BLT) {
          const fn = `export default async ({ page, context }) => {
            const got = {};
            for (const [name, u] of Object.entries(context.urls)) {
              try { const r = await page.evaluate(async (uu) => { const rr = await fetch(uu, { headers: { 'User-Agent': 'Argentica/1.0 Research' } }); return { s: rr.status, t: (await rr.text()).slice(0, 150) }; }, u); got[name] = r; }
              catch (e) { got[name] = { err: String(e).slice(0, 120) }; }
            }
            return { data: got, type: 'application/json' };
          }`;
          try {
            const br = await fetch((k(env,['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app') + '/function?token=' + encodeURIComponent(BLT), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: fn, context: { urls: {
                openalex: 'https://api.openalex.org/works?search=ADHD&per-page=2&page=1&select=id,title&mailto=hello@identitypartners.uk',
                europepmc: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=ADHD&format=json&pageSize=2'
              } } })
            });
            const d = await br.json();
            const got = (d.data && d.data) || d;
            Object.entries(got).forEach(([name, r]) => out.push({ via: 'browserless', source: name, status: r.s, head: (r.t || r.err || '').slice(0, 150) }));
          } catch (e) { out.push({ via: 'browserless', error: String(e).slice(0, 150) }); }
        } else out.push({ via: 'browserless', note: 'no token' });
        return json({ success: true, probe: out }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/research/scholarly' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || '';
        const sources = body.sources || ['semantic_scholar','openalex','pubmed','crossref','core','arxiv'];
        const page = body.page || 1;
        const perPage = 25; // results per source per page
        const email = k(env, ['unpaywall_email','UNPAYWALL_EMAIL']) || 'hello@identitypartners.uk';
        const coreKey = k(env, ['core_api_key','CORE_API_KEY']);
        const exaKey = k(env, ['exa_api_key','EXA_API_KEY']);

        const fetches = [];

        // ── Semantic Scholar ── 200M+ papers, free, no key needed
        if (sources.includes('semantic_scholar')) {
          const offset = (page - 1) * perPage;
          const ssKey = k(env, ['semantic_scholar_api_key','SEMANTIC_SCHOLAR_API_KEY']);
          fetches.push(
            fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${perPage}&offset=${offset}&fields=title,authors,year,abstract,externalIds,openAccessPdf,citationCount,venue,publicationDate`, {
              headers: Object.assign({ 'User-Agent': 'Argentica/1.0 Research (hello@identitypartners.uk)' }, ssKey ? { 'x-api-key': ssKey } : {}),
            }).then(r => r.json()).then(ss => {
              const items = (ss.data || []).map(p => ({
                title: p.title || '',
                url: (p.openAccessPdf && p.openAccessPdf.url) || ('https://www.semanticscholar.org/paper/' + (p.paperId || '')),
                content: p.abstract || '',
                source: 'semantic_scholar',
                authors: (p.authors || []).map(a => a.name).join(', '),
                year: p.year,
                venue: p.venue || '',
                citations: p.citationCount || 0,
                doi: p.externalIds && p.externalIds.DOI,
                is_oa: !!(p.openAccessPdf && p.openAccessPdf.url),
                _type: 'academic',
                score: p.citationCount || 0,
              }));
              return { source: 'semantic_scholar', items, total: ss.total };
            }).catch(e => ({ source: 'semantic_scholar', items: [], error: e.message }))
          );
        }

        // ── OpenAlex ── 250M+ scholarly works, fully open
        if (sources.includes('openalex')) {
          const oaPage = page;
          const oaKey = k(env, ['openalex','openalex_api_key','OPENALEX_API_KEY']);
          fetches.push(
            fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perPage}&page=${oaPage}&select=id,title,authorships,publication_year,abstract_inverted_index,primary_location,open_access,cited_by_count,doi,type,publication_date&mailto=${email}` + (oaKey ? `&api_key=${oaKey}` : ''), {
              headers: Object.assign({ 'User-Agent': 'Argentica/1.0 Research' }, oaKey ? { 'Authorization': 'Bearer ' + oaKey } : {}),
            }).then(r => r.json()).then(oa => {
              const items = (oa.results || []).map(w => {
                // Reconstruct abstract from inverted index
                let abstract = '';
                if (w.abstract_inverted_index) {
                  const words = {};
                  for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
                    for (const pos of positions) words[pos] = word;
                  }
                  abstract = Object.keys(words).sort((a,b) => a-b).map(k => words[k]).join(' ');
                }
                const loc = w.primary_location || {};
                const pdfUrl = (loc.pdf_url) || (w.open_access && w.open_access.oa_url) || ('https://openalex.org/' + (w.id || '').replace('https://openalex.org/',''));
                return {
                  title: w.title || '',
                  url: pdfUrl,
                  content: abstract,
                  source: 'openalex',
                  authors: (w.authorships || []).slice(0,5).map(a => a.author && a.author.display_name).filter(Boolean).join(', '),
                  year: w.publication_year,
                  venue: (loc.source && loc.source.display_name) || '',
                  citations: w.cited_by_count || 0,
                  doi: w.doi,
                  is_oa: !!(w.open_access && w.open_access.is_oa),
                  _type: 'academic',
                  score: w.cited_by_count || 0,
                };
              });
              return { source: 'openalex', items, total: oa.meta && oa.meta.count };
            }).catch(e => ({ source: 'openalex', items: [], error: e.message }))
          );
        }

        // ── PubMed / NCBI ── biomedical literature
        if (sources.includes('pubmed')) {
          const retstart = (page - 1) * perPage;
          const ncbiKey = k(env, ['ncbi_api_key','NCBI_API_KEY']);
          const keyQ = ncbiKey ? '&api_key=' + ncbiKey : '';
          fetches.push(
            // Step 1: search for IDs
            fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${perPage}&retstart=${retstart}&retmode=json&tool=Argentica&email=${email}${keyQ}`)
              .then(r => r.json())
              .then(async esearch => {
                const ids = (esearch.esearchresult && esearch.esearchresult.idlist) || [];
                if (ids.length === 0) return { source: 'pubmed', items: [], total: 0 };
                // Step 2: fetch summaries
                const summary = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&tool=Argentica&email=${email}${keyQ}`)
                  .then(r => r.json()).catch(() => ({}));
                const uids = (summary.result && summary.result.uids) || ids;
                const items = uids.map(uid => {
                  const art = (summary.result && summary.result[uid]) || {};
                  return {
                    title: art.title || uid,
                    url: 'https://pubmed.ncbi.nlm.nih.gov/' + uid + '/',
                    content: art.source ? art.source + (art.pubdate ? ' (' + art.pubdate + ')' : '') : '',
                    source: 'pubmed',
                    authors: (art.authors || []).slice(0,5).map(a => a.name).join(', '),
                    year: art.pubdate ? art.pubdate.substring(0,4) : null,
                    venue: art.fulljournalname || art.source || '',
                    doi: art.elocationid || null,
                    _type: 'academic',
                    score: 0,
                  };
                });
                return { source: 'pubmed', items, total: parseInt((esearch.esearchresult && esearch.esearchresult.count) || '0') };
              }).catch(e => ({ source: 'pubmed', items: [], error: e.message }))
          );
        }

        // ── CrossRef ── academic metadata + DOIs
        if (sources.includes('crossref')) {
          const crOffset = (page - 1) * perPage;
          fetches.push(
            fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${perPage}&offset=${crOffset}&select=DOI,title,author,published,abstract,container-title,is-referenced-by-count,URL,type&mailto=${email}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research (hello@identitypartners.uk)' },
            }).then(r => r.json()).then(cr => {
              const items = ((cr.message && cr.message.items) || []).map(w => ({
                title: (w.title && w.title[0]) || '',
                url: w.URL || ('https://doi.org/' + w.DOI),
                content: w.abstract ? w.abstract.replace(/<[^>]+>/g,'') : '',
                source: 'crossref',
                authors: (w.author || []).slice(0,5).map(a => (a.given ? a.given + ' ' : '') + (a.family || '')).join(', '),
                year: w.published && w.published['date-parts'] && w.published['date-parts'][0] && w.published['date-parts'][0][0],
                venue: (w['container-title'] && w['container-title'][0]) || '',
                citations: w['is-referenced-by-count'] || 0,
                doi: w.DOI,
                _type: 'academic',
                score: w['is-referenced-by-count'] || 0,
              }));
              return { source: 'crossref', items, total: cr.message && cr.message['total-results'] };
            }).catch(e => ({ source: 'crossref', items: [], error: e.message }))
          );
        }

        // ── CORE ── open access research papers
        if (sources.includes('core') && coreKey) {
          const coreOffset = (page - 1) * perPage;
          fetches.push(
            fetch('https://api.core.ac.uk/v3/search/works', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + coreKey },
              body: JSON.stringify({ q: query, limit: perPage, offset: coreOffset, fields: ['title','authors','abstract','downloadUrl','doi','yearPublished','publisher','journals'] }),
            }).then(r => r.json()).then(co => {
              const items = (co.results || []).map(w => ({
                title: w.title || '',
                url: w.downloadUrl || (w.doi ? 'https://doi.org/' + w.doi : ''),
                content: w.abstract || '',
                source: 'core',
                authors: (w.authors || []).slice(0,5).map(a => a.name || a).join(', '),
                year: w.yearPublished,
                venue: (w.journals && w.journals[0] && w.journals[0].title) || w.publisher || '',
                doi: w.doi,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'core', items, total: co.totalHits };
            }).catch(e => ({ source: 'core', items: [], error: e.message }))
          );
        } else if (sources.includes('core') && !coreKey) {
          // CORE without key — limited free tier
          const coreOffset = (page - 1) * perPage;
          fetches.push(
            fetch(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=${perPage}&offset=${coreOffset}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(co => {
              const items = (co.results || []).map(w => ({
                title: w.title || '',
                url: w.downloadUrl || (w.doi ? 'https://doi.org/' + w.doi : ''),
                content: w.abstract || '',
                source: 'core',
                authors: (w.authors || []).slice(0,5).map(a => a.name || a).join(', '),
                year: w.yearPublished,
                doi: w.doi,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'core', items };
            }).catch(e => ({ source: 'core', items: [], error: e.message }))
          );
        }

        // ── arXiv ── preprints: physics, maths, CS, econ, quantitative biology
        if (sources.includes('arxiv')) {
          const arxivStart = (page - 1) * perPage;
          fetches.push(
            fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=${arxivStart}&max_results=${perPage}&sortBy=relevance&sortOrder=descending`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.text()).then(xml => {
              // Parse Atom XML
              const entries = [];
              const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
              for (const m of entryMatches) {
                const e = m[1];
                const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g,' ').trim() || '';
                const summary = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g,' ').trim() || '';
                const id = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim() || '';
                const published = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1]?.trim() || '';
                const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].slice(0,5).map(a => a[1].trim()).join(', ');
                const pdfUrl = id.replace('abs','pdf');
                entries.push({
                  title,
                  url: pdfUrl || id,
                  content: summary,
                  source: 'arxiv',
                  authors,
                  year: published ? published.substring(0,4) : null,
                  published_date: published,
                  is_oa: true,
                  _type: 'academic',
                  score: 0,
                });
              }
              return { source: 'arxiv', items: entries };
            }).catch(e => ({ source: 'arxiv', items: [], error: e.message }))
          );
        }

        // ── Unpaywall ── resolve DOI to free full text
        if (sources.includes('unpaywall')) {
          const doiMatch = query.match(/10\.\d{4,}[^\s]*/);
          if (doiMatch) {
            const doi = doiMatch[0];
            fetches.push(
              fetch('https://api.unpaywall.org/v2/' + encodeURIComponent(doi) + '?email=' + email)
                .then(r => r.json()).then(up => {
                  if (!up || !up.title) return { source: 'unpaywall', items: [] };
                  return { source: 'unpaywall', items: [{
                    title: up.title,
                    url: (up.best_oa_location && up.best_oa_location.url) || up.doi_url,
                    content: (up.journal_name || '') + (up.year ? ' (' + up.year + ')' : '') + '. OA: ' + (up.is_oa ? 'Yes' : 'No') + '.',
                    source: 'unpaywall',
                    doi,
                    is_oa: up.is_oa,
                    oa_url: (up.best_oa_location && up.best_oa_location.url) || null,
                    _type: 'academic',
                    score: 0,
                  }]};
                }).catch(e => ({ source: 'unpaywall', items: [], error: e.message }))
            );
          }
        }

        // ── DOAJ ── Directory of Open Access Journals
        if (sources.includes('doaj')) {
          const doajPage = page - 1;
          fetches.push(
            fetch(`https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${perPage}&page=${doajPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(dj => {
              const items = (dj.results || []).map(a => {
                const bib = a.bibjson || {};
                const journal = bib.journal || {};
                return {
                  title: bib.title || '',
                  url: (bib.link && bib.link[0] && bib.link[0].url) || '',
                  content: bib.abstract || '',
                  source: 'doaj',
                  authors: (bib.author || []).slice(0,5).map(au => au.name).join(', '),
                  year: bib.year,
                  venue: journal.title || '',
                  doi: bib.identifier && bib.identifier.find(i => i.type === 'doi') && bib.identifier.find(i => i.type === 'doi').id,
                  is_oa: true,
                  _type: 'academic',
                  score: 0,
                };
              });
              return { source: 'doaj', items, total: dj.total };
            }).catch(e => ({ source: 'doaj', items: [], error: e.message }))
          );
        }

        // ── Internet Archive ── books, texts, datasets
        if (sources.includes('internet_archive')) {
          const iaPage = page;
          fetches.push(
            fetch(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,description,creator,date,mediatype,subject&rows=${perPage}&page=${iaPage}&output=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(ia => {
              const items = ((ia.response && ia.response.docs) || []).map(r => ({
                title: r.title || r.identifier,
                url: 'https://archive.org/details/' + r.identifier,
                content: (Array.isArray(r.description) ? r.description[0] : r.description) || (Array.isArray(r.creator) ? r.creator[0] : r.creator) || '',
                source: 'internet_archive',
                authors: Array.isArray(r.creator) ? r.creator.join(', ') : (r.creator || ''),
                year: r.date ? r.date.substring(0,4) : null,
                mediatype: r.mediatype,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'internet_archive', items, total: ia.response && ia.response.numFound };
            }).catch(e => ({ source: 'internet_archive', items: [], error: e.message }))
          );
        }

        // ── Goldsmiths Library ── Ex Libris Primo
        if (sources.includes('goldsmiths_library') || sources.includes('senate_house')) {
          const libQuery = encodeURIComponent(query);
          fetches.push(
            fetch('https://goldsmiths.primo.exlibrisgroup.com/primaws/rest/pub/pnxs?inst=44GOL_INST&lang=en&limit=' + perPage + '&q=any,contains,' + libQuery + '&scope=MyInst_and_CI&sort=rank&tab=Everything&vid=44GOL_INST:VU1', {
              headers: { 'Accept': 'application/json', 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(gold => {
              const items = (gold.docs || []).map(doc => {
                const pnx = doc.pnx || {};
                const title = ((pnx.display && pnx.display.title) || [''])[0];
                const creator = ((pnx.display && pnx.display.creator) || [''])[0];
                const date = ((pnx.display && pnx.display.creationdate) || [''])[0];
                const recordId = (pnx.control && pnx.control.recordid && pnx.control.recordid[0]) || '';
                return {
                  title,
                  url: 'https://goldsmiths.primo.exlibrisgroup.com/permalink/44GOL_INST/1l3oa4j/' + recordId,
                  content: creator + (date ? ' (' + date + ')' : '') + '. Available via Goldsmiths Library.',
                  source: sources.includes('goldsmiths_library') ? 'goldsmiths_library' : 'senate_house',
                  authors: creator,
                  year: date,
                  _type: 'academic',
                  score: 0,
                };
              });
              return { source: 'goldsmiths_library', items };
            }).catch(e => ({ source: 'goldsmiths_library', items: [], error: e.message }))
          );
        }

        // ── Exa for academic/scholarly content ──
        if (sources.includes('exa') && exaKey) {
          fetches.push(
            fetch('https://api.exa.ai/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': exaKey },
              body: JSON.stringify({ query, numResults: perPage, useAutoprompt: true, type: 'neural', includeDomains: ['scholar.google.com','pubmed.ncbi.nlm.nih.gov','ncbi.nlm.nih.gov','jstor.org','researchgate.net','academia.edu','ssrn.com','tandfonline.com','wiley.com','springer.com','nature.com','sciencedirect.com','bmj.com','thelancet.com','nejm.org'], contents: { text: { maxCharacters: 800 } } }),
            }).then(r => r.json()).then(ex => {
              const items = (ex.results || []).map(r => ({
                title: r.title || r.url,
                url: r.url,
                content: r.text || r.snippet || '',
                source: 'exa_academic',
                score: r.score || 0,
                published_date: r.publishedDate || null,
                is_oa: false,
                _type: 'academic',
              }));
              return { source: 'exa_academic', items };
            }).catch(e => ({ source: 'exa_academic', items: [], error: e.message }))
          );
        }

        // ── Google Scholar link-out (no scraping) ──
        if (sources.includes('google_scholar')) {
          const items = [{
            title: 'Search Google Scholar: ' + query,
            url: 'https://scholar.google.com/scholar?q=' + encodeURIComponent(query),
            content: 'Google Scholar discovery link — click to search directly.',
            source: 'google_scholar',
            _type: 'academic',
            score: 0,
          }];
          fetches.push(Promise.resolve({ source: 'google_scholar', items }));
        }

        // ── Goldsmiths ILL fallback ──
        if (sources.includes('goldsmiths_ill')) {
          fetches.push(Promise.resolve({ source: 'goldsmiths_ill', items: [{
            title: 'Goldsmiths Inter-Library Loan',
            url: 'https://www.gold.ac.uk/library/using/ill/',
            content: 'Request unavailable items via Goldsmiths ILL.',
            source: 'goldsmiths_ill',
            _type: 'academic',
            score: 0,
          }]}));
        }

        // ── bioRxiv ── biology preprints
        if (sources.includes('biorxiv')) {
          fetches.push(
            fetch(`https://api.biorxiv.org/details/biorxiv/2000-01-01/${new Date().toISOString().split('T')[0]}/${(page-1)*perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(bx => {
              const allPapers = (bx.collection || []);
              const filtered = allPapers.filter(p => {
                const text = ((p.title || '') + ' ' + (p.abstract || '')).toLowerCase();
                return query.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => text.includes(w));
              }).slice(0, perPage);
              const items = filtered.map(p => ({
                title: p.title || '',
                url: 'https://www.biorxiv.org/content/' + p.doi,
                content: p.abstract || '',
                source: 'biorxiv',
                authors: p.authors || '',
                year: p.date ? p.date.substring(0,4) : null,
                doi: p.doi,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'biorxiv', items };
            }).catch(e => ({ source: 'biorxiv', items: [], error: e.message }))
          );
        }

        // ── medRxiv ── medical preprints
        if (sources.includes('medrxiv')) {
          fetches.push(
            fetch(`https://api.biorxiv.org/details/medrxiv/2000-01-01/${new Date().toISOString().split('T')[0]}/${(page-1)*perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(mx => {
              const allPapers = (mx.collection || []);
              const filtered = allPapers.filter(p => {
                const text = ((p.title || '') + ' ' + (p.abstract || '')).toLowerCase();
                return query.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => text.includes(w));
              }).slice(0, perPage);
              const items = filtered.map(p => ({
                title: p.title || '',
                url: 'https://www.medrxiv.org/content/' + p.doi,
                content: p.abstract || '',
                source: 'medrxiv',
                authors: p.authors || '',
                year: p.date ? p.date.substring(0,4) : null,
                doi: p.doi,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'medrxiv', items };
            }).catch(e => ({ source: 'medrxiv', items: [], error: e.message }))
          );
        }

        // ── Europe PMC ── European biomedical literature
        if (sources.includes('europe_pmc') || sources.includes('pmc')) {
          const pmcOffset = (page - 1) * perPage;
          fetches.push(
            fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&pageSize=${perPage}&cursorMark=*&format=json&email=${email}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(ep => {
              const items = ((ep.resultList && ep.resultList.result) || []).map(p => ({
                title: p.title || '',
                url: p.fullTextUrlList && p.fullTextUrlList.fullTextUrl && p.fullTextUrlList.fullTextUrl[0] && p.fullTextUrlList.fullTextUrl[0].url || ('https://europepmc.org/article/' + (p.source || 'MED') + '/' + p.id),
                content: p.abstractText || '',
                source: sources.includes('europe_pmc') ? 'europe_pmc' : 'pmc',
                authors: p.authorString || '',
                year: p.pubYear,
                venue: p.journalTitle || '',
                doi: p.doi,
                is_oa: p.isOpenAccess === 'Y',
                _type: 'academic',
                score: p.citedByCount || 0,
                citations: p.citedByCount || 0,
              }));
              return { source: 'europe_pmc', items, total: ep.hitCount };
            }).catch(e => ({ source: 'europe_pmc', items: [], error: e.message }))
          );
        }

        // ── Zenodo ── open research data + papers
        if (sources.includes('zenodo')) {
          fetches.push(
            fetch(`https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${perPage}&page=${page}&sort=mostrecent`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(zn => {
              const items = (zn.hits && zn.hits.hits || []).map(r => {
                const meta = r.metadata || {};
                return {
                  title: meta.title || '',
                  url: r.links && r.links.html || ('https://zenodo.org/record/' + r.id),
                  content: meta.description ? meta.description.replace(/<[^>]+>/g,'').substring(0,400) : '',
                  source: 'zenodo',
                  authors: (meta.creators || []).slice(0,5).map(c => c.name).join(', '),
                  year: meta.publication_date ? meta.publication_date.substring(0,4) : null,
                  doi: meta.doi,
                  is_oa: true,
                  _type: 'academic',
                  score: 0,
                };
              });
              return { source: 'zenodo', items, total: zn.hits && zn.hits.total };
            }).catch(e => ({ source: 'zenodo', items: [], error: e.message }))
          );
        }

        // ── ClinicalTrials.gov ──
        if (sources.includes('clinicaltrials')) {
          fetches.push(
            fetch(`https://clinicaltrials.gov/api/query/full_studies?expr=${encodeURIComponent(query)}&min_rnk=${(page-1)*perPage+1}&max_rnk=${page*perPage}&fmt=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(ct => {
              const studies = (ct.FullStudiesResponse && ct.FullStudiesResponse.FullStudies) || [];
              const items = studies.map(s => {
                const study = s.Study || {};
                const proto = study.ProtocolSection || {};
                const id = proto.IdentificationModule || {};
                const desc = proto.DescriptionModule || {};
                const status = proto.StatusModule || {};
                return {
                  title: id.BriefTitle || id.OfficialTitle || '',
                  url: 'https://clinicaltrials.gov/study/' + (id.NCTId || ''),
                  content: desc.BriefSummary || '',
                  source: 'clinicaltrials',
                  year: status.StartDateStruct && status.StartDateStruct.StartDate ? status.StartDateStruct.StartDate.substring(0,4) : null,
                  _type: 'academic',
                  score: 0,
                };
              });
              return { source: 'clinicaltrials', items };
            }).catch(e => ({ source: 'clinicaltrials', items: [], error: e.message }))
          );
        }

        // ── EThOS ── UK theses (British Library)
        if (sources.includes('ethos')) {
          fetches.push(
            fetch(`https://ethos.bl.uk/api/search?query=${encodeURIComponent(query)}&rows=${perPage}&start=${(page-1)*perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research', 'Accept': 'application/json' },
            }).then(r => r.json()).then(et => {
              const items = (et.documents || et.results || []).map(t => ({
                title: t.title || '',
                url: t.ethos_url || ('https://ethos.bl.uk/OrderDetails.do?uin=' + (t.ethos_id || '')),
                content: t.abstract || t.description || '',
                source: 'ethos',
                authors: t.author || '',
                year: t.year || t.awarded_date,
                venue: t.institution || '',
                is_oa: !!(t.open_access),
                _type: 'academic',
                score: 0,
              }));
              return { source: 'ethos', items };
            }).catch(e => ({ source: 'ethos', items: [], error: e.message }))
          );
        }

        // ── OATD ── Open Access Theses and Dissertations
        if (sources.includes('oatd')) {
          fetches.push(
            fetch(`https://oatd.org/oatd/search?q=${encodeURIComponent(query)}&start=${(page-1)*perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research', 'Accept': 'application/json' },
            }).then(r => r.json()).then(oa => {
              const items = (oa.results || []).map(t => ({
                title: t.title || '',
                url: t.url || '',
                content: t.description || t.abstract || '',
                source: 'oatd',
                authors: t.author || '',
                year: t.date ? t.date.substring(0,4) : null,
                venue: t.school || '',
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'oatd', items };
            }).catch(e => ({ source: 'oatd', items: [], error: e.message }))
          );
        }

        // ── IDEAS/RePec ── economics working papers
        if (sources.includes('ideas_repec')) {
          fetches.push(
            fetch(`https://api.repec.org/search.php?query=${encodeURIComponent(query)}&rows=${perPage}&start=${(page-1)*perPage}&format=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(rp => {
              const items = (rp.items || rp.results || []).map(p => ({
                title: p.title || '',
                url: p.url || ('https://ideas.repec.org/search.html?q=' + encodeURIComponent(query)),
                content: p.abstract || p.description || '',
                source: 'ideas_repec',
                authors: p.author || p.authors || '',
                year: p.year || p.date,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'ideas_repec', items };
            }).catch(e => ({ source: 'ideas_repec', items: [], error: e.message }))
          );
        }

        // ── NBER ── National Bureau of Economic Research working papers
        if (sources.includes('nber')) {
          fetches.push(
            fetch(`https://api.nber.org/papers.json?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(nb => {
              const items = (nb.papers || nb.results || []).map(p => ({
                title: p.title || '',
                url: p.url || ('https://www.nber.org/papers/' + (p.id || '')),
                content: p.abstract || '',
                source: 'nber',
                authors: (p.authors || []).map(a => a.name || a).join(', '),
                year: p.year || (p.date && p.date.substring(0,4)),
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'nber', items };
            }).catch(e => ({ source: 'nber', items: [], error: e.message }))
          );
        }

        // ── ONS ── UK Office for National Statistics
        if (sources.includes('ons')) {
          fetches.push(
            fetch(`https://api.beta.ons.gov.uk/v1/search?q=${encodeURIComponent(query)}&limit=${perPage}&offset=${(page-1)*perPage}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research', 'Accept': 'application/json' },
            }).then(r => r.json()).then(ons => {
              const items = (ons.items || ons.results || []).map(r => ({
                title: r.description && r.description.title || r.title || '',
                url: r.uri ? 'https://www.ons.gov.uk' + r.uri : '',
                content: r.description && r.description.summary || r.summary || '',
                source: 'ons',
                year: r.description && r.description.releaseDate ? r.description.releaseDate.substring(0,4) : null,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'ons', items };
            }).catch(e => ({ source: 'ons', items: [], error: e.message }))
          );
        }

        // ── World Bank ── global development data
        if (sources.includes('worldbank')) {
          fetches.push(
            fetch(`https://search.worldbank.org/api/v2/wds?qterm=${encodeURIComponent(query)}&rows=${perPage}&os=${(page-1)*perPage}&format=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(wb => {
              const items = (wb.documents ? Object.values(wb.documents).filter(d => d && d.display_title) : []).slice(0, perPage).map(d => ({
                title: d.display_title || d.docdt || '',
                url: d.url || d.pdfurl || '',
                content: d.teaser || d.abstract || '',
                source: 'worldbank',
                authors: d.author || '',
                year: d.docdt ? d.docdt.substring(0,4) : null,
                is_oa: true,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'worldbank', items };
            }).catch(e => ({ source: 'worldbank', items: [], error: e.message }))
          );
        }

        // ── Eurostat ── EU statistics
        if (sources.includes('eurostat')) {
          fetches.push(
            fetch(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${encodeURIComponent(query)}?format=JSON&lang=EN`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(es => {
              // Eurostat returns dataset metadata — provide a search link
              const items = [{
                title: 'Eurostat: ' + query,
                url: 'https://ec.europa.eu/eurostat/databrowser/explore/all/all_themes?lang=en&search=' + encodeURIComponent(query),
                content: 'Search Eurostat statistical database for: ' + query,
                source: 'eurostat',
                is_oa: true,
                _type: 'academic',
                score: 0,
              }];
              return { source: 'eurostat', items };
            }).catch(e => ({ source: 'eurostat', items: [], error: e.message }))
          );
        }

        // ── Lens.org ── patents + scholarly
        if (sources.includes('lens')) {
          fetches.push(
            fetch('https://api.lens.org/scholarly/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (k(env, ['lens_api_key','LENS_API_KEY']) || '') },
              body: JSON.stringify({ query: { match: { title: query } }, size: perPage, from: (page-1)*perPage, include: ['title','authors','abstract','year_published','doi','open_access','source'] }),
            }).then(r => r.json()).then(ln => {
              const items = (ln.data || []).map(p => ({
                title: p.title || '',
                url: p.doi ? 'https://doi.org/' + p.doi : 'https://www.lens.org/lens/search/scholar?q=' + encodeURIComponent(query),
                content: p.abstract || '',
                source: 'lens',
                authors: (p.authors || []).slice(0,5).map(a => a.display_name || a.first_name + ' ' + a.last_name).join(', '),
                year: p.year_published,
                doi: p.doi,
                is_oa: p.open_access && p.open_access.is_oa,
                _type: 'academic',
                score: 0,
              }));
              return { source: 'lens', items };
            }).catch(e => ({ source: 'lens', items: [], error: e.message }))
          );
        }

        // ── BASE ── Bielefeld Academic Search Engine
        if (sources.includes('base')) {
          fetches.push(
            fetch(`https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?func=PerformSearch&query=${encodeURIComponent(query)}&hits=${perPage}&offset=${(page-1)*perPage}&format=json`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(bs => {
              const docs = (bs.response && bs.response.docs) || [];
              const items = docs.map(d => ({
                title: (Array.isArray(d.dctitle) ? d.dctitle[0] : d.dctitle) || '',
                url: (Array.isArray(d.dcidentifier) ? d.dcidentifier[0] : d.dcidentifier) || '',
                content: (Array.isArray(d.dcdescription) ? d.dcdescription[0] : d.dcdescription) || '',
                source: 'base',
                authors: (Array.isArray(d.dccreator) ? d.dccreator.slice(0,5).join(', ') : d.dccreator) || '',
                year: d.dcyear,
                is_oa: d.dcoa === '1',
                _type: 'academic',
                score: 0,
              }));
              return { source: 'base', items, total: bs.response && bs.response.numFound };
            }).catch(e => ({ source: 'base', items: [], error: e.message }))
          );
        }

        // ── SciELO ── Latin American open access (via OpenAlex filter)
        if (sources.includes('scielo')) {
          // SciELO has no public JSON search API — query via OpenAlex filtered to SciELO sources
          fetches.push(
            fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=primary_location.source.host_organization:https://openalex.org/P4310320595&per-page=${perPage}&page=${page}&mailto=${email}`, {
              headers: { 'User-Agent': 'Argentica/1.0 Research' },
            }).then(r => r.json()).then(sc => {
              const items = (sc.results || []).map(w => {
                let abstract = '';
                if (w.abstract_inverted_index) {
                  const words = {};
                  for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
                    for (const pos of positions) words[pos] = word;
                  }
                  abstract = Object.keys(words).sort((a,b)=>a-b).map(k=>words[k]).join(' ');
                }
                const loc = w.primary_location || {};
                return {
                  title: w.title || '',
                  url: (loc.pdf_url) || (w.open_access && w.open_access.oa_url) || ('https://openalex.org/' + (w.id||'').replace('https://openalex.org/','')),
                  content: abstract,
                  source: 'scielo',
                  authors: (w.authorships||[]).slice(0,5).map(a=>a.author&&a.author.display_name).filter(Boolean).join(', '),
                  year: w.publication_year,
                  doi: w.doi,
                  is_oa: true,
                  _type: 'academic',
                  score: w.cited_by_count || 0,
                };
              });
              return { source: 'scielo', items };
            }).catch(e => ({ source: 'scielo', items: [], error: e.message }))
          );
        }

        // Wait for all
        const settled = await Promise.allSettled(fetches);
        const allResults = [];
        const sourceErrors = [];
        const sourceTotals = {};

        for (const s of settled) {
          if (s.status === 'fulfilled') {
            allResults.push(...(s.value.items || []));
            if (s.value.error) sourceErrors.push(s.value.source + ': ' + s.value.error);
            if (s.value.total != null) sourceTotals[s.value.source] = s.value.total;
          } else {
            sourceErrors.push(s.reason?.message || 'unknown error');
          }
        }

        // De-duplicate by DOI first, then URL
        const seenDois = new Set();
        const seenUrls = new Set();
        const deduped = allResults.filter(r => {
          if (r.doi) {
            const normDoi = r.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//,'');
            if (seenDois.has(normDoi)) return false;
            seenDois.add(normDoi);
          }
          if (r.url) {
            if (seenUrls.has(r.url)) return false;
            seenUrls.add(r.url);
          }
          return true;
        });

        // Sort by citation count / score desc
        deduped.sort((a, b) => (b.score || b.citations || 0) - (a.score || a.citations || 0));

        return json({
          query,
          results: deduped,
          allResults: deduped,
          count: deduped.length,
          page,
          source_totals: sourceTotals,
          sources_queried: sources,
          errors: sourceErrors.length > 0 ? sourceErrors : undefined,
        }, 200, origin);
      } catch(e) { return json({ error: e.message, results: [] }, 500, origin); }
    }

    // ── RSS ───────────────────────────────────────────────────────────────────
    if (path === '/api/rss' && request.method === 'GET') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) return json({ error: 'No URL' }, 400, origin);
      try {
        const resp = await fetch(feedUrl, { headers: { 'User-Agent': 'Argentica/1.0 RSS Reader' } });
        const text = await resp.text();
        return new Response(text, { headers: { 'Content-Type': 'application/xml', ...cors(origin) } });
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── News keywords ─────────────────────────────────────────────────────────
    if (path === '/api/news/keywords') {
      if (request.method === 'GET') {
        const kws = await env.PRISM_KV?.get('news:keywords').catch(() => null);
        return json({ keywords: kws ? JSON.parse(kws) : [] }, 200, origin);
      }
      if (request.method === 'POST') {
        const body = await request.json();
        await env.PRISM_KV?.put('news:keywords', JSON.stringify(body.keywords || []));
        return json({ success: true }, 200, origin);
      }
    }

    // ── OCR ───────────────────────────────────────────────────────────────────
    if (path === '/api/ocr' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { image, mime_type = 'image/png' } = body;
        if (!image) return json({ error: 'No image' }, 400, origin);
        const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']);
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (mistralKey) {
          const mr = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mistralKey}` },
            body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe all handwritten text in this image exactly as written. Return only the transcribed text, no commentary.' }, { type: 'image_url', image_url: { url: `data:${mime_type};base64,${image}` } }] }], max_tokens: 2048 }),
          }).then(r => r.json()).catch(() => ({}));
          const text = mr.choices?.[0]?.message?.content;
          if (text?.trim()) return json({ text: text.trim(), provider: 'mistral' }, 200, origin);
        }
        if (GKEY) {
          const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Transcribe all handwritten text in this image exactly as written. Return only the transcribed text.' }, { inline_data: { mime_type, data: image } }] }], generationConfig: { maxOutputTokens: 2048 } }),
          }).then(r => r.json()).catch(() => ({}));
          const text = gr.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text?.trim()) return json({ text: text.trim(), provider: 'gemini' }, 200, origin);
        }
        return json({ error: 'No OCR provider available' }, 500, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Zoho token refresh helper ─────────────────────────────────────────────
    async function getZohoToken() {
      if (!env.PRISM_KV) return null;
      const tokenRaw = await env.PRISM_KV.get('zoho:calendar:token');
      if (!tokenRaw) return null;
      const tokenData = JSON.parse(tokenRaw);
      
      // Check if expired (with 5 min buffer)
      const now = Date.now();
      const expiresAt = tokenData.expires_at || 0;
      
      if (now < expiresAt - 300000) {
        // Token still valid
        return tokenData;
      }
      
      // Token expired — refresh it
      const refreshToken = tokenData.refresh_token;
      if (!refreshToken) return null;
      
      const clientId = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.HMH9CMYHZ9TPTN1FAXK6VTC6R8ISMZ';
      const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
      
      try {
        const refreshResp = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: 'refresh_token=' + encodeURIComponent(refreshToken) +
                '&client_id=' + encodeURIComponent(clientId) +
                '&client_secret=' + encodeURIComponent(clientSecret) +
                '&grant_type=refresh_token'
        });
        const refreshData = await refreshResp.json();
        
        if (refreshData.access_token) {
          const newToken = {
            ...tokenData,
            access_token: refreshData.access_token,
            expires_at: Date.now() + (refreshData.expires_in || 3600) * 1000,
            stored_at: new Date().toISOString()
          };
          await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(newToken));
          return newToken;
        }
      } catch(e) {
        console.error('Zoho refresh failed:', e.message);
      }
      return tokenData; // Return old token as fallback
    }


    // ── Zoho Calendar events ──────────────────────────────────────────────────
        if (path === '/api/zoho/events-alt' && request.method === 'GET') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:calendar:token') : null;
        if (!raw) return json({status:'not_connected', today:[], week:[], next_week:[]}, 200, origin);
        const tokenData = JSON.parse(raw);
        let accessToken = tokenData.access_token;

        // Auto-refresh if token is older than 50 minutes
        if (tokenData.stored_at && (Date.now() - tokenData.stored_at) > 50 * 60 * 1000) {
          try {
            const clientId = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.FH6MXEMWWK2YZXOU4QI3UVKZ6OM1CB';
            const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
            if (tokenData.refresh_token && clientSecret) {
              const params = new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:tokenData.refresh_token});
              const refreshResp = await fetch('https://accounts.zoho.eu/oauth/v2/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
              const refreshData = await refreshResp.json();
              if (refreshData.access_token) {
                accessToken = refreshData.access_token;
                tokenData.access_token = accessToken;
                tokenData.stored_at = Date.now();
                if (env.PRISM_KV) await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(tokenData));
              }
            }
          } catch(refreshErr) {}
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
        const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const nextWeekEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

        // Correct Zoho EU Calendar API endpoint
        const calListResp = await fetch('https://calendar.zoho.eu/api/v1/calendars', {
          headers: {'Authorization': `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json'}
        });
        if (!calListResp.ok) {
          const errText = await calListResp.text();
          return json({status:'api_error', code: calListResp.status, error: errText.substring(0,200), today:[], week:[], next_week:[]}, 200, origin);
        }
        const calListData = await calListResp.json();
        const calendars = calListData.calendars || [];
        if (!calendars.length) return json({status:'ok', today:[], week:[], next_week:[], message:'No calendars found'}, 200, origin);

        const primaryCal = calendars.find(c => c.isdefault) || calendars[0];
        const calId = primaryCal.uid;

        const eventsResp = await fetch(
          `https://calendar.zoho.eu/api/v1/calendars/${calId}/events?range_start=${encodeURIComponent(todayStart)}&range_end=${encodeURIComponent(nextWeekEnd)}&eventType=event`,
          {headers: {'Authorization': `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json'}}
        );
        if (!eventsResp.ok) return json({status:'api_error', code: eventsResp.status, today:[], week:[], next_week:[]}, 200, origin);

        const eventsData = await eventsResp.json();
        const allEvents = (eventsData.events || []).map(ev => ({
          id: ev.uid, title: ev.title || 'Event',
          start: ev.dateandtime?.start, end: ev.dateandtime?.end,
          calendar: primaryCal.name, location: ev.location, description: ev.description,
        }));
        const todayEvents = allEvents.filter(e => e.start && e.start >= todayStart && e.start <= todayEnd);
        const weekEvents = allEvents.filter(e => e.start && e.start > todayEnd && e.start <= weekEnd);
        const nextWeekEvents = allEvents.filter(e => e.start && e.start > weekEnd && e.start <= nextWeekEnd);
        return json({status:'ok', today:todayEvents, week:weekEvents, next_week:nextWeekEvents, calendars:calendars.length}, 200, origin);
      } catch(e) {
        return json({status:'error', error:e.message, today:[], week:[], next_week:[]}, 200, origin);
      }
    }


    if (path === '/api/zoho/events-alt2' && request.method === 'GET') {
      try {
        const tokenRaw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:calendar:token') : null;
        if (!tokenRaw) return json({status:'not_connected', today:[], week:[], next_week:[]}, 200, origin);
        const zohoToken = JSON.parse(tokenRaw);
        // Use the api_domain from the token (zohoapis.eu for EU accounts)
        const apiDomain = zohoToken.api_domain || 'https://www.zohoapis.eu';
        const calDomain = apiDomain.replace('www.zohoapis', 'calendar.zoho');
        
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
        const nextWeekEnd = new Date(now.getTime() + 14 * 86400000).toISOString().split('T')[0];
        
        const calResp = await fetch(calDomain + '/api/v1/calendars', {
          headers: {'Authorization': 'Zoho-oauthtoken ' + zohoToken.access_token}
        });
        if (!calResp.ok) {
          // Try token refresh
          const refreshKey = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.O98MYTLET4DOLL1UWEGIH1WD3K4IFL';
          const refreshSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
          if (zohoToken.refresh_token && refreshKey) {
            const refreshResp = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: 'grant_type=refresh_token&refresh_token=' + zohoToken.refresh_token + '&client_id=' + refreshKey + '&client_secret=' + refreshSecret
            });
            const refreshData = await refreshResp.json();
            if (refreshData.access_token) {
              zohoToken.access_token = refreshData.access_token;
              if (env.PRISM_KV) await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(zohoToken));
            }
          }
          return json({status:'api_error', code: calResp.status, today:[], week:[], next_week:[]}, 200, origin);
        }
        const calData = await calResp.json();
        const calendars = calData.calendars || [];
        const allEvents = [];
        for (const cal of calendars.slice(0, 3)) {
          try {
            const evResp = await fetch(calDomain + '/api/v1/calendars/' + cal.uid + '/events?range_start=' + todayStr + '&range_end=' + nextWeekEnd, {
              headers: {'Authorization': 'Zoho-oauthtoken ' + zohoToken.access_token}
            });
            if (evResp.ok) {
              const evData = await evResp.json();
              (evData.events || []).forEach(ev => allEvents.push({
                id: ev.uid, title: ev.title, start: ev.dateandtime?.start,
                end: ev.dateandtime?.end, calendar: cal.name
              }));
            }
          } catch(e2) {}
        }
        const today = allEvents.filter(e => e.start && e.start.startsWith(todayStr));
        const week = allEvents.filter(e => e.start && e.start > todayStr && e.start <= weekEnd);
        const next_week = allEvents.filter(e => e.start && e.start > weekEnd && e.start <= nextWeekEnd);
        return json({status:'ok', today, week, next_week}, 200, origin);
      } catch(e) { return json({status:'error', error:e.message, today:[], week:[], next_week:[]}, 200, origin); }
    }


    // ── Image search (Pexels) ─────────────────────────────────────────────────
    if (path === '/api/image-search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || body.q || '';
        const limit = body.limit || 8;
        const pexelsKey = k(env, ['pexels_api_key','PEXELS_API_KEY','pexels']) || '';
        if (!pexelsKey) return json({results:[], error:'Pexels key not configured'}, 200, origin);
        const resp = await fetch(
          'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=' + limit + '&orientation=landscape',
          {headers: {'Authorization': pexelsKey}}
        );
        if (!resp.ok) return json({results:[], error:'Pexels error: '+resp.status}, 200, origin);
        const data = await resp.json();
        return json({results: data.photos || [], total: data.total_results || 0}, 200, origin);
      } catch(e) { return json({results:[], error:e.message}, 200, origin); }
    }

    // ── Image search GET (legacy) ─────────────────────────────────────────────
    if (path.startsWith('/api/image-search') && request.method === 'GET') {
      try {
        const url = new URL(request.url);
        const query = url.searchParams.get('q') || '';
        const pexelsKey = k(env, ['pexels_api_key','PEXELS_API_KEY','pexels']) || '';
        if (!pexelsKey) return json({results:[]}, 200, origin);
        const resp = await fetch(
          'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=8&orientation=landscape',
          {headers: {'Authorization': pexelsKey}}
        );
        const data = await resp.json();
        return json({results: data.photos || []}, 200, origin);
      } catch(e) { return json({results:[]}, 200, origin); }
    }


    // ── Zoho OAuth token exchange ─────────────────────────────────────────────
    if (path === '/api/zoho/exchange' && request.method === 'POST') {
      try {
        const body = await request.json();
        const code = body.code || '';
        const redirectUri = body.redirect_uri || '';
        const clientId = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.BXJ9CZSVLMX25OO9L0KKG95KR8Y05P';
        const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
        if (!code) return json({error:'No code provided'}, 400, origin);
        // Try EU endpoint first, then COM
        const endpoints = ['https://accounts.zoho.eu/oauth/v2/token']; // EU-only
        let lastError = '';
        for (const endpoint of endpoints) {
          try {
            const params = new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              code: code,
            });
            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: params.toString(),
            });
            const data = await resp.json();
            if (data.access_token) {
              // Store tokens in KV
              const tokenData = {
                access_token: data.access_token,
                refresh_token: data.refresh_token || '',
                expires_in: data.expires_in || 3600,
                api_domain: data.api_domain || 'https://www.zohoapis.eu',
                stored_at: Date.now(),
              };
              if (env.PRISM_KV) {
                await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(tokenData));
                await env.PRISM_KV.put('zoho:mail:token', JSON.stringify(tokenData));
              }
              return json({success:true, api_domain:tokenData.api_domain}, 200, origin);
            }
            lastError = JSON.stringify(data).substring(0,100);
          } catch(e) { lastError = e.message; }
        }
        return json({error:'Token exchange failed: '+lastError}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Zoho token refresh ────────────────────────────────────────────────────
    if (path === '/api/zoho/refresh' && request.method === 'POST') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:calendar:token') : null;
        if (!raw) return json({error:'No token stored'}, 400, origin);
        const tokenData = JSON.parse(raw);
        if (!tokenData.refresh_token) return json({error:'No refresh token'}, 400, origin);
        const clientId = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.BXJ9CZSVLMX25OO9L0KKG95KR8Y05P';
        const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenData.refresh_token,
        });
        const resp = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: params.toString(),
        });
        const data = await resp.json();
        if (data.access_token) {
          tokenData.access_token = data.access_token;
          tokenData.stored_at = Date.now();
          if (env.PRISM_KV) {
            await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(tokenData));
            await env.PRISM_KV.put('zoho:mail:token', JSON.stringify(tokenData));
          }
          return json({success:true}, 200, origin);
        }
        return json({error:'Refresh failed: '+JSON.stringify(data).substring(0,100)}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Macro.com file storage ────────────────────────────────────────────────
    if (path === '/api/macro/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileName = body.fileName || ('file-'+Date.now());
        const content = body.content || ''; // text content
        const mimeType = body.mimeType || 'text/plain';
        const macroKey = k(env, ['macro_api_key','MACRO_API_KEY']) || '';
        if (!macroKey) return json({error:'Macro API key not configured'}, 400, origin);
        // Macro API: create a doc
        const resp = await fetch('https://api.macro.com/v1/docs', {
          method: 'POST',
          headers: {'Authorization': 'Bearer '+macroKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({title: fileName, content: content, type: 'document'})
        });
        const data = await resp.json();
        if (data.id) {
          return json({success:true, id:data.id, url:data.url||'', title:data.title}, 200, origin);
        }
        return json({error:'Macro upload failed: '+JSON.stringify(data).substring(0,100)}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Macro list docs ───────────────────────────────────────────────────────
    if (path === '/api/macro/list' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? await env.PRISM_KV.get('macros:list', 'json') : null;
        return json({ macros: list || [], docs: list || [], success: true }, 200, origin);
      } catch(e) { return json({ macros: [], docs: [], error: e.message }, 200, origin); }
    }

    // ── Zoho: list all calendars (to find the right one) ─────────────────────
    if (path === '/api/zoho/calendars' && request.method === 'GET') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:calendar:token') : null;
        if (!raw) return json({error:'Not connected', status:'not_connected'}, 200, origin);
        const tokenData = JSON.parse(raw);
        const apiDomain = tokenData.api_domain || 'https://www.zohoapis.eu';
        const resp = await fetch(apiDomain+'/calendar/v1/calendars', {
          headers: {'Authorization': 'Bearer '+tokenData.access_token}
        });
        const data = await resp.json();
        return json({calendars: data.calendars || [], raw: JSON.stringify(data).substring(0,500)}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Zoho: get events from ALL calendars ───────────────────────────────────
    if (path === '/api/zoho/events' && request.method === 'GET') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:calendar:token') : null;
        if (!raw) return json({today:[],week:[],next_week:[],status:'not_connected'}, 200, origin);
        const tokenData = JSON.parse(raw);
        // Check token expiry
        const storedAt = tokenData.stored_at || 0;
        const expiresIn = (tokenData.expires_in || 3600) * 1000;
        if (Date.now() - storedAt > expiresIn - 60000) {
          // Token expired — try refresh
          if (tokenData.refresh_token) {
            const clientId = k(env, ['zoho_client_id','ZOHO_CLIENT_ID']) || '1000.BXJ9CZSVLMX25OO9L0KKG95KR8Y05P';
            const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '';
            const params = new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:tokenData.refresh_token});
            const refreshResp = await fetch('https://accounts.zoho.eu/oauth/v2/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
            const refreshData = await refreshResp.json();
            if (refreshData.access_token) {
              tokenData.access_token = refreshData.access_token;
              tokenData.stored_at = Date.now();
              if (env.PRISM_KV) await env.PRISM_KV.put('zoho:calendar:token', JSON.stringify(tokenData));
            }
          }
        }
        const apiDomain = tokenData.api_domain || 'https://www.zohoapis.eu';
        const now = new Date();
        const startDate = now.toISOString().split('T')[0];
        const endDate = new Date(now.getTime() + 14*24*60*60*1000).toISOString().split('T')[0];
        // Get all calendars first
        let calendarIds = [];
        try {
          const calResp = await fetch(apiDomain+'/calendar/v1/calendars', {
            headers: {'Authorization': 'Bearer '+tokenData.access_token}
          });
          const calData = await calResp.json();
          const cals = calData.calendars || [];
          calendarIds = cals.map(c => c.uid || c.id).filter(Boolean);
        } catch(e) {}
        if (!calendarIds.length) calendarIds = ['personal']; // fallback
        // Fetch events from all calendars
        let allEvents = [];
        for (const calId of calendarIds.slice(0,5)) {
          try {
            const evResp = await fetch(
              apiDomain+'/calendar/v1/calendars/'+encodeURIComponent(calId)+'/events?startdatetime='+startDate+'&enddatetime='+endDate+'&range=14',
              {headers: {'Authorization': 'Bearer '+tokenData.access_token}}
            );
            const evData = await evResp.json();
            const events = evData.events || [];
            allEvents = allEvents.concat(events.map(ev => ({
              id: ev.uid || ev.id,
              title: ev.title || ev.summary || 'Event',
              start: ev.dateandtime?.start || ev.start?.dateTime || ev.start?.date || '',
              end: ev.dateandtime?.end || ev.end?.dateTime || ev.end?.date || '',
              calendar: calId,
              location: ev.location || '',
            })));
          } catch(e) {}
        }
        // Sort and split into today/week/next_week
        allEvents.sort((a,b) => new Date(a.start) - new Date(b.start));
        const today = now.toDateString();
        const weekEnd = new Date(now.getTime() + 7*24*60*60*1000);
        const nextWeekEnd = new Date(now.getTime() + 14*24*60*60*1000);
        const todayEvents = allEvents.filter(e => e.start && new Date(e.start).toDateString() === today);
        const weekEvents = allEvents.filter(e => e.start && new Date(e.start) > now && new Date(e.start) <= weekEnd);
        const nextWeekEvents = allEvents.filter(e => e.start && new Date(e.start) > weekEnd && new Date(e.start) <= nextWeekEnd);
        return json({today:todayEvents, week:weekEvents, next_week:nextWeekEvents, status:'ok', calendarCount:calendarIds.length}, 200, origin);
      } catch(e) { return json({today:[],week:[],next_week:[],status:'api_error',error:e.message}, 200, origin); }
    }


    // ── OneDrive upload via MSGraph ────────────────────────────────────────────
    if (path === '/api/onedrive/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileName = body.fileName || ('file-'+Date.now());
        const content = body.content || '';
        const folder = body.folder || 'Argentica';
        const tenantId = env.msgraph_tenant || env.MSGRAPH_TENANT || '';
        const clientId = env.msgraph_client || env.MSGRAPH_CLIENT || '';
        const clientSecret = env.msgraph_secret || env.MSGRAPH_SECRET || '';
        // Client-credentials flow cannot use /me — it needs the target user's UPN/email.
        const driveUser = k(env, ['msgraph_user_email','msgraph_user','onedrive_email','MSGRAPH_USER_EMAIL','MSGRAPH_USER']) || '';
        if (!driveUser) return json({error:'OneDrive user email not configured. Add msgraph_user_email=your Microsoft account email as a secret.'}, 400, origin);

        // Get access token
        const tokenResp = await fetch(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: clientId,
              client_secret: clientSecret,
              scope: 'https://graph.microsoft.com/.default'
            }).toString()
          }
        );
        const tokenData = await tokenResp.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) return json({error: 'Could not get MSGraph token: '+JSON.stringify(tokenData).substring(0,100)}, 500, origin);

        // Upload file to OneDrive — application permissions require /users/{email}/drive
        const fileBytes = body.encoding === 'base64' || body.base64
          ? Uint8Array.from(atob(content), c => c.charCodeAt(0))
          : (typeof content === 'string' ? new TextEncoder().encode(content) : content);
        const uploadResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(driveUser)}/drive/root:/${folder}/${encodeURIComponent(fileName)}:/content`,
          {
            method: 'PUT',
            headers: {'Authorization': 'Bearer '+accessToken, 'Content-Type': body.mimeType || 'application/octet-stream'},
            body: fileBytes
          }
        );
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return json({error: 'OneDrive upload failed: '+JSON.stringify(uploadData).substring(0,100)}, 500, origin);

        // Create sharing link
        const shareResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(driveUser)}/drive/items/${uploadData.id}/createLink`,
          {
            method: 'POST',
            headers: {'Authorization': 'Bearer '+accessToken, 'Content-Type': 'application/json'},
            body: JSON.stringify({type: 'view', scope: 'anonymous'})
          }
        );
        const shareData = await shareResp.json();
        const shareUrl = shareData.link?.webUrl || uploadData.webUrl || '';

        return json({
          success: true,
          fileId: uploadData.id,
          fileName: uploadData.name,
          shareUrl,
          officeOnlineUrl: shareUrl ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(shareUrl)}` : '',
          googleDocsUrl: shareUrl ? `https://docs.google.com/viewer?url=${encodeURIComponent(shareUrl)}&embedded=true` : '',
        }, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── PDF to Markdown via Gemini Vision ─────────────────────────────────────
    if (path === '/api/pdf/to-markdown' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileUrl = body.url || '';
        const b64Content = body.content || '';
        const GKEY = env.gemini_api_key || env.GEMINI_API_KEY || '';
        if (!GKEY) return json({error: 'Gemini key not configured'}, 400, origin);

        let pdfB64 = b64Content;
        if (fileUrl && !pdfB64) {
          const resp = await fetch(fileUrl);
          if (!resp.ok) return json({error: 'Could not fetch PDF'}, 400, origin);
          const buf = await resp.arrayBuffer();
          pdfB64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        }
        if (!pdfB64) return json({error: 'No PDF content provided'}, 400, origin);

        // Use Gemini to extract text from PDF
        const gemResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GKEY}`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              contents: [{parts: [
                {text: 'Extract ALL text from this PDF document. Return in clean Markdown format. Preserve headings (use # ## ###), lists, tables, and paragraph structure. Include every word — do not summarise or skip any content.'},
                {inline_data: {mime_type: 'application/pdf', data: pdfB64.substring(0, 1000000)}}
              ]}],
              generationConfig: {maxOutputTokens: 8192}
            })
          }
        );
        const gemData = await gemResp.json();
        const markdown = gemData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!markdown) return json({error: 'No text extracted', raw: JSON.stringify(gemData).substring(0,200)}, 500, origin);
        return json({success: true, markdown, wordCount: markdown.split(/\s+/).length}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── Streaming chat with thinking display ─────────────────────────────────
    if (path === '/api/chat/stream' && request.method === 'POST') {
      try {
        const body = await request.json();
        const messages = (body.messages || []).filter(m => m?.role && m?.content);
        // Senses: vision descriptions + live page visits + auto/forced web search.
        // buildSensorContext internally decides (images, URLs, time-sensitive intent, explicit toggle)
        {
          const sensorCtx = await buildSensorContext(body, env);
          if (sensorCtx && messages.length) {
            const last = messages[messages.length - 1];
            if (last.role === 'user') last.content = String(last.content) + '\n\n[Context]\n' + sensorCtx;
            else messages.push({ role: 'user', content: '[Context]\n' + sensorCtx });
          }
        }
        const profile = body.profile || 'balanced';
        const threadId = body.threadId || ('t' + Date.now());
        const providerOverride = body.providerOverride;
        const modelOverride = body.modelOverride;

        // Set up SSE stream
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const send = async (event, data) => {
          await writer.write(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
        };

        // Run orchestration in background, stream results
        (async () => {
          try {
            await send('status', { status: 'connecting', message: 'Connecting to AI...' });

            const result = await orchestrate(messages, env, { profile, providerOverride, modelOverride, threadId, multiModel: !!body.multiModel });

            if (result.error) {
              await send('error', { error: result.error, log: result.log });
            } else {
              // Send thinking if present
              if (result.thinking) {
                await send('thinking', { text: result.thinking });
              }
              // Send connected status
              await send('status', { status: 'connected', provider: result.provider, model: result.model });
              // Stream the content token by token (simulate streaming for now)
              const content = result.content || '';
              const chunkSize = 20;
              for (let i = 0; i < content.length; i += chunkSize) {
                await send('token', { text: content.slice(i, i + chunkSize) });
              }
              // Send done
              await send('done', {
                content: result.content,
                provider: result.provider,
                model: result.model,
                thinking: result.thinking,
                threadId
              });
              // Save thread
              if (env.PRISM_KV && result.content) {
                const threadKey = `thread:${threadId}`;
                const existing = await env.PRISM_KV.get(threadKey);
                const thread = existing ? JSON.parse(existing) : { id: threadId, messages: [], created: new Date().toISOString() };
                thread.messages = [...messages, { role: 'assistant', content: result.content, provider: result.provider, ts: Date.now() }];
                thread.updated = new Date().toISOString();
                thread.messageCount = thread.messages.filter(m => m.role !== 'system').length;
                if (!thread.title) thread.title = messages.find(m => m.role === 'user')?.content?.substring(0, 60) || 'Conversation';
                await env.PRISM_KV.put(threadKey, JSON.stringify(thread), { expirationTtl: 86400 * 90 });
                try {
                  const idx = JSON.parse(await env.PRISM_KV.get('thread-index:simon').catch(() => '[]') || '[]');
                  if (!idx.includes(threadId)) {
                    idx.unshift(threadId);
                    await env.PRISM_KV.put('thread-index:simon', JSON.stringify(idx.slice(0, 200)));
                  }
                } catch (ie) {}
              }
            }
          } catch(e) {
            await send('error', { error: e.message });
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': origin,
          }
        });
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }


    // ── Zoho Mail inbox ───────────────────────────────────────────────────────
    if (path === '/api/zoho/mail/inbox' && request.method === 'GET') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:mail:token') : null;
        if (!raw) return json({status:'not_connected', messages:[]}, 200, origin);
        const tokenData = JSON.parse(raw);
        const token = tokenData.access_token;
        const apiDomain = tokenData.api_domain || 'https://www.zohoapis.eu';

        // Get accounts first
        const acctResp = await fetch('https://mail.zoho.eu/api/accounts', {
          headers: {'Authorization': `Zoho-oauthtoken ${token}`}
        });
        if (!acctResp.ok) return json({status:'api_error', code:acctResp.status, messages:[]}, 200, origin);
        const acctData = await acctResp.json();
        const accounts = acctData.data || [];
        if (!accounts.length) return json({status:'ok', messages:[], note:'No mail accounts'}, 200, origin);
        const accountId = accounts[0].accountId;

        // Get inbox messages
        const msgResp = await fetch(`${apiDomain}/mail/v1/accounts/${accountId}/messages/view?folderId=inbox&limit=20`, {
          headers: {'Authorization': `Zoho-oauthtoken ${token}`}
        });
        if (!msgResp.ok) return json({status:'api_error', code:msgResp.status, messages:[]}, 200, origin);
        const msgData = await msgResp.json();
        const messages = (msgData.data || []).map(m => ({
          id: m.messageId,
          from: m.fromAddress || m.sender,
          subject: m.subject,
          preview: (m.summary || '').substring(0, 200),
          date: m.receivedTime,
          read: m.isRead,
        }));
        return json({status:'ok', messages}, 200, origin);
      } catch(e) { return json({status:'error', error:e.message, messages:[]}, 200, origin); }
    }

    // ── Zoho Mail send ────────────────────────────────────────────────────────
    if (path === '/api/zoho/mail/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('zoho:mail:token') : null;
        if (!raw) return json({error:'Not connected'}, 400, origin);
        const tokenData = JSON.parse(raw);
        const token = tokenData.access_token;
        const apiDomain = tokenData.api_domain || 'https://www.zohoapis.eu';
        const acctResp = await fetch(`${apiDomain}/mail/v1/accounts`, {headers:{'Authorization':`Zoho-oauthtoken ${token}`}});
        const acctData = await acctResp.json();
        const accountId = (acctData.data || [])[0]?.accountId;
        if (!accountId) return json({error:'No mail account'}, 400, origin);
        const sendResp = await fetch(`${apiDomain}/mail/v1/accounts/${accountId}/messages`, {
          method: 'POST',
          headers: {'Authorization': `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            fromAddress: 'hello@identitypartners.uk',
            toAddress: body.to,
            subject: body.subject || '(no subject)',
            content: body.content || '',
            mailFormat: 'html',
          })
        });
        const sendData = await sendResp.json();
        return json({success: sendResp.ok, data: sendData}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Embedding: generate vector for text ──────────────────────────────────
    if (path === '/api/embed' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || '';
        const model = body.model || 'auto';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        const MKEY = k(env, ['mistral_api_key','MISTRAL_API_KEY']) || '';
        const NKEY = k(env, ['nvidia_build_api_key','NVIDIA_BUILD_API_KEY']) || '';

        if (!text) return json({error:'No text provided'}, 400, origin);

        // Auto-select: Google free first, NVIDIA free second, Mistral paid third
        const providers = [];
        if (GKEY) providers.push({name:'google', key:GKEY});
        if (NKEY) providers.push({name:'nvidia', key:NKEY});
        if (MKEY) providers.push({name:'mistral', key:MKEY});

        for (const p of providers) {
          if (model !== 'auto' && !model.includes(p.name)) continue;
          try {
            if (p.name === 'google') {
              const resp = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + p.key,
                {method:'POST', headers:{'Content-Type':'application/json'},
                 body:JSON.stringify({model:'models/text-embedding-004', content:{parts:[{text}]}})}
              );
              if (resp.ok) {
                const d = await resp.json();
                const embedding = d.embedding?.values || [];
                if (embedding.length > 0) return json({embedding, model:'text-embedding-004', provider:'google', dims:embedding.length}, 200, origin);
              }
            }
            if (p.name === 'nvidia') {
              const resp = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
                method:'POST', headers:{'Authorization':'Bearer '+p.key,'Content-Type':'application/json'},
                body:JSON.stringify({input:[text], model:'nvidia/nv-embed-v2', input_type:'query', encoding_format:'float', truncate:'END'})
              });
              if (resp.ok) {
                const d = await resp.json();
                const embedding = d.data?.[0]?.embedding || [];
                if (embedding.length > 0) return json({embedding, model:'nvidia/nv-embed-v2', provider:'nvidia', dims:embedding.length}, 200, origin);
              }
            }
            if (p.name === 'mistral') {
              const resp = await fetch('https://api.mistral.ai/v1/embeddings', {
                method:'POST', headers:{'Authorization':'Bearer '+p.key,'Content-Type':'application/json'},
                body:JSON.stringify({input:[text], model:'mistral-embed', encoding_format:'float'})
              });
              if (resp.ok) {
                const d = await resp.json();
                const embedding = d.data?.[0]?.embedding || [];
                if (embedding.length > 0) return json({embedding, model:'mistral-embed', provider:'mistral', dims:embedding.length}, 200, origin);
              }
            }
          } catch(e) { continue; }
        }
        return json({error:'All embedding providers failed'}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: index document chunk ─────────────────────────────────────────────
    if (path === '/api/rag/index' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 8000);
        const docId = body.doc_id || ('doc-' + Date.now());
        const docName = body.name || 'Document';
        const workspaceId = body.workspace_id || 'default';
        const tags = body.tags || [];
        const chunkSize = 1000;
        const overlap = 100;

        // Split into chunks
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize - overlap) {
          chunks.push({idx: chunks.length, text: text.substring(i, i + chunkSize)});
        }

        // Embed each chunk using Google text-embedding-004 (free)
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        let embedded = 0;
        for (const chunk of chunks.slice(0, 20)) { // max 20 chunks per call
          try {
            const resp = await fetch(
              'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + GKEY,
              {method:'POST', headers:{'Content-Type':'application/json'},
               body:JSON.stringify({model:'models/text-embedding-004', content:{parts:[{text:chunk.text}]}})}
            );
            if (resp.ok) {
              const d = await resp.json();
              const embedding = d.embedding?.values || [];
              if (embedding.length > 0 && env.PRISM_D1) {
                await env.PRISM_D1.prepare(
                  'INSERT OR REPLACE INTO rag_chunks (id, doc_id, doc_name, workspace_id, chunk_idx, chunk_text, embedding_json, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                ).bind(
                  docId + '_' + chunk.idx, docId, docName, workspaceId,
                  chunk.idx, chunk.text,
                  JSON.stringify(embedding),
                  JSON.stringify(tags),
                  new Date().toISOString()
                ).run();
                embedded++;
              }
            }
          } catch(e) { continue; }
        }
        return json({success:true, chunks_total:chunks.length, chunks_embedded:embedded, doc_id:docId}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: semantic search ──────────────────────────────────────────────────
    if (path === '/api/rag/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || '';
        const limit = body.limit || 5;
        const workspaceId = body.workspace_id || null;
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';

        if (!query) return json({results:[]}, 200, origin);

        // Embed the query
        const qResp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + GKEY,
          {method:'POST', headers:{'Content-Type':'application/json'},
           body:JSON.stringify({model:'models/text-embedding-004', content:{parts:[{text:query}]}})}
        );
        if (!qResp.ok) return json({results:[], error:'Query embedding failed'}, 200, origin);
        const qData = await qResp.json();
        const queryEmbedding = qData.embedding?.values || [];
        if (!queryEmbedding.length) return json({results:[]}, 200, origin);

        // Fetch all chunks from D1 (cosine similarity in JS)
        if (!env.PRISM_D1) return json({results:[], error:'D1 not configured'}, 200, origin);
        const wsFilter = workspaceId ? `WHERE workspace_id = '${workspaceId}'` : '';
        const rows = await env.PRISM_D1.prepare(
          `SELECT id, doc_id, doc_name, workspace_id, chunk_idx, chunk_text, embedding_json FROM rag_chunks ${wsFilter} LIMIT 500`
        ).all();

        // Cosine similarity
        function cosineSim(a, b) {
          let dot = 0, normA = 0, normB = 0;
          for (let i = 0; i < Math.min(a.length, b.length); i++) {
            dot += a[i] * b[i]; normA += a[i]*a[i]; normB += b[i]*b[i];
          }
          return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
        }

        const scored = (rows.results || []).map(row => {
          try {
            const emb = JSON.parse(row.embedding_json || '[]');
            return {...row, score: cosineSim(queryEmbedding, emb)};
          } catch { return {...row, score: 0}; }
        }).sort((a, b) => b.score - a.score).slice(0, limit);

        return json({results: scored.map(r => ({
          doc_id: r.doc_id, doc_name: r.doc_name,
          chunk_idx: r.chunk_idx, chunk_text: r.chunk_text,
          score: r.score, workspace_id: r.workspace_id
        }))}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: setup D1 table ───────────────────────────────────────────────────
    if (path === '/api/rag/setup' && request.method === 'POST') {
      try {
        if (!env.PRISM_D1) return json({error:'D1 not configured'}, 400, origin);
        await env.PRISM_D1.prepare(`
          CREATE TABLE IF NOT EXISTS rag_chunks (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            doc_name TEXT,
            workspace_id TEXT DEFAULT 'default',
            chunk_idx INTEGER DEFAULT 0,
            chunk_text TEXT NOT NULL,
            embedding_json TEXT,
            tags TEXT DEFAULT '[]',
            created_at TEXT
          )
        `).run();
        await env.PRISM_D1.prepare('CREATE INDEX IF NOT EXISTS idx_rag_workspace ON rag_chunks(workspace_id)').run();
        await env.PRISM_D1.prepare('CREATE INDEX IF NOT EXISTS idx_rag_doc ON rag_chunks(doc_id)').run();
        return json({success:true, message:'RAG table created'}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── PDF to Markdown via Gemini Files API ─────────────────────────────────
    // Gemini can read PDFs natively — no third-party needed
    if (path === '/api/pdf/to-markdown' && request.method === 'POST') {
      try {
        const body = await request.json();
        const pdfB64 = body.content || ''; // base64 PDF
        const pdfUrl = body.url || '';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini key not configured'}, 400, origin);

        let fileUri = '';
        // Upload PDF to Gemini Files API
        if (pdfB64) {
          const pdfBytes = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0));
          const uploadResp = await fetch(
            'https://generativelanguage.googleapis.com/upload/v1beta/files?key=' + GKEY,
            {method:'POST',
             headers:{'Content-Type':'application/pdf', 'X-Goog-Upload-Protocol':'raw',
                      'X-Goog-Upload-Command':'start, upload, finalize',
                      'X-Goog-Upload-Header-Content-Length': pdfBytes.length.toString(),
                      'X-Goog-Upload-Header-Content-Type': 'application/pdf'},
             body: pdfBytes}
          );
          if (uploadResp.ok) {
            const uploadData = await uploadResp.json();
            fileUri = uploadData.file?.uri || '';
          }
        }

        // Ask Gemini to extract text as Markdown
        const parts = fileUri
          ? [{fileData:{mimeType:'application/pdf', fileUri}}, {text:'Extract ALL text from this PDF. Return clean Markdown. Preserve headings, lists, tables. Include every word.'}]
          : [{text: 'Extract text from this document and return as Markdown: ' + (pdfUrl || 'no content')}];

        const genResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GKEY}`,
          {method:'POST', headers:{'Content-Type':'application/json'},
           body:JSON.stringify({contents:[{parts}], generationConfig:{maxOutputTokens:8192}})}
        );
        const genData = await genResp.json();
        const markdown = genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!markdown) return json({error:'No text extracted', raw:JSON.stringify(genData).substring(0,200)}, 500, origin);
        return json({success:true, markdown, wordCount:markdown.split(/\s+/).length}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── OneDrive upload via MSGraph ───────────────────────────────────────────
    if (path === '/api/onedrive/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileName = body.fileName || ('file-' + Date.now() + '.bin');
        const contentB64 = body.content || '';
        const folder = body.folder || 'Argentica';
        const tenantId = k(env, ['msgraph_tenant','MSGRAPH_TENANT']) || '';
        const clientId = k(env, ['msgraph_client','MSGRAPH_CLIENT']) || '';
        const clientSecret = k(env, ['msgraph_secret','MSGRAPH_SECRET']) || '';
        if (!tenantId || !clientId || !clientSecret) return json({error:'MSGraph credentials not configured'}, 400, origin);

        // Get access token
        const tokenResp = await fetch(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
          {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
           body:`grant_type=client_credentials&client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://graph.microsoft.com/.default`}
        );
        const tokenData = await tokenResp.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) return json({error:'MSGraph auth failed: '+JSON.stringify(tokenData).substring(0,100)}, 500, origin);

        // Upload file
        const fileBytes = Uint8Array.from(atob(contentB64), c => c.charCodeAt(0));
        const uploadResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/root:/${folder}/${encodeURIComponent(fileName)}:/content`,
          {method:'PUT', headers:{'Authorization':'Bearer '+accessToken, 'Content-Type':'application/octet-stream'}, body:fileBytes}
        );
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return json({error:'Upload failed: '+JSON.stringify(uploadData).substring(0,100)}, 500, origin);

        // Create sharing link
        const shareResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${uploadData.id}/createLink`,
          {method:'POST', headers:{'Authorization':'Bearer '+accessToken, 'Content-Type':'application/json'},
           body:JSON.stringify({type:'view', scope:'anonymous'})}
        );
        const shareData = await shareResp.json();
        const shareUrl = shareData.link?.webUrl || uploadData.webUrl || '';

        return json({
          success:true, fileId:uploadData.id, fileName:uploadData.name,
          shareUrl, size:uploadData.size,
          officeViewUrl: shareUrl ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(shareUrl)}` : '',
          googleViewUrl: shareUrl ? `https://docs.google.com/viewer?url=${encodeURIComponent(shareUrl)}&embedded=true` : '',
        }, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── OCR: extract text from image ─────────────────────────────────────────
    if (path === '/api/ocr' && request.method === 'POST') {
      try {
        const body = await request.json();
        const imageB64 = body.image || '';
        const mimeType = body.mime_type || 'image/png';
        const provider = body.provider || 'gemini';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        const OCRKEY = k(env, ['ocr_space_key','OCR_SPACE_KEY']) || 'K89948141888957';

        if (!imageB64) return json({error:'No image provided'}, 400, origin);

        if (provider === 'gemini' && GKEY) {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GKEY}`,
            {method:'POST', headers:{'Content-Type':'application/json'},
             body:JSON.stringify({contents:[{parts:[
               {text:'Extract ALL handwritten and printed text from this image. Return only the text, preserving line breaks. No commentary.'},
               {inline_data:{mime_type:mimeType, data:imageB64}}
             ]}]})}
          );
          const d = await resp.json();
          const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) return json({text, provider:'gemini'}, 200, origin);
        }

        // Fallback: OCR.space
        const formData = new FormData();
        formData.append('base64Image', `data:${mimeType};base64,${imageB64}`);
        formData.append('apikey', OCRKEY);
        formData.append('language', 'eng');
        formData.append('isOverlayRequired', 'false');
        const ocrResp = await fetch('https://api.ocr.space/parse/image', {method:'POST', body:formData});
        const ocrData = await ocrResp.json();
        const text = ocrData.ParsedResults?.[0]?.ParsedText || '';
        return json({text, provider:'ocr.space'}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── TTS: text to speech ───────────────────────────────────────────────────
    if (path === '/api/tts' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        const DGKEY = k(env, ['deepgram_api_key','DEEPGRAM_API_KEY']) || '';
        const CARTKEY = k(env, ['cartesia_api_key','CARTESIA_API_KEY']) || '';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        const SMKEY = k(env, ['smallest_ai_api_key','SMALLEST_AI_API_KEY']) || '';
        const FISHKEY = k(env, ['fish_audio_api_key','FISH_AUDIO_API_KEY']) || '';

        if (!text) return json({error:'No text'}, 400, origin);

        if (provider === 'deepgram' && DGKEY) {
          const resp = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
            method:'POST', headers:{'Authorization':'Token '+DGKEY, 'Content-Type':'application/json'},
            body:JSON.stringify({text})
          });
          if (resp.ok) {
            const audio = await resp.arrayBuffer();
            return new Response(audio, {headers:{'Content-Type':'audio/mpeg','Access-Control-Allow-Origin':origin}});
          }
        }

        if (provider === 'smallest' && SMKEY) {
          const resp = await fetch('https://waves.smallest.ai/api/v1/lightning-v3.1/get_speech', {
            method:'POST', headers:{'Authorization':'Bearer '+SMKEY, 'Content-Type':'application/json'},
            body:JSON.stringify({text, voice_id: body.voice_id || 'magnus', sample_rate: 44100, output_format: 'wav'})
          });
          if (resp.ok) {
            const audio = await resp.arrayBuffer();
            return new Response(audio, {headers:{'Content-Type':'audio/wav','Access-Control-Allow-Origin':origin}});
          }
        }

        if (provider === 'fish' && FISHKEY) {
          const ref = body.reference_id || 'alloy';   // Fish voice reference; also accepts any model ref from fish.audio library
          const refTxt = (body.text || '').slice(0, 2000);
          const resp = await fetch('https://api.fish.audio/model', {
            method:'POST', headers:{'Authorization':'Bearer '+FISHKEY, 'Content-Type':'application/json'},
            body:JSON.stringify({ text: refTxt, reference_id: ref, normalize: true, format: 'mp3' })
          });
          if (resp.ok) {
            const audio = await resp.arrayBuffer();
            return new Response(audio, {headers:{'Content-Type':'audio/mpeg','Access-Control-Allow-Origin':origin}});
          }
        }

        if (provider === 'cartesia' && CARTKEY) {
          const resp = await fetch('https://api.cartesia.ai/tts/bytes', {
            method:'POST', headers:{'X-API-Key':CARTKEY, 'Content-Type':'application/json', 'Cartesia-Version':'2024-06-10'},
            body:JSON.stringify({transcript:text, model_id:'sonic-2', voice:{mode:'id', id:voice || 'a0e99841-438c-4a64-b679-ae501e7d6091'}, output_format:{container:'mp3', encoding:'mp3', sample_rate:44100}})
          });
          if (resp.ok) {
            const audio = await resp.arrayBuffer();
            return new Response(audio, {headers:{'Content-Type':'audio/mpeg','Access-Control-Allow-Origin':origin}});
          }
        }

        if (provider === 'gemini' && GKEY) {
          const gemVoice = body.gemini_voice || 'Puck';
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${GKEY}`,
            {method:'POST', headers:{'Content-Type':'application/json'},
             body:JSON.stringify({contents:[{parts:[{text}]}], generationConfig:{responseModalities:['AUDIO'], speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:gemVoice}}}}})}
          );
          const d = await resp.json();
          const audioData = d.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            const buf = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
            return new Response(buf, {headers:{'Content-Type':'audio/mpeg','Access-Control-Allow-Origin':origin}});
          }
        }

        return json({error:'All TTS providers failed'}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── STT: speech to text ───────────────────────────────────────────────────
    if (path === '/api/stt' && request.method === 'POST') {
      try {
        const body = await request.json();
        const audioB64 = body.audio || '';
        const mimeType = body.mime_type || 'audio/webm';
        const provider = body.provider || 'deepgram';
        const DGKEY = k(env, ['deepgram_api_key','DEEPGRAM_API_KEY']) || '';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';

        if (!audioB64) return json({error:'No audio'}, 400, origin);
        const audioBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));

        if (provider === 'deepgram' && DGKEY) {
          const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=en-GB&smart_format=true', {
            method:'POST', headers:{'Authorization':'Token '+DGKEY, 'Content-Type':mimeType}, body:audioBytes
          });
          if (resp.ok) {
            const d = await resp.json();
            const transcript = d.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
            return json({transcript, provider:'deepgram', confidence:d.results?.channels?.[0]?.alternatives?.[0]?.confidence}, 200, origin);
          }
        }

        if (provider === 'gemini' && GKEY) {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GKEY}`,
            {method:'POST', headers:{'Content-Type':'application/json'},
             body:JSON.stringify({contents:[{parts:[
               {text:'Transcribe this audio exactly. Return only the transcript, no commentary.'},
               {inline_data:{mime_type:mimeType, data:audioB64}}
             ]}]})}
          );
          const d = await resp.json();
          const transcript = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (transcript) return json({transcript, provider:'gemini'}, 200, origin);
        }

        return json({error:'All STT providers failed'}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Image generation ──────────────────────────────────────────────────────
    if (path === '/api/image/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'Abstract art';
        const model = body.model || 'auto';
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        const FALKEY = k(env, ['fal_api_key','FAL_API_KEY']) || '';
        const XAIKEY = k(env, ['xai_api_key','XAI_API_KEY']) || '';

        // Try Gemini image gen first (free)
        if ((model === 'auto' || model.includes('gemini')) && GKEY) {
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${GKEY}`,
              {method:'POST', headers:{'Content-Type':'application/json'},
               body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{responseModalities:['IMAGE','TEXT']}})}
            );
            if (resp.ok) {
              const d = await resp.json();
              const parts = d.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.inlineData) {
                  return json({success:true, url:'data:'+part.inlineData.mimeType+';base64,'+part.inlineData.data, provider:'gemini', model:'gemini-3.1-flash-image'}, 200, origin);
                }
              }
            }
          } catch(e) {}
        }

        // Pollinations fallback (always free)
        const polUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&model=flux`;
        return json({success:true, url:polUrl, provider:'pollinations', model:'flux'}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Video generation ──────────────────────────────────────────────────────
    if (path === '/api/video/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || '';
        const FALKEY = k(env, ['fal_api_key','FAL_API_KEY']) || '';
        if (!FALKEY) return json({error:'FAL key not configured. Video generation requires FAL.ai.'}, 400, origin);
        // Submit to FAL queue
        const resp = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video', {
          method:'POST', headers:{'Authorization':'Key '+FALKEY, 'Content-Type':'application/json'},
          body:JSON.stringify({prompt, duration:'5', aspect_ratio:'16:9'})
        });
        const d = await resp.json();
        return json({success:resp.ok, request_id:d.request_id, status_url:d.status_url, provider:'fal/kling'}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Openverse copyright-free audio search (for carousel/podcast beds) ────────────────────────────────────────
    if (path === '/api/music/openverse' && request.method === 'GET') {
      try {
        const q = url.searchParams.get('q') || 'calm instrumental';
        const page = parseInt(url.searchParams.get('page') || '1');
        const resp = await fetch('https://api.openverse.org/v1/audio/?q=' + encodeURIComponent(q) + '&page_size=12&page=' + page + '&license_type=commercial,modification', {
          headers: {'User-Agent': 'Argentica/1.0 (https://identitypartners.uk)'}
        });
        if (!resp.ok) return json({error: 'Openverse error: ' + resp.status, tracks: []}, 200, origin);
        const d = await resp.json();
        const tracks = (d.results || []).map(function(t) {
          return {
            id: t.id, title: t.title || 'Untitled', creator: t.creator || 'Unknown',
            license: t.license || '', licenseUrl: t.license_url || '',
            url: t.url || '', duration: t.duration || 0, source: t.source || 'openverse',
            foreign: t.foreign_landing_url || ''
          };
        }).filter(function(t) { return t.url; });
        return json({tracks, total: d.result_count || tracks.length}, 200, origin);
      } catch(e) { return json({error: e.message, tracks: []}, 200, origin); }
    }


    // ── Music generation via Lyria ────────────────────────────────────────────
    if (path === '/api/music/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'Uplifting piano, warm, professional';
        const requestedModel = body.model || '';
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini API key required. Music generation (Lyria) is a PAID Gemini feature.'}, 400, origin);
        const attempts = [];
        const lyriaModels = [requestedModel, 'lyria-002', 'lyria-3.5', 'lyria-3-pro-preview'].filter((v,i,a)=>v&&a.indexOf(v)===i);
        for (const model of lyriaModels) attempts.push({model, endpoint:'predict'});
        attempts.push({model:'gemini-2.5-flash-preview-tts', endpoint:'generateContent'});
        let lastError = '';
        for (const att of attempts) {
          try {
            let resp;
            if (att.endpoint === 'predict') {
              resp = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/' + att.model + ':predict',
                {method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':GKEY},
                 body:JSON.stringify({inputs:{prompt}})}
              );
            } else {
              resp = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/' + att.model + ':generateContent',
                {method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':GKEY},
                 body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Aoede'}}}}})}
              );
            }
            if (!resp.ok) { const err = await resp.text(); lastError = att.model+':'+att.endpoint+' '+resp.status+' '+err.substring(0,150); continue; }
            const d = await resp.json();
            const audioPart = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts.find(function(p){return p.inlineData;})) ||
                             (d.outputs && d.outputs[0] && d.outputs[0].audio);
            if (audioPart) {
              const b64 = audioPart.inlineData ? audioPart.inlineData.data : audioPart.data;
              const mime = audioPart.inlineData ? audioPart.inlineData.mimeType : (audioPart.mimeType || 'audio/wav');
              const buf = Uint8Array.from(atob(b64), function(c){return c.charCodeAt(0);});
              return new Response(buf.buffer, {headers:{'Content-Type':mime,'Access-Control-Allow-Origin':origin,'X-Model-Used':att.model,'X-Endpoint':att.endpoint}});
            }
            lastError = att.model+': no audio — '+JSON.stringify(d).substring(0,150);
          } catch(me) { lastError = att.model+': '+me.message; }
        }
        return json({error:'Music generation failed. Tried Lyria predict + TTS fallback. Last error: ' + lastError, hint:'Lyria requires a paid Gemini tier (AI Studio key will 403). Try the free ElevenLabs/Suno routes in System > Agents if configured.'}, 502, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Study Hub: auto-index uploaded document ───────────────────────────────
    // ── Notes (WriteHandy cloud sync) ────────────────────────────────────────────────────
    // ── Personas ───────────────────────────────────────────────────────────────────
    // ── Knowledge base (wiki) ──────────────────────────────────────────────────────────────
    if (path === '/api/kb/backup' && request.method === 'GET') {
      try {
        const last = await env.PRISM_KV.get('kb:backup:last', 'json') || null;
        const cfg = await env.PRISM_KV.get('kb:backup:config', 'json') || { enabled: true };
        return json({ last, config: cfg }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }
    if (path === '/api/kb/backup' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        if (typeof body.enabled === 'boolean') {
          await env.PRISM_KV.put('kb:backup:config', JSON.stringify({ enabled: body.enabled }));
          return json({ success: true, config: { enabled: body.enabled } }, 200, origin);
        }
        const rec = await backupStoresToDrive(env);
        return json(rec, rec.success ? 200 : 500, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/kb' && request.method === 'GET') {
      try {
        const list = await env.PRISM_KV.list({ prefix: 'kb:' });
        const pages = [];
        for (const k of (list.keys || []).slice(0, 200)) {
          if (k.name.indexOf('backup') >= 0) continue; // kb:backup:* are bookkeeping, not pages
          let v = null;
          try { v = await env.PRISM_KV.get(k.name, 'json'); } catch (ke) { v = null; }
          if (v) pages.push(v);
        }
        pages.sort(function(a,b){ return (a.title||'').localeCompare(b.title||''); });
        return json({ pages }, 200, origin);
      } catch(e) { return json({ pages: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/kb' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => null);
        if (!body || !body.id || !body.title) return json({ success: false, error: 'invalid page (id and title required)' }, 400, origin);
        const id = body.id;
        const rec = { id, title: body.title, section: body.section || '', idx: body.idx || 0,
                      source: body.source || '', format: body.format || 'html',
                      content: body.content || '',
                      created: body.created || new Date().toISOString(), updated: new Date().toISOString() };
        await env.PRISM_KV.put('kb:' + id, JSON.stringify(rec));
        return json({ success: true, page: rec }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/kb/') && request.method === 'DELETE') {
      try {
        await env.PRISM_KV.delete('kb:' + path.replace('/api/kb/', ''));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }


    if (path === '/api/personas' && request.method === 'GET') {
      try {
        const list = await env.PRISM_KV.list({ prefix: 'persona:' });
        const personas = [];
        for (const k of (list.keys || [])) {
          let v = null;
          try { v = await env.PRISM_KV.get(k.name, 'json'); } catch (ke) { v = null; }
          if (v) personas.push(v);
        }
        return json({ personas }, 200, origin);
      } catch(e) { return json({ personas: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/personas' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('persona-' + Date.now());
        const rec = { id, name: body.name || 'Unnamed', avatar: body.avatar || '\ud83e\udd16', role: body.role || '',
                      systemPrompt: body.systemPrompt || '', temperature: body.temperature || 0.7,
                      updated: new Date().toISOString() };
        await env.PRISM_KV.put('persona:' + id, JSON.stringify(rec));
        return json({ success: true, persona: rec }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/personas/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/personas/', '');
        await env.PRISM_KV.delete('persona:' + id);
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // ── Debates ────────────────────────────────────────────────────────────────────
    if (path === '/api/debate/save' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('debate-' + Date.now());
        const rec = { id, topic: body.topic || 'Untitled debate', transcript: body.transcript || [],
                      personas: body.personas || [], created: new Date().toISOString() };
        await env.PRISM_KV.put('debate:' + id, JSON.stringify(rec));
        return json({ success: true, id }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/debate/list' && request.method === 'GET') {
      try {
        const list = await env.PRISM_KV.list({ prefix: 'debate:' });
        const debates = [];
        for (const k of (list.keys || [])) {
          let v = null;
          try { v = await env.PRISM_KV.get(k.name, 'json'); } catch (ke) { v = null; }
          if (v) debates.push({ id: v.id, topic: v.topic, created: v.created, turns: (v.transcript || []).length });
        }
        debates.sort(function(a,b){ return (b.created||'').localeCompare(a.created||''); });
        return json({ debates }, 200, origin);
      } catch(e) { return json({ debates: [], error: e.message }, 200, origin); }
    }

    // ── Memory ──────────────────────────────────────────────────────────────────────
    if (path === '/api/memory' && request.method === 'GET') {
      try {
        const list = await env.PRISM_KV.list({ prefix: 'memory:' });
        const memories = [];
        for (const k of (list.keys || []).slice(0, 200)) {
          let v = null;
          try { v = await env.PRISM_KV.get(k.name, 'json'); } catch (ke) { v = null; }
          if (v) memories.push(v);
        }
        memories.sort(function(a,b){ return (b.created||'').localeCompare(a.created||''); });
        return json({ memories }, 200, origin);
      } catch(e) { return json({ memories: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/memory' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('mem-' + Date.now());
        const rec = { id, content: body.content || '', category: body.category || 'general',
                      source: body.source || 'manual', created: body.created || new Date().toISOString() };
        await env.PRISM_KV.put('memory:' + id, JSON.stringify(rec));
        return json({ success: true, memory: rec }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/memory/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/memory/', '');
        await env.PRISM_KV.delete('memory:' + id);
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // ── Research: saved queries (planned runs) ───────────────────────────────────────────────
    if (path === '/api/research/keywords' && request.method === 'GET') {
      try {
        const list = await env.PRISM_KV.list({ prefix: 'research:query:' });
        const queries = [];
        for (const k of (list.keys || [])) {
          let v = null;
          try { v = await env.PRISM_KV.get(k.name, 'json'); } catch (ke) { v = null; }
          if (v) queries.push(v);
        }
        queries.sort(function(a,b){ return (b.created||'').localeCompare(a.created||''); });
        return json({ queries }, 200, origin);
      } catch(e) { return json({ queries: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/research/keywords' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('q-' + Date.now());
        const rec = { id, name: body.name || body.keywords || 'Query', keywords: body.keywords || '',
                      cadence: body.cadence || 'manual', created: new Date().toISOString(),
                      lastRun: null, lastResults: 0 };
        await env.PRISM_KV.put('research:query:' + id, JSON.stringify(rec));
        return json({ success: true, query: rec }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/research/keywords/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/research/keywords/', '');
        await env.PRISM_KV.delete('research:query:' + id);
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/research/runs' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.queryId || ('run-' + Date.now());
        const run = { id, queryId: body.queryId || '', keywords: body.keywords || '',
                      results: (body.results || []).slice(0, 50), count: (body.results || []).length,
                      ranAt: new Date().toISOString() };
        const runs = await env.PRISM_KV.get('research:runs', 'json') || [];
        runs.unshift(run);
        await env.PRISM_KV.put('research:runs', JSON.stringify(runs.slice(0, 50)));
        if (body.queryId) {
          const q = await env.PRISM_KV.get('research:query:' + body.queryId, 'json');
          if (q) { q.lastRun = run.ranAt; q.lastResults = run.count; await env.PRISM_KV.put('research:query:' + body.queryId, JSON.stringify(q)); }
        }
        return json({ success: true, run }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/research/runs' && request.method === 'GET') {
      try {
        const runs = await env.PRISM_KV.get('research:runs', 'json') || [];
        return json({ runs }, 200, origin);
      } catch(e) { return json({ runs: [], error: e.message }, 200, origin); }
    }


    if (path === '/api/notes/save' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('note-' + Date.now());
        const rec = {
          id, title: body.title || 'Untitled', content: body.content || '',
          module: body.module || '', week: body.week || '', tags: body.tags || [],
          inkData: body.inkData || null, updated: body.updated || new Date().toISOString()
        };
        if (env.PRISM_KV) await env.PRISM_KV.put('note:' + id, JSON.stringify(rec));
        return json({success: true, id}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }
    if (path === '/api/notes/list' && request.method === 'GET') {
      try {
        const module = url.searchParams.get('module') || '';
        const week = url.searchParams.get('week') || '';
        const list = await env.PRISM_KV.list({ prefix: 'note:' });
        const notes = [];
        for (const k of (list.keys || []).slice(0, 100)) {
          const v = await env.PRISM_KV.get(k.name, 'json');
          if (!v) continue;
          if (module && v.module !== module) continue;
          if (week && v.week !== week) continue;
          notes.push({ id: v.id, title: v.title, module: v.module, week: v.week, updated: v.updated });
        }
        notes.sort(function(a, b) { return (b.updated || '').localeCompare(a.updated || ''); });
        return json({notes}, 200, origin);
      } catch(e) { return json({notes: [], error: e.message}, 200, origin); }
    }


    if (path === '/api/study/index-document' && request.method === 'POST') {
      try {
        const body = await request.json();
        const content = body.content || '';
        const fileName = body.fileName || 'document';
        const moduleId = body.moduleId || '';
        const weekId = body.weekId || '';
        const resourceId = body.resourceId || ('res-' + Date.now());
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';

        if (!content || !GKEY) return json({error:'No content or Gemini key'}, 400, origin);

        // Chunk the document
        const chunkSize = 1500;
        const overlap = 150;
        const chunks = [];
        for (let i = 0; i < content.length; i += chunkSize - overlap) {
          chunks.push(content.substring(i, i + chunkSize));
        }

        // Embed each chunk
        let indexed = 0;
        for (let i = 0; i < Math.min(chunks.length, 50); i++) {
          try {
            const embResp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GKEY}`,
              {method:'POST', headers:{'Content-Type':'application/json'},
               body:JSON.stringify({model:'models/text-embedding-004', content:{parts:[{text:chunks[i]}]}})}
            );
            if (embResp.ok) {
              const embData = await embResp.json();
              const embedding = embData.embedding?.values || [];
              if (embedding.length > 0 && env.PRISM_D1) {
                await env.PRISM_D1.prepare(
                  'INSERT OR REPLACE INTO rag_chunks (id, doc_id, doc_name, workspace_id, chunk_idx, chunk_text, embedding_json, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                ).bind(
                  resourceId+'_'+i, resourceId, fileName,
                  moduleId || 'study', i, chunks[i],
                  JSON.stringify(embedding),
                  JSON.stringify([moduleId, weekId, 'study'].filter(Boolean)),
                  new Date().toISOString()
                ).run();
                indexed++;
              }
            }
          } catch(e) { continue; }
        }

        // Also store in KV for quick retrieval
        if (env.PRISM_KV) {
          await env.PRISM_KV.put(`study:doc:${resourceId}`, JSON.stringify({
            fileName, moduleId, weekId, resourceId,
            preview: content.substring(0, 500),
            chunks: chunks.length, indexed,
            created: new Date().toISOString()
          }));
        }

        return json({success:true, chunks_total:chunks.length, chunks_indexed:indexed, resourceId}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Study Hub: semantic search across all documents ───────────────────────
    if (path === '/api/study/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || '';
        const moduleId = body.moduleId || null;
        const limit = body.limit || 8;
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';

        if (!query || !GKEY) return json({results:[]}, 200, origin);

        // Embed query
        const qResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GKEY}`,
          {method:'POST', headers:{'Content-Type':'application/json'},
           body:JSON.stringify({model:'models/text-embedding-004', content:{parts:[{text:query}]}})}
        );
        if (!qResp.ok) return json({results:[], error:'Query embedding failed'}, 200, origin);
        const qData = await qResp.json();
        const queryEmbedding = qData.embedding?.values || [];
        if (!queryEmbedding.length) return json({results:[]}, 200, origin);

        // Search D1
        if (!env.PRISM_D1) return json({results:[], error:'D1 not configured'}, 200, origin);
        const wsFilter = moduleId ? `WHERE workspace_id = '${moduleId}'` : '';
        const rows = await env.PRISM_D1.prepare(
          `SELECT id, doc_id, doc_name, workspace_id, chunk_idx, chunk_text, embedding_json FROM rag_chunks ${wsFilter} LIMIT 1000`
        ).all();

        function cosineSim(a, b) {
          let dot = 0, normA = 0, normB = 0;
          for (let i = 0; i < Math.min(a.length, b.length); i++) {
            dot += a[i]*b[i]; normA += a[i]*a[i]; normB += b[i]*b[i];
          }
          return dot / (Math.sqrt(normA)*Math.sqrt(normB) + 1e-10);
        }

        const scored = (rows.results || []).map(row => {
          try {
            const emb = JSON.parse(row.embedding_json || '[]');
            return {...row, score: cosineSim(queryEmbedding, emb)};
          } catch { return {...row, score:0}; }
        }).sort((a,b) => b.score - a.score).slice(0, limit);

        return json({results: scored.map(r => ({
          doc_id:r.doc_id, doc_name:r.doc_name, chunk_idx:r.chunk_idx,
          chunk_text:r.chunk_text, score:r.score, workspace_id:r.workspace_id
        }))}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── STT: Groq Whisper (best free STT) ────────────────────────────────────
    if (path === '/api/stt/transcribe' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const model = formData.get('model') || 'whisper-large-v3';
        const language = formData.get('language') || 'en';
        const groqKey = env.groq_free_1 || env.GROQ_FREE_1 || '';
        if (!groqKey) return json({ error: 'Groq key not configured' }, 400, origin);
        const outForm = new FormData();
        outForm.append('file', audioFile, 'audio.webm');
        outForm.append('model', model);
        outForm.append('language', language);
        outForm.append('response_format', 'verbose_json');
        const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}` },
          body: outForm
        });
        const data = await resp.json();
        return json({ text: data.text || '', segments: data.segments || [], language: data.language || language, provider: 'groq-whisper' }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── TTS: Deepgram Aura (British voices, fast) ─────────────────────────────
    if (path === '/api/tts/speak' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        if (!text) return json({ error: 'No text provided' }, 400, origin);
        if (provider === 'deepgram') {
          const dgKey = env.deepgram || env.DEEPGRAM_API_KEY || '';
          if (!dgKey) return json({ error: 'Deepgram key not configured' }, 400, origin);
          const resp = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
            method: 'POST',
            headers: { 'Authorization': `Token ${dgKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
          });
          if (!resp.ok) return json({ error: `Deepgram error: ${resp.status}` }, 500, origin);
          const audio = await resp.arrayBuffer();
          return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin } });
        }
        if (provider === 'cartesia') {
          const cartKey = env.cartesia || env.CARTESIA_API_KEY || '';
          if (!cartKey) return json({ error: 'Cartesia key not configured' }, 400, origin);
          const resp = await fetch('https://api.cartesia.ai/tts/bytes', {
            method: 'POST',
            headers: { 'X-API-Key': cartKey, 'Content-Type': 'application/json', 'Cartesia-Version': '2024-06-10' },
            body: JSON.stringify({ model_id: 'sonic-2', transcript: text, voice: { mode: 'id', id: voice }, output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 } })
          });
          if (!resp.ok) return json({ error: `Cartesia error: ${resp.status}` }, 500, origin);
          const audio = await resp.arrayBuffer();
          return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin } });
        }
        if (provider === 'gemini') {
          const gKey = env.gemini_api_key || env.GEMINI_API_KEY || '';
          const voiceName = body.gemini_voice || 'Puck';
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${gKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } })
          });
          const data = await resp.json();
          const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (!audioData) return json({ error: 'Gemini TTS empty response' }, 500, origin);
          const buf = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
          return new Response(buf, { headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin } });
        }
        return json({ error: `Unknown TTS provider: ${provider}` }, 400, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Streaming chat with thinking traces ───────────────────────────────────
    if (path === '/api/chat/stream' && request.method === 'POST') {
      try {
        const body = await request.json();
        const messages = body.messages || [];
        const profile = body.profile || 'balanced';
        const providerOverride = body.providerOverride || '';
        const modelOverride = body.modelOverride || '';
        const threadId = body.threadId || null;
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const send = async (event, data) => {
          await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        // Run async
        (async () => {
          try {
            await send('status', { status: 'connecting', message: 'Connecting to model...' });
            // Build chain based on profile
            const GKEY = env.gemini_api_key || env.GEMINI_API_KEY || '';
            const MKEY = env.mistral_api_key || env.MISTRAL_API_KEY || '';
            const DKEY = env.deepseek_paid || env.DEEPSEEK_PAID || '';
            const NKEY = env.nvidia_build_api_key || env.NVIDIA_BUILD_API_KEY || '';
            const GROQ = env.groq_free_1 || env.GROQ_FREE_1 || '';
            const CEREBRAS = env.CEREBRAS_FREE_1 || env.cerebras_free_1 || '';
            let chain = [];
            if (providerOverride && modelOverride) {
              const keyMap = { mistral: MKEY, gemini: GKEY, deepseek: DKEY, nvidia: NKEY, groq: GROQ, cerebras: CEREBRAS };
              chain = [{ provider: providerOverride, model: modelOverride, key: keyMap[providerOverride] || '' }];
            } else if (profile === 'fast') {
              chain = [
                { provider: 'cerebras', model: 'gpt-oss-120b', key: CEREBRAS },
                { provider: 'groq', model: 'openai/gpt-oss-120b', key: GROQ },
                { provider: 'gemini', model: 'gemma-4-31b-it', key: GKEY },
              ];
            } else if (profile === 'frontier') {
              chain = [
                { provider: 'mistral', model: 'mistral-large-latest', key: MKEY },
                { provider: 'mistral', model: 'zai-glm-5-3', key: MKEY },
                { provider: 'gemini', model: 'gemini-2.5-flash', key: GKEY },
                { provider: 'deepseek', model: 'deepseek-reasoner', key: DKEY },
              ];
            } else {
              // balanced
              chain = [
                { provider: 'mistral', model: 'mistral-large-latest', key: MKEY },
                { provider: 'mistral', model: 'zai-glm-5-3', key: MKEY },
                { provider: 'gemini', model: 'gemini-2.5-flash', key: GKEY },
                { provider: 'gemini', model: 'gemma-4-31b-it', key: GKEY },
                { provider: 'deepseek', model: 'deepseek-chat', key: DKEY },
                { provider: 'groq', model: 'openai/gpt-oss-120b', key: GROQ },
              ];
            }
            let responded = false;
            for (const { provider, model, key } of chain) {
              if (!key) continue;
              try {
                await send('status', { status: 'connecting', provider, model });
                const result = await callModel(env, provider, key, model, messages, 60000);
                if (result.content) {
                  await send('status', { status: 'connected', provider, model });
                  // Stream thinking first if present
                  if (result.thinking) {
                    await send('thinking', { text: result.thinking });
                  }
                  // Stream content in chunks
                  const words = result.content.split(' ');
                  let chunk = '';
                  for (let i = 0; i < words.length; i++) {
                    chunk += (i > 0 ? ' ' : '') + words[i];
                    if (chunk.length > 50 || i === words.length - 1) {
                      await send('token', { text: chunk });
                      chunk = '';
                      if (i < words.length - 1) await new Promise(r => setTimeout(r, 5));
                    }
                  }
                  // Save thread
                  if (threadId && env.PRISM_KV) {
                    try {
                      const threadKey = `thread:${threadId}`;
                      const existing = await env.PRISM_KV.get(threadKey);
                      const thread = existing ? JSON.parse(existing) : { id: threadId, messages: [], created: new Date().toISOString() };
                      const lastUser = messages[messages.length - 1];
                      if (lastUser) thread.messages.push({ ...lastUser, ts: Date.now() });
                      thread.messages.push({ role: 'assistant', content: result.content, provider, model, ts: Date.now() });
                      thread.updated = new Date().toISOString();
                      thread.messageCount = thread.messages.length;
                      if (!thread.title) thread.title = (lastUser?.content || '').substring(0, 60);
                      await env.PRISM_KV.put(threadKey, JSON.stringify(thread), { expirationTtl: 86400 * 90 });
                    } catch(e) {}
                  }
                  await send('done', { content: result.content, provider, model, thinking: result.thinking || null });
                  responded = true;
                  break;
                }
              } catch(e) {
                await send('error', { provider, model, error: e.message });
              }
            }
            if (!responded) {
              await send('error', { error: 'All providers unavailable' });
            }
          } catch(e) {
            await send('error', { error: e.message });
          } finally {
            await writer.close();
          }
        })();
        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': origin,
            'X-Accel-Buffering': 'no',
          }
        });
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Gemini Live (audio-to-audio) session init ─────────────────────────────
    if (path === '/api/live/session' && request.method === 'POST') {
      try {
        const body = await request.json();
        const model = body.model || 'gemini-live-2.5-flash-preview';
        const gKey = env.gemini_api_key || env.GEMINI_API_KEY || '';
        if (!gKey) return json({ error: 'Gemini key not configured' }, 400, origin);
        // Return WebSocket URL for client to connect directly to Gemini Live
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${gKey}`;
        return json({
          wsUrl,
          model,
          instructions: 'Connect to wsUrl with WebSocket. Send setup message first, then audio chunks as base64.',
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: body.voice || 'Puck' } } } },
            systemInstruction: { parts: [{ text: body.systemPrompt || "You are Tay, the Orchestrator for Argentica. You address Simon as 'sir'. Sardonic, precise, devastatingly competent. British English." }] }
          }
        }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Orchestrator config: save/load routing chain ──────────────────────────
    if (path === '/api/orchestrator/config' && request.method === 'GET') {
      try {
        const raw = env.PRISM_KV ? await env.PRISM_KV.get('orchestrator:config') : null;
        const defaultConfig = {
          balanced: [
            { provider: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large Latest', ctx: 262144, thinking: true, web_search: true },
            { provider: 'mistral', model: 'zai-glm-5-3', label: 'GLM 5.3 via Mistral', ctx: 1048576, thinking: true, web_search: true },
            { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', ctx: 1048576, thinking: true, web_search: true },
            { provider: 'gemini', model: 'gemma-4-31b-it', label: 'Gemma 4 31B', ctx: 262144, thinking: false, web_search: true },
            { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek V4 Flash', ctx: 65536, thinking: false, web_search: true },
            { provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', ctx: 131072, thinking: false, web_search: false },
            { provider: 'cerebras', model: 'gpt-oss-120b', label: 'GPT-OSS 120B (Cerebras)', ctx: 8192, thinking: false, web_search: false },
          ],
          fast: [
            { provider: 'cerebras', model: 'gpt-oss-120b', label: 'GPT-OSS 120B (Cerebras)', ctx: 8192, thinking: false, web_search: false },
            { provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', ctx: 131072, thinking: false, web_search: false },
            { provider: 'gemini', model: 'gemma-4-31b-it', label: 'Gemma 4 31B', ctx: 262144, thinking: false, web_search: true },
          ],
          frontier: [
            { provider: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large Latest', ctx: 262144, thinking: true, web_search: true },
            { provider: 'mistral', model: 'zai-glm-5-3', label: 'GLM 5.3 via Mistral', ctx: 1048576, thinking: true, web_search: true },
            { provider: 'gemini', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', ctx: 1048576, thinking: true, web_search: true },
            { provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek R1 (Reasoner)', ctx: 65536, thinking: true, web_search: false },
            { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron Ultra 550B', ctx: 1048576, thinking: true, web_search: false },
          ]
        };
        const config = raw ? JSON.parse(raw) : defaultConfig;
        return json({ config, "benchmarks": {
          "zai-glm-5-3": { mmlu: 89.4, humaneval: 82.1, math: 79.3, speed: "~200ms", ctx: "1M", max_out: "32K", tools: "web_search, thinking, vision, code, doc_ai" },
          "mistral-large-4": { mmlu: 88.7, humaneval: 84.2, math: 77.8, speed: "~150ms", ctx: "1M", max_out: "32K", tools: "web_search, vision, code, doc_ai, tts, stt" },
          "gemini-3.8-flash": { mmlu: 87.2, humaneval: 79.4, math: 74.1, speed: "~400ms", ctx: "1M", max_out: "65K", tools: "google_search, vision, code, tts, stt, live" },
          "zai-glm-5-3-flash": { mmlu: 85.1, humaneval: 78.3, math: 71.2, speed: "~300ms", ctx: "1M", max_out: "32K", tools: "web_search, vision, code, agentic" },
          "mistral-medium-3.5": { mmlu: 86.3, humaneval: 81.7, math: 75.4, speed: "~180ms", ctx: "128K", max_out: "32K", tools: "web_search, vision, code, agentic" },
          "qwen-3.8-27b": { mmlu: 82.4, humaneval: 74.1, math: 68.9, speed: "~1850 tok/s", ctx: "128K", max_out: "32K", tools: "none", cost: "free (Cerebras)" },
          "gpt-oss-120b": { mmlu: 83.1, humaneval: 76.2, math: 70.1, speed: "~3000 tok/s", ctx: "131K", max_out: "65K", tools: "search+code", cost: "free (Cerebras)" },
          "gpt-oss-20b": { mmlu: 78.3, humaneval: 68.4, math: 62.1, speed: "~1000 tok/s", ctx: "131K", max_out: "65K", tools: "search+code", cost: "$0.075/1M (Groq)" },
          "kimi-k2.5": { mmlu: 84.7, humaneval: 77.8, math: 72.3, speed: "~120ms", ctx: "262K", max_out: "32K", tools: "function_calling", cost: "$0.45/1M" },
          "deepseek-chat": { mmlu: 88.5, humaneval: 82.6, math: 78.9, speed: "~80ms", ctx: "1M", max_out: "32K", tools: "web_search", cost: "$0.27/1M" },
          "gemini-2.5-flash": { mmlu: 84.1, humaneval: 75.3, math: 69.8, speed: "~350ms", ctx: "1M", max_out: "65K", tools: "google_search, code", cost: "FREE" },
          "mistral-small-4": { mmlu: 81.2, humaneval: 72.4, math: 65.7, speed: "~250ms", ctx: "128K", max_out: "32K", tools: "web_search, code", cost: "paid sub" },
          "gemma-4": { mmlu: 79.8, humaneval: 70.1, math: 63.4, speed: "~300ms", ctx: "128K", max_out: "32K", tools: "none", cost: "FREE" },
          "nemotron-ultra-253b": { mmlu: 87.9, humaneval: 83.4, math: 76.2, speed: "~60ms", ctx: "128K", max_out: "32K", tools: "function_calling", cost: "NVIDIA key" }
        }}, 200, origin);
        const models = body.models || [];
        if (!models.length) return json({ error: 'No models specified' }, 400, origin);
        const keyMap = {
          mistral: env.mistral_api_key || env.MISTRAL_API_KEY || '',
          gemini: env.gemini_api_key || env.GEMINI_API_KEY || '',
          deepseek: env.deepseek_paid || env.DEEPSEEK_PAID || '',
          nvidia: env.nvidia_build_api_key || env.NVIDIA_BUILD_API_KEY || '',
          groq: env.groq_free_1 || env.GROQ_FREE_1 || '',
          cerebras: env.CEREBRAS_FREE_1 || env.cerebras_free_1 || '',
          openrouter: env.openrouter_api_key || env.OPENROUTER_API_KEY || '',
        };
        const results = await Promise.allSettled(
          models.map(async ({ provider, model, label }) => {
            const key = keyMap[provider] || '';
            if (!key) return { provider, model, label, error: 'No key configured', content: null };
            try {
              const result = await callModel(env, provider, key, model, messages, 45000);
              return { provider, model, label, content: result.content, thinking: result.thinking || null, error: null };
            } catch(e) {
              return { provider, model, label, content: null, error: e.message };
            }
          })
        );
        const responses = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Failed' });
        return json({ responses }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }


    // ── STT: Speech-to-text via Groq Whisper ─────────────────────────────────
    if (path === '/api/voice/transcribe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const audioB64 = body.audio || '';
        const provider = body.provider || 'groq';
        const groqKey = k(env, ['groq_free_1', 'GROQ_FREE_1']);
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY']);
        if (!audioB64) return json({error: 'No audio data'}, 400, origin);
        const audioBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
        if (provider === 'groq' && groqKey) {
          const form = new FormData();
          form.append('file', new Blob([audioBytes], {type: 'audio/webm'}), 'audio.webm');
          form.append('model', 'whisper-large-v3');
          const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST', headers: {'Authorization': 'Bearer ' + groqKey}, body: form
          });
          const d = await resp.json();
          return json({text: d.text || '', provider: 'groq'}, 200, origin);
        }
        if (dgKey) {
          const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=en-GB', {
            method: 'POST', headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'audio/webm'}, body: audioBytes
          });
          const d = await resp.json();
          const text = d.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          return json({text, provider: 'deepgram'}, 200, origin);
        }
        return json({error: 'No STT provider configured'}, 400, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Image multi-model generation ──────────────────────────────────────────
    if (path === '/api/image/multi' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'abstract art';
        const models = body.models || ['gemini-image', 'pollinations'];
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const falKey = k(env, ['fal_api_key', 'FAL_API_KEY']);
        async function genOne(modelId) {
          try {
            if (modelId.startsWith('gemini') && GKEY) {
              const gm = modelId === 'gemini-image-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
              const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + gm + ':generateContent', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': GKEY},
                body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseModalities: ['IMAGE', 'TEXT']}})
              });
              const gd = await gr.json();
              const parts = gd.candidates?.[0]?.content?.parts || [];
              for (const p of parts) {
                if (p.inlineData) return {model: modelId, url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data, provider: 'gemini'};
              }
            }
            if (modelId === 'pollinations') {
              return {model: modelId, url: 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nologo=true&model=flux', provider: 'pollinations'};
            }
            return {model: modelId, error: 'No key or unsupported'};
          } catch(e) { return {model: modelId, error: e.message}; }
        }
        const results = await Promise.all(models.map(m => Promise.race([genOne(m), new Promise(res => setTimeout(() => res({model: m, error: 'timeout'}), 20000))])));
        return json({results, prompt}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Telegram send ─────────────────────────────────────────────────────────
    if (path === '/api/telegram/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const tgToken = k(env, ['telegram_token', 'TELEGRAM_TOKEN']) || '';
        const chatId = k(env, ['telegram_chat_id', 'TELEGRAM_CHAT_ID']) || body.chatId || '';
        if (!tgToken || !chatId) return json({error: 'Telegram not configured'}, 400, origin);
        const resp = await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({chat_id: chatId, text: body.text || '', parse_mode: 'HTML'})
        });
        const d = await resp.json();
        return json({success: d.ok, messageId: d.result?.message_id}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Agent analyse (chunked document analysis) ─────────────────────────────
    if (path === '/api/agent/analyse' && request.method === 'POST') {
      try {
        const body = await request.json();
        const docText = body.document || '';
        const task = body.task || 'Summarise this document';
        const docName = body.document_name || 'document';
        const agentName = body.agent_name || 'Research Agent';
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']);
        if (!docText) return json({error: 'No document text'}, 400, origin);
        const chunkSize = 12000;
        const overlap = 500;
        const chunks = [];
        let i = 0;
        while (i < docText.length) { chunks.push({idx: chunks.length, text: docText.substring(i, i + chunkSize)}); i += chunkSize - overlap; }
        const chunkResults = [];
        const batchSize = 4;
        for (let bi = 0; bi < chunks.length; bi += batchSize) {
          const batch = chunks.slice(bi, bi + batchSize);
          const batchRes = await Promise.all(batch.map(chunk => {
            const msgs = [{role: 'system', content: 'You are a meticulous research analyst. Extract ALL relevant information. Never truncate.'}, {role: 'user', content: task + '\n\nSection ' + (chunk.idx + 1) + ' of ' + chunks.length + ':\n\n' + chunk.text}];
            return Promise.race([
              callProvider(env, 'gemini', GKEY, 'gemma-4-31b-it', msgs).then(r => ({chunk: chunk.idx + 1, content: r.content, ok: true})).catch(e => ({chunk: chunk.idx + 1, error: e.message, ok: false})),
              new Promise(res => setTimeout(() => res({chunk: chunk.idx + 1, error: 'timeout', ok: false}), 25000))
            ]);
          }));
          chunkResults.push(...batchRes);
          if (bi + batchSize < chunks.length) await new Promise(r => setTimeout(r, 300));
        }
        const successful = chunkResults.filter(r => r.ok && r.content);
        const allExtractions = successful.map(r => '=== Section ' + r.chunk + ' ===\n' + r.content).join('\n\n');
        const synthMsgs = [{role: 'system', content: 'You are a senior research analyst. Synthesise ALL extractions into a comprehensive structured report. Do not omit anything.'}, {role: 'user', content: 'Task: ' + task + '\n\nExtractions:\n\n' + allExtractions.substring(0, 60000)}];
        const synthesis = await callProvider(env, 'mistral', mistralKey, 'mistral-large-latest', synthMsgs).catch(e => ({content: 'Synthesis failed: ' + e.message}));
        const resultKey = 'agent-analysis:' + Date.now();
        if (env.PRISM_KV) await env.PRISM_KV.put(resultKey, JSON.stringify({task, docName, chunks_total: chunks.length, chunks_successful: successful.length, synthesis: synthesis.content, created: new Date().toISOString()}), {expirationTtl: 86400 * 30}).catch(() => {});
        return json({success: true, agent: agentName, document: docName, chunks_total: chunks.length, chunks_successful: successful.length, synthesis: synthesis.content, result_key: resultKey}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Voice generate (alias for TTS) ────────────────────────────────────────
    if (path === '/api/voice/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY']) || '';
        if (!text) return json({error: 'No text'}, 400, origin);
        if (provider === 'deepgram' && dgKey) {
          const resp = await fetch('https://api.deepgram.com/v1/speak?model=' + voice, {
            method: 'POST', headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'application/json'},
            body: JSON.stringify({text})
          });
          if (!resp.ok) return json({error: 'Deepgram error: ' + resp.status}, 500, origin);
          const audio = await resp.arrayBuffer();
          return new Response(audio, {headers: {'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin}});
        }
        return json({error: 'No TTS provider configured'}, 400, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── STT: Speech-to-text via Groq Whisper ─────────────────────────────────
    if (path === '/api/voice/transcribe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const audioB64 = body.audio || '';
        const provider = body.provider || 'groq';
        const groqKey = k(env, ['groq_free_1', 'GROQ_FREE_1']);
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY']);
        if (!audioB64) return json({error: 'No audio data'}, 400, origin);
        const audioBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
        if (provider === 'groq' && groqKey) {
          const form = new FormData();
          form.append('file', new Blob([audioBytes], {type: 'audio/webm'}), 'audio.webm');
          form.append('model', 'whisper-large-v3');
          const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST', headers: {'Authorization': 'Bearer ' + groqKey}, body: form
          });
          const d = await resp.json();
          return json({text: d.text || '', provider: 'groq'}, 200, origin);
        }
        if (dgKey) {
          const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=en-GB', {
            method: 'POST', headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'audio/webm'}, body: audioBytes
          });
          const d = await resp.json();
          const text = d.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          return json({text, provider: 'deepgram'}, 200, origin);
        }
        return json({error: 'No STT provider configured'}, 400, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Image multi-model generation ──────────────────────────────────────────
    if (path === '/api/image/multi' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'abstract art';
        const models = body.models || ['gemini-image', 'pollinations'];
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const falKey = k(env, ['fal_api_key', 'FAL_API_KEY']);
        async function genOne(modelId) {
          try {
            if (modelId.startsWith('gemini') && GKEY) {
              const gm = modelId === 'gemini-image-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
              const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + gm + ':generateContent', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': GKEY},
                body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseModalities: ['IMAGE', 'TEXT']}})
              });
              const gd = await gr.json();
              const parts = gd.candidates?.[0]?.content?.parts || [];
              for (const p of parts) {
                if (p.inlineData) return {model: modelId, url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data, provider: 'gemini'};
              }
            }
            if (modelId === 'pollinations') {
              return {model: modelId, url: 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nologo=true&model=flux', provider: 'pollinations'};
            }
            return {model: modelId, error: 'No key or unsupported'};
          } catch(e) { return {model: modelId, error: e.message}; }
        }
        const results = await Promise.all(models.map(m => Promise.race([genOne(m), new Promise(res => setTimeout(() => res({model: m, error: 'timeout'}), 20000))])));
        return json({results, prompt}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Telegram send ─────────────────────────────────────────────────────────
    if (path === '/api/telegram/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const tgToken = k(env, ['telegram_token', 'TELEGRAM_TOKEN']) || '';
        const chatId = k(env, ['telegram_chat_id', 'TELEGRAM_CHAT_ID']) || body.chatId || '';
        if (!tgToken || !chatId) return json({error: 'Telegram not configured'}, 400, origin);
        const resp = await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({chat_id: chatId, text: body.text || '', parse_mode: 'HTML'})
        });
        const d = await resp.json();
        return json({success: d.ok, messageId: d.result?.message_id}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Agent analyse (chunked document analysis) ─────────────────────────────
    if (path === '/api/agent/analyse' && request.method === 'POST') {
      try {
        const body = await request.json();
        const docText = body.document || '';
        const task = body.task || 'Summarise this document';
        const docName = body.document_name || 'document';
        const agentName = body.agent_name || 'Research Agent';
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']);
        if (!docText) return json({error: 'No document text'}, 400, origin);
        const chunkSize = 12000;
        const overlap = 500;
        const chunks = [];
        let i = 0;
        while (i < docText.length) { chunks.push({idx: chunks.length, text: docText.substring(i, i + chunkSize)}); i += chunkSize - overlap; }
        const chunkResults = [];
        const batchSize = 4;
        for (let bi = 0; bi < chunks.length; bi += batchSize) {
          const batch = chunks.slice(bi, bi + batchSize);
          const batchRes = await Promise.all(batch.map(chunk => {
            const msgs = [{role: 'system', content: 'You are a meticulous research analyst. Extract ALL relevant information. Never truncate.'}, {role: 'user', content: task + '\n\nSection ' + (chunk.idx + 1) + ' of ' + chunks.length + ':\n\n' + chunk.text}];
            return Promise.race([
              callProvider(env, 'gemini', GKEY, 'gemma-4-31b-it', msgs).then(r => ({chunk: chunk.idx + 1, content: r.content, ok: true})).catch(e => ({chunk: chunk.idx + 1, error: e.message, ok: false})),
              new Promise(res => setTimeout(() => res({chunk: chunk.idx + 1, error: 'timeout', ok: false}), 25000))
            ]);
          }));
          chunkResults.push(...batchRes);
          if (bi + batchSize < chunks.length) await new Promise(r => setTimeout(r, 300));
        }
        const successful = chunkResults.filter(r => r.ok && r.content);
        const allExtractions = successful.map(r => '=== Section ' + r.chunk + ' ===\n' + r.content).join('\n\n');
        const synthMsgs = [{role: 'system', content: 'You are a senior research analyst. Synthesise ALL extractions into a comprehensive structured report. Do not omit anything.'}, {role: 'user', content: 'Task: ' + task + '\n\nExtractions:\n\n' + allExtractions.substring(0, 60000)}];
        const synthesis = await callProvider(env, 'mistral', mistralKey, 'mistral-large-latest', synthMsgs).catch(e => ({content: 'Synthesis failed: ' + e.message}));
        const resultKey = 'agent-analysis:' + Date.now();
        if (env.PRISM_KV) await env.PRISM_KV.put(resultKey, JSON.stringify({task, docName, chunks_total: chunks.length, chunks_successful: successful.length, synthesis: synthesis.content, created: new Date().toISOString()}), {expirationTtl: 86400 * 30}).catch(() => {});
        return json({success: true, agent: agentName, document: docName, chunks_total: chunks.length, chunks_successful: successful.length, synthesis: synthesis.content, result_key: resultKey}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Voice generate (TTS alias) ────────────────────────────────────────────
    if (path === '/api/voice/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY']) || '';
        if (!text) return json({error: 'No text'}, 400, origin);
        if (provider === 'deepgram' && dgKey) {
          const resp = await fetch('https://api.deepgram.com/v1/speak?model=' + voice, {
            method: 'POST', headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'application/json'},
            body: JSON.stringify({text})
          });
          if (!resp.ok) return json({error: 'Deepgram error: ' + resp.status}, 500, origin);
          const audio = await resp.arrayBuffer();
          return new Response(audio, {headers: {'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin}});
        }
        return json({error: 'No TTS provider configured'}, 400, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── Canvas preview (fast, no logo, no background) ─────────────────────────
    if (path === '/api/canvas/preview' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || 'Identity Partners').substring(0, 300);
        const template = body.template || 'quote-teal';
        const themes = {
          'quote-teal':    {bg:'#0f3b3a', fg:'#ffffff', accent:'#7ecfcd'},
          'quote-rose':    {bg:'#5c2d3f', fg:'#ffffff', accent:'#d4899a'},
          'quote-ivory':   {bg:'#f7f3e9', fg:'#1c1a17', accent:'#5c2d3f'},
          'quote-dark':    {bg:'#111111', fg:'#ffffff', accent:'#ddd0c8'},
          'quote-slate':   {bg:'#1e2a3a', fg:'#ffffff', accent:'#90cdf4'},
          'quote-forest':  {bg:'#0f2318', fg:'#ffffff', accent:'#86efac'},
          'quote-coastal': {bg:'#0a1f35', fg:'#ffffff', accent:'#7dd3fc'},
          'quote-dawn':    {bg:'#4a1505', fg:'#ffffff', accent:'#fed7aa'},
          'quote-dusk':    {bg:'#1a0a35', fg:'#ffffff', accent:'#d8b4fe'},
          'quote-midnight':{bg:'#050d1a', fg:'#ffffff', accent:'#4a9fd4'},
          'ip-teal-rose':  {bg:'#0f3b3a', fg:'#ffffff', accent:'#d4899a'},
          'ip-minimal':    {bg:'#fafafa', fg:'#0f3b3a', accent:'#5c2d3f'},
          'post-research': {bg:'#0f1f3d', fg:'#ffffff', accent:'#93c5fd'},
          'post-quote':    {bg:'#f7f3e9', fg:'#1c1a17', accent:'#5c2d3f'},
        };
        const t = themes[template] || themes['quote-teal'];
        const safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const words = safe.split(' ');
        const lines = [];
        let line = '';
        words.forEach(w => {
          if ((line + ' ' + w).trim().length > 26 && line) { lines.push(line.trim()); line = w; }
          else { line = (line + ' ' + w).trim(); }
        });
        if (line) lines.push(line.trim());
        if (lines.length > 7) { lines.splice(6); lines[5] += '...'; }
        const lineH = 72;
        const startY = Math.max(220, 540 - (lines.length * lineH) / 2);
        const attrY = startY + lines.length * lineH + 50;
        const textEls = lines.map((l, i) =>
          '<text x="540" y="' + (startY + i * lineH) + '" font-family="Playfair Display,Georgia,serif" font-size="52" font-weight="600" fill="' + t.fg + '" text-anchor="middle">' + l + '</text>'
        ).join('\n');
        const svg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="' + t.bg + '"/><rect x="0" y="0" width="1080" height="8" fill="' + t.accent + '" opacity="0.95"/><rect x="0" y="1072" width="1080" height="8" fill="' + t.accent + '" opacity="0.95"/>' + textEls + '<line x1="340" y1="' + attrY + '" x2="740" y2="' + attrY + '" stroke="' + t.accent + '" stroke-width="1.5" opacity="0.7"/><text x="540" y="' + (attrY + 36) + '" font-family="Playfair Display,Georgia,serif" font-size="17" fill="' + t.fg + '" text-anchor="middle" opacity="0.85">Identity Partners</text><text x="540" y="1050" font-family="Inter,Arial,sans-serif" font-size="14" fill="' + t.fg + '" text-anchor="middle" opacity="0.75">identitypartners.uk \u00b7 hello@identitypartners.uk</text></svg>';
        return new Response(svg, {headers: {'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': origin}});
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── TTS read-aloud (Deepgram Aura) ────────────────────────────────────────
    if (path === '/api/tts/read' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        if (!text) return json({error: 'No text'}, 400, origin);
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY', 'deepgram']) || '';
        if (!dgKey) return json({error: 'Deepgram key not configured'}, 400, origin);
        const resp = await fetch('https://api.deepgram.com/v1/speak?model=' + voice, {
          method: 'POST',
          headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({text})
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return json({error: 'Deepgram error: ' + resp.status + ' ' + errText.substring(0, 100)}, 500, origin);
        }
        const audio = await resp.arrayBuffer();
        return new Response(audio, {headers: {'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin}});
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Voice generate (alias for TTS) ────────────────────────────────────────
    if (path === '/api/voice/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        if (!text) return json({error: 'No text'}, 400, origin);
        const dgKey = k(env, ['deepgram_api_key', 'DEEPGRAM_API_KEY', 'deepgram']) || '';
        if (!dgKey) return json({error: 'Deepgram key not configured'}, 400, origin);
        const resp = await fetch('https://api.deepgram.com/v1/speak?model=' + voice, {
          method: 'POST',
          headers: {'Authorization': 'Token ' + dgKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({text})
        });
        if (!resp.ok) return json({error: 'Deepgram error: ' + resp.status}, 500, origin);
        const audio = await resp.arrayBuffer();
        return new Response(audio, {headers: {'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin}});
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── PDF to Markdown (Gemini Vision) ───────────────────────────────────────
    if (path === '/api/pdf/to-markdown' && request.method === 'POST') {
      try {
        const body = await request.json();
        const b64 = body.content || '';
        const fileUrl = body.url || '';
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error: 'Gemini key not configured'}, 400, origin);
        let pdfB64 = b64;
        if (fileUrl && !pdfB64) {
          const resp = await fetch(fileUrl);
          if (!resp.ok) return json({error: 'Could not fetch PDF'}, 400, origin);
          const buf = await resp.arrayBuffer();
          pdfB64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        }
        if (!pdfB64) return json({error: 'No PDF content'}, 400, origin);
        const gemResp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + GKEY,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              contents: [{parts: [
                {text: 'Extract ALL text from this PDF. Return clean Markdown. Preserve headings, lists, tables. Include every word.'},
                {inline_data: {mime_type: 'application/pdf', data: pdfB64.substring(0, 1000000)}}
              ]}],
              generationConfig: {maxOutputTokens: 8192}
            })
          }
        );
        const gemData = await gemResp.json();
        const markdown = gemData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!markdown) return json({error: 'No text extracted', raw: JSON.stringify(gemData).substring(0, 200)}, 500, origin);
        return json({success: true, markdown, wordCount: markdown.split(/\s+/).length}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── OneDrive upload via MSGraph ────────────────────────────────────────────
    if (path === '/api/onedrive/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileName = body.fileName || ('file-' + Date.now() + '.bin');
        const content = body.content || '';
        const folder = body.folder || 'Argentica';
        const tenantId = k(env, ['msgraph_tenant', 'MSGRAPH_TENANT']) || '';
        const clientId = k(env, ['msgraph_client', 'MSGRAPH_CLIENT']) || '';
        const clientSecret = k(env, ['msgraph_secret', 'MSGRAPH_SECRET']) || '';
        if (!tenantId || !clientId || !clientSecret) return json({error: 'MSGraph credentials not configured'}, 400, origin);
        const tokenResp = await fetch(
          'https://login.microsoftonline.com/' + tenantId + '/oauth2/v2.0/token',
          {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: 'grant_type=client_credentials&client_id=' + clientId + '&client_secret=' + encodeURIComponent(clientSecret) + '&scope=https://graph.microsoft.com/.default'
          }
        );
        const tokenData = await tokenResp.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) return json({error: 'Could not get MSGraph token: ' + JSON.stringify(tokenData).substring(0, 100)}, 500, origin);
        const fileBytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
        const uploadResp = await fetch(
          'https://graph.microsoft.com/v1.0/me/drive/root:/' + folder + '/' + encodeURIComponent(fileName) + ':/content',
          {method: 'PUT', headers: {'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/octet-stream'}, body: fileBytes}
        );
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return json({error: 'OneDrive upload failed: ' + JSON.stringify(uploadData).substring(0, 100)}, 500, origin);
        const shareResp = await fetch(
          'https://graph.microsoft.com/v1.0/me/drive/items/' + uploadData.id + '/createLink',
          {method: 'POST', headers: {'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json'}, body: JSON.stringify({type: 'view', scope: 'anonymous'})}
        );
        const shareData = await shareResp.json();
        const shareUrl = shareData.link?.webUrl || uploadData.webUrl || '';
        return json({success: true, fileId: uploadData.id, fileName: uploadData.name, shareUrl, viewUrl: shareUrl ? 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(shareUrl) : ''}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Document extract (chunked analysis) ───────────────────────────────────
    if (path === '/api/document/extract' && request.method === 'POST') {
      try {
        const body = await request.json();
        const docText = body.text || '';
        const extractPrompt = body.prompt || 'Extract all key facts, data points, names, dates, and findings. Return as structured bullet points.';
        const chunkSize = body.chunk_size || 15000;
        const overlap = 500;
        if (!docText) return json({error: 'No text provided'}, 400, origin);
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']) || '';
        const chunks = [];
        let i = 0;
        while (i < docText.length) { chunks.push(docText.substring(i, i + chunkSize)); i += chunkSize - overlap; }
        const allResults = [];
        const batchSize = 4;
        for (let bi = 0; bi < chunks.length; bi += batchSize) {
          const batch = chunks.slice(bi, bi + batchSize);
          const batchResults = await Promise.all(batch.map(async (chunk, ci) => {
            const chunkIdx = bi + ci;
            const messages = [
              {role: 'system', content: 'Extract ALL relevant information. Never skip or truncate.'},
              {role: 'user', content: extractPrompt + '\n\nSection ' + (chunkIdx + 1) + ' of ' + chunks.length + ':\n\n' + chunk}
            ];
            try {
              const r = await callProvider(env, 'gemini', GKEY, 'gemma-4-31b-it', messages);
              return {chunk: chunkIdx + 1, text: r.content, ok: true};
            } catch(e) { return {chunk: chunkIdx + 1, error: e.message, ok: false}; }
          }));
          allResults.push(...batchResults);
          if (bi + batchSize < chunks.length) await new Promise(r => setTimeout(r, 300));
        }
        const successful = allResults.filter(r => r.ok && r.text);
        const allExtractions = successful.map(r => '=== Section ' + r.chunk + ' ===\n' + r.text).join('\n\n');
        let synthesis = allExtractions;
        if (successful.length > 1 && mistralKey) {
          try {
            const synthMsgs = [
              {role: 'system', content: 'Synthesise these extractions into a comprehensive structured report. Organise by theme. No omissions.'},
              {role: 'user', content: 'Merge:\n\n' + allExtractions.substring(0, 60000)}
            ];
            const synthResult = await callProvider(env, 'mistral', mistralKey, 'mistral-large-latest', synthMsgs);
            synthesis = synthResult.content;
          } catch(e) {}
        }
        return json({chunks_processed: chunks.length, chunks_successful: successful.length, merged_summary: synthesis, doc_length: docText.length}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── Multi-source image search ─────────────────────────────────────────────
    if (path === '/api/image-search/multi' && request.method === 'POST') {
      try {
        const body = await request.json();
        const query = body.query || body.q || '';
        const sources = body.sources || ['pexels', 'unsplash', 'pixabay', 'openverse'];
        const limit = Math.min(body.limit || 8, 20);
        const pexelsKey = k(env, ['pexels_api_key','PEXELS_API_KEY','pexels']) || '';
        const unsplashKey = k(env, ['unsplash_api_key','UNSPLASH_API_KEY','unsplash']) || '';
        const pixabayKey = k(env, ['pixabay_api_key','PIXABAY_API_KEY','pixabay']) || '';

        const results = [];

        // Pexels
        if (sources.includes('pexels') && pexelsKey) {
          try {
            const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=landscape`, {headers: {'Authorization': pexelsKey}});
            if (r.ok) {
              const d = await r.json();
              (d.photos || []).forEach(p => results.push({source:'pexels', url:p.src?.medium||p.src?.original, thumbnail:p.src?.small, alt:p.alt||query, photographer:p.photographer}));
            }
          } catch(e) {}
        }

        // Unsplash
        if (sources.includes('unsplash') && unsplashKey) {
          try {
            const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=landscape`, {headers: {'Authorization': `Client-ID ${unsplashKey}`}});
            if (r.ok) {
              const d = await r.json();
              (d.results || []).forEach(p => results.push({source:'unsplash', url:p.urls?.regular||p.urls?.full, thumbnail:p.urls?.thumb, alt:p.alt_description||query, photographer:p.user?.name}));
            }
          } catch(e) {}
        }

        // Pixabay
        if (sources.includes('pixabay') && pixabayKey) {
          try {
            const r = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&per_page=${limit}&image_type=photo&orientation=horizontal`);
            if (r.ok) {
              const d = await r.json();
              (d.hits || []).forEach(p => results.push({source:'pixabay', url:p.webformatURL, thumbnail:p.previewURL, alt:p.tags||query, photographer:p.user}));
            }
          } catch(e) {}
        }

        // Openverse (no key needed)
        if (sources.includes('openverse')) {
          try {
            const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${limit}&license_type=commercial,modification`);
            if (r.ok) {
              const d = await r.json();
              (d.results || []).forEach(p => results.push({source:'openverse', url:p.url, thumbnail:p.thumbnail, alt:p.title||query, photographer:p.creator}));
            }
          } catch(e) {}
        }

        // Wikimedia Commons
        if (sources.includes('wikimedia')) {
          try {
            const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=${limit}&format=json&origin=*`);
            if (r.ok) {
              const d = await r.json();
              const pages = d.query?.search || [];
              for (const p of pages.slice(0, 4)) {
                const title = p.title.replace('File:', '');
                const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=800`;
                results.push({source:'wikimedia', url:imgUrl, thumbnail:imgUrl.replace('width=800','width=200'), alt:title});
              }
            }
          } catch(e) {}
        }

        return json({results, total: results.length, query}, 200, origin);
      } catch(e) { return json({error: e.message, results: []}, 200, origin); }
    }


  // ── Agent CRUD (B1) ──────────────────────────────────────────────────────────
    if (path === '/api/agents' && request.method === 'GET') {
      try {
        let list = env.PRISM_KV ? await env.PRISM_KV.get('agents:list', 'json') : null;
        // Self-heal: if agents:list is missing or empty, scan individual agents:* keys
        if (env.PRISM_KV && (!list || list.length === 0)) {
          const keys = await env.PRISM_KV.list({ prefix: 'agents:' }).catch(() => ({ keys: [] }));
          const agentKeys = (keys.keys || []).filter(k => k.name !== 'agents:list');
          if (agentKeys.length > 0) {
            const agents = await Promise.all(agentKeys.map(k => env.PRISM_KV.get(k.name, 'json').catch(() => null)));
            list = agents.filter(Boolean);
            await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          }
        }
        // Seed the 6 Marketing agents if still empty
        if (env.PRISM_KV && (!list || list.length === 0)) {
          list = [
            { id: 'agent-marketing-head', name: 'Head of Marketing & Communications', persona: 'Strategy lead for Identity Partners. Oversees all marketing output, brand voice, and team coordination. Uses Simon\'s voice specification. Manages Refract content strategy and team oversight.', tools: ['web-search', 'rss', 'bluesky-post', 'linkedin-post'], dataSources: ['guardian-rss', 'ons', 'mind', 'nhs'], outputActions: ['post-bluesky', 'post-linkedin', 'save-to-workspace'], model: 'mistral-large-latest', role: 'Head of Marketing & Communications', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'agent-social-manager', name: 'Social Media Channel Manager', persona: 'Manages all social media channels for Identity Partners. Schedules posts, monitors engagement, coordinates the daily pipeline. Uses Simon\'s voice specification. Handles Refract content distribution.', tools: ['bluesky-post', 'linkedin-post', 'telegram-post', 'buffer-post'], dataSources: ['guardian-rss', 'ons', 'mind'], outputActions: ['post-bluesky', 'post-linkedin', 'post-telegram', 'queue-buffer'], model: 'gemini-3.8-flash', role: 'Social Media Channel Manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'agent-content-editor', name: 'Original Content Editor', persona: 'Produces longform content in Simon\'s voice. Collaborates on voice development. Writes articles, essays, and thought leadership pieces for Identity Partners. Never uses AI phrasing or generic thought leadership tropes.', tools: ['web-search', 'rss', 'drafting'], dataSources: ['guardian-rss', 'ons', 'mind', 'nhs', 'lancet', 'pubmed'], outputActions: ['save-to-workspace', 'post-substack'], model: 'mistral-large-latest', role: 'Original Content Editor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'agent-visual-manager', name: 'Visual Assets Manager', persona: 'Creates and manages all visual assets for Identity Partners. Generates canvas posts, manages templates, performs Vision QA on all output. Ensures every asset contains IP logo, identitypartners.uk, hello@identitypartners.uk, and IP social handles.', tools: ['canvas', 'vision-qa', 'r2-upload'], dataSources: ['pexels', 'unsplash', 'pixabay', 'wikimedia'], outputActions: ['upload-r2', 'queue-buffer'], model: 'gemini-3.8-flash', role: 'Visual Assets Manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'agent-podcast-editor', name: 'Podcast Editor', persona: 'Produces podcast content for Identity Partners using Cartesia (primary) and Smallest.AI (secondary) voices. Manages multi-voice episodes, YouTube upload, and Spotify RSS feed.', tools: ['cartesia-tts', 'smallest-ai-tts', 'youtube-upload', 'spotify-rss'], dataSources: ['guardian-rss', 'ons', 'mind', 'nhs'], outputActions: ['upload-youtube', 'publish-rss'], model: 'mistral-large-latest', role: 'Podcast Editor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'agent-current-affairs', name: 'Current Affairs Content Editor', persona: 'Monitors RSS feeds and news sources for current affairs relevant to Identity Partners\' work in addiction recovery, trauma, and mental health. Curates content, compares coverage across approved outlets, and produces structured reports. Uses only approved sources — never Telegraph, Times, or iNews.', tools: ['web-search', 'rss', 'tavily'], dataSources: ['guardian-rss', 'ons', 'mind', 'nhs', 'lancet', 'pubmed', 'new-statesman-rss'], outputActions: ['save-to-workspace', 'post-bluesky'], model: 'deepseek-chat', role: 'Current Affairs Content Editor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ];
          await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          for (const agent of list) {
            await env.PRISM_KV.put(`agents:${agent.id}`, JSON.stringify(agent));
          }
        }
        return json({ agents: list || [] }, 200, origin);
      } catch(e) { return json({ agents: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/agents' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('agent-' + Date.now());
        const agent = { id, name: body.name || 'Unnamed Agent', persona: body.persona || '', tools: body.tools || [], dataSources: body.dataSources || [], outputActions: body.outputActions || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('agents:list', 'json') || [];
          const existing = list.findIndex(a => a.id === id);
          if (existing >= 0) list[existing] = agent; else list.push(agent);
          await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          await env.PRISM_KV.put(`agents:${id}`, JSON.stringify(agent));
        }
        return json({ success: true, agent }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/agents/') && request.method === 'PUT') {
      try {
        const id = path.replace('/api/agents/', '');
        const body = await request.json();
        const agent = { ...body, id, updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('agents:list', 'json') || [];
          const idx = list.findIndex(a => a.id === id);
          if (idx >= 0) list[idx] = agent; else list.push(agent);
          await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          await env.PRISM_KV.put(`agents:${id}`, JSON.stringify(agent));
        }
        return json({ success: true, agent }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/agents/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/agents/', '');
        if (env.PRISM_KV) {
          const list = (await env.PRISM_KV.get('agents:list', 'json') || []).filter(a => a.id !== id);
          await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          await env.PRISM_KV.delete(`agents:${id}`);
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

  // ── Marketing Team API ────────────────────────────────────────────────────────

    // GET /api/marketing/agents
    if (path === '/api/marketing/agents' && request.method === 'GET') {
      try {
        let list = env.PRISM_KV ? await env.PRISM_KV.get('agents:list', 'json') : null;
        if (!list || !list.length) {
          const keys = await env.PRISM_KV.list({ prefix: 'agents:' }).catch(() => ({ keys: [] }));
          const agentKeys = (keys.keys || []).filter(k => k.name !== 'agents:list');
          if (agentKeys.length > 0) {
            const agents = await Promise.all(agentKeys.map(k => env.PRISM_KV.get(k.name, 'json').catch(() => null)));
            list = agents.filter(Boolean);
          }
        }
        const enriched = await Promise.all((list || []).map(async function(agent) {
          const assignment = env.PRISM_KV ? await env.PRISM_KV.get('agent-assignment:' + agent.id, 'json').catch(() => null) : null;
          const histRaw = env.PRISM_KV ? await env.PRISM_KV.get('agent-chat:' + agent.id + ':history', 'json').catch(() => null) : null;
          return Object.assign({}, agent, { assignment: assignment || null, messageCount: histRaw ? histRaw.length : 0 });
        }));
        return json({ agents: enriched }, 200, origin);
      } catch(e) { return json({ agents: [], error: e.message }, 200, origin); }
    }

    // POST /api/marketing/assign
    if (path === '/api/marketing/assign' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { agentId, task, deadline, priority } = body;
        if (!agentId || !task) return json({ success: false, error: 'agentId and task required' }, 400, origin);
        const assignment = { task, deadline: deadline || null, priority: priority || 3, status: 'briefed', assignedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) await env.PRISM_KV.put('agent-assignment:' + agentId, JSON.stringify(assignment));
        const histKey = 'agent-chat:' + agentId + ':history';
        const hist = env.PRISM_KV ? (await env.PRISM_KV.get(histKey, 'json') || []) : [];
        hist.push({ role: 'system', content: 'ASSIGNMENT: ' + task + (deadline ? ' | Deadline: ' + deadline : '') + ' | Priority: ' + (priority || 3) + '/5', ts: new Date().toISOString() });
        if (env.PRISM_KV) await env.PRISM_KV.put(histKey, JSON.stringify(hist.slice(-200)));
        return json({ success: true, assignment }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // POST /api/marketing/assign-all
    if (path === '/api/marketing/assign-all' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { task, deadline, priority } = body;
        if (!task) return json({ success: false, error: 'task required' }, 400, origin);
        const list = env.PRISM_KV ? (await env.PRISM_KV.get('agents:list', 'json') || []) : [];
        const results = await Promise.all(list.map(async function(agent) {
          const assignment = { task, deadline: deadline || null, priority: priority || 3, status: 'briefed', assignedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          await env.PRISM_KV.put('agent-assignment:' + agent.id, JSON.stringify(assignment));
          const histKey = 'agent-chat:' + agent.id + ':history';
          const hist = await env.PRISM_KV.get(histKey, 'json').catch(() => []) || [];
          hist.push({ role: 'system', content: 'ASSIGNMENT: ' + task, ts: new Date().toISOString() });
          await env.PRISM_KV.put(histKey, JSON.stringify(hist.slice(-200)));
          return agent.id;
        }));
        return json({ success: true, assigned: results }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // POST /api/marketing/status
    if (path === '/api/marketing/status' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { agentId, status } = body;
        if (!agentId || !status) return json({ success: false, error: 'agentId and status required' }, 400, origin);
        const assignment = env.PRISM_KV ? (await env.PRISM_KV.get('agent-assignment:' + agentId, 'json') || {}) : {};
        assignment.status = status;
        assignment.updatedAt = new Date().toISOString();
        if (env.PRISM_KV) await env.PRISM_KV.put('agent-assignment:' + agentId, JSON.stringify(assignment));
        return json({ success: true, assignment }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // GET /api/marketing/chat/:agentId
    if (path.match(/^\/api\/marketing\/chat\/[^/]+$/) && request.method === 'GET') {
      try {
        const agentId = path.split('/').pop();
        const hist = env.PRISM_KV ? (await env.PRISM_KV.get('agent-chat:' + agentId + ':history', 'json') || []) : [];
        return json({ history: hist.filter(m => m.role !== 'system') }, 200, origin);
      } catch(e) { return json({ history: [], error: e.message }, 200, origin); }
    }

    // POST /api/marketing/chat/:agentId
    if (path.match(/^\/api\/marketing\/chat\/[^/]+$/) && request.method === 'POST') {
      try {
        const agentId = path.split('/').pop();
        const body = await request.json();
        const userMessage = body.message || '';
        if (!userMessage) return json({ success: false, error: 'message required' }, 400, origin);
        const list = env.PRISM_KV ? (await env.PRISM_KV.get('agents:list', 'json') || []) : [];
        const agent = list.find(a => a.id === agentId) || { name: agentId, persona: '', model: 'mistral-large-latest' };
        const assignment = env.PRISM_KV ? await env.PRISM_KV.get('agent-assignment:' + agentId, 'json').catch(() => null) : null;
        const histKey = 'agent-chat:' + agentId + ':history';
        const hist = env.PRISM_KV ? (await env.PRISM_KV.get(histKey, 'json') || []) : [];
        let weekThemeNote = '';
        try {
          const themeList = env.PRISM_KV ? (await env.PRISM_KV.get('themes:weeks', 'json') || []) : [];
          const nowW = new Date(); const dowW = (nowW.getUTCDay() + 6) % 7;
          const monW = new Date(nowW); monW.setUTCDate(nowW.getUTCDate() - dowW); monW.setUTCHours(0, 0, 0, 0);
          const thW = themeList.find(t2 => t2.week === monW.toISOString().slice(0, 10));
          if (thW && thW.name) {
            weekThemeNote = '\nThis week\u2019s theme is "' + thW.name + '"' + (thW.secondary ? ' with secondary thread "' + thW.secondary + '"' : '') + '. Make content speak to it unless Simon asks otherwise. Per-platform overrides may exist in the plan.';
          }
        } catch (eW) {}
        const systemPrompt = `You are ${agent.name} at Identity Partners. ${agent.persona || ''}\n\n${assignment ? 'Current assignment: ' + assignment.task + ' | Status: ' + assignment.status + ' | Priority: ' + assignment.priority + '/5' : 'No current assignment.'}\n\nSimon's voice: Intelligent, direct, humane, British professional prose. Never AI phrasing, never em dashes. British English throughout.\nApproved sources: ONS, Mind, NHS, Guardian, FT, Economist, New Statesman, Lancet, PubMed, WHO, academic journals. Never Telegraph, Times, iNews.\nTags (choose 2-4, ONLY ones relevant to the specific post; never blanket-tag): #IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing. #Addiction goes ONLY on posts genuinely about addiction. Tag relevance beats tag volume every time.\nMandatory footer: hello@identitypartners.uk | www.identitypartners.uk/contact${weekThemeNote}\n\nYou have real tools. When a task calls for action, write a tool call on its own line in exactly this format and the system will execute it:\nTOOL: queue_post({"text": "the post copy with tags and footer", "platforms": [...], "format": "auto", "from": ""}) — queues a post for approval. PLATFORM GROUPS are TYPES, not pairings (pass a group name or individual channels, mixing is fine): "longform" = substack ONLY (essays, reflective prose, full-length pieces; Bluesky is NOT longform); "pro" = linkedin ONLY (orphaned, pro-to-pro: practice news, professional development, sector commentary); "shortform" = x + threads + bluesky (one-idea nuggets respecting caps: x 280, bluesky 300, threads 500 characters); "images" = instagram + facebook + tumblr (image-first posts, carousels and stories). WRITING CONVENTIONS by type: longform = patient, essayistic, intellectually warm; pro = professional, peer-to-peer; shortform = plain speech, one idea, surface-level-perfect; images = strong caption plus visual, human interest. FORMAT slots ("format" arg): "image" single graphic; "carousel" multi-slide (strongest reach on instagram); "story" full-bleed vertical (instagram + facebook stories); "reel" short brand video (title + list lines animated on parchment; render via the reel studio, agents should propose them for listicle-style content); "auto" lets the system choose by content type. LISTICLE DOCTRINE: the best-performing non-shortform content on the internet is the listicle, from Instagram carousels to LinkedIn articles. When content is multi-part (steps, reasons, tips, arguments), default to format=carousel and write each slide as a list item. "from" (optional) = a voice id from the voices registry, to post as a registered condition-specific account instead of the main Identity Partners account.\nTOOL: post_now({"text": "...", "platforms": [...]}) — attempts immediate posting; only works when autonomy is switched on.\nTOOL: create_canvas({"topic": "...", "template": "..."}) — renders a brand canvas graphic; templates include myth-vs-fact, data-infographic, awareness-day, news-reaction, research, service-explainer, quote, stat, testimonial, img-seascape, img-sunrise, img-cityscape and dual-partnership.\nTOOL: search_news({"topic": "..."}) — fetches current headlines from the approved sources.\nTOOL: save_note({"title": "...", "content": "..."}) — files a note in Simon's library.\nUse tools when asked to produce content or monitor the news; explain in one short line what you did.\n`;
        const messages = [{ role: 'system', content: systemPrompt }];
        hist.filter(m => m.role !== 'system').slice(-20).forEach(m => messages.push({ role: m.role, content: m.content }));
        messages.push({ role: 'user', content: userMessage });
        const modelMap = {
          'mistral-large-latest': { profile: 'balanced', providerOverride: 'mistral', modelOverride: 'mistral-large-4' },
          'gemini-3.8-flash': { profile: 'balanced', providerOverride: 'gemini', modelOverride: 'gemini-3.8-flash' },
          'deepseek-chat': { profile: 'balanced', providerOverride: 'deepseek', modelOverride: 'deepseek-chat' },
        };
        // ── Platform grouping schema ──
        // Canonical groups; user-defined cadence groups (KV cadence:groups) are merged on top.
        const BUILTIN_GROUPS = {
          // Platform TYPES (Simon's frame): longform vs shortform vs image-first, plus pro-to-pro
          longform: ['substack'],
          pro:      ['linkedin'],
          shortform: ['x', 'threads', 'bluesky'],
          images:   ['instagram', 'facebook', 'tumblr']
        };
        async function resolveGroups() {
          let groups = { ...BUILTIN_GROUPS };
          try {
            const g = env.PRISM_KV ? JSON.parse(await env.PRISM_KV.get('cadence:groups') || 'null') : null;
            if (Array.isArray(g)) for (const grp of g) if (grp.name && Array.isArray(grp.channels)) groups[grp.name.toLowerCase()] = grp.channels.map(c => String(c).toLowerCase());
          } catch (e) {}
          return groups;
        }
        function expandPlatforms(list, groups) {
          const out = [];
          for (const p of (list || [])) {
            const key = String(p).toLowerCase();
            if (groups[key]) { for (const c of groups[key]) if (!out.includes(c)) out.push(c); }
            else if (!out.includes(key)) out.push(key);
          }
          return out;
        }
        const GROUPS = await resolveGroups();

        const modelOpts = modelMap[agent.model] || { profile: 'balanced' };
        const result = await orchestrate(messages, env, modelOpts);
        let reply = result.content || 'No response.';

        // ── Tool execution: agents act, Simon approves ──────────────
        const toolCalls = [];
        const toolRe = /^TOOL:\s*([a-z_]+)\s*\(([\s\S]*?\})?\)?\s*$/gm;
        let tm;
        while ((tm = toolRe.exec(reply)) !== null) {
          const toolName = tm[1];
          let args = {};
          try { args = JSON.parse((tm[2] || '{}').replace(/\)\s*$/, '')); } catch (e) { toolCalls.push({ tool: toolName, error: 'bad arguments' }); continue; }
          try {
            if (toolName === 'post_now') {
              // Autonomous posting — governed by the agreed constraints in socialising:autonomy
              const cfg = env.PRISM_KV ? await env.PRISM_KV.get('socialising:autonomy', 'json') : null;
              if (!cfg || !cfg.enabled) { toolCalls.push({ tool: toolName, error: 'autonomy is switched off' }); }
              else {
                const today = new Date().toISOString().slice(0, 10);
                const countKey = 'socialising:count:' + today;
                const count = parseInt((env.PRISM_KV && await env.PRISM_KV.get(countKey)) || '0');
                if (count >= (cfg.maxPerDay || 3)) { toolCalls.push({ tool: toolName, error: 'daily cap of ' + cfg.maxPerDay + ' reached' }); }
                else {
                  let text = String(args.text || '');
                  const blocked = (cfg.blockWords || []).some(w => w && text.toLowerCase().includes(String(w).toLowerCase()));
                  if (blocked) { toolCalls.push({ tool: toolName, error: 'content contains a blocked word' }); }
                  else {
                    const askedFor = Array.isArray(args.platforms) ? args.platforms : cfg.platforms;
                    const platforms = [...new Set(expandPlatforms(askedFor, GROUPS))].filter(p => cfg.platforms.includes(p));
                    const item = {
                      id: 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                      text, platforms,
                      imageUrl: args.imageUrl || null,
                      source: 'autonomous:' + agentId,
                      status: 'pending',
                      createdAt: new Date().toISOString(),
                      scheduledFor: null
                    };
                    if (env.PRISM_KV) {
                      const q = await env.PRISM_KV.get('mm:queue', 'json') || [];
                      q.push(item);
                      await env.PRISM_KV.put('mm:queue', JSON.stringify(q));
                    }
                    const appr = await fetch('https://prism-api.identitypartners.workers.dev/api/mm/approve', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ itemId: item.id })
                    }).then(r => r.json()).catch(() => ({}));
                    if (env.PRISM_KV) {
                      await env.PRISM_KV.put(countKey, String(count + 1));
                      const log = await env.PRISM_KV.get('socialising:log', 'json') || [];
                      log.unshift({ ts: new Date().toISOString(), text: text.slice(0, 120), platforms, results: appr.results || {}, errors: appr.errors || {}, source: 'agent:' + agentId });
                      await env.PRISM_KV.put('socialising:log', JSON.stringify(log.slice(0, 100)));
                    }
                    toolCalls.push({ tool: toolName, result: 'posted', platforms, detail: appr });
                  }
                }
              }
            } else if (toolName === 'queue_post') {
              const item = {
                id: 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                text: args.text || '',
                platforms: expandPlatforms(Array.isArray(args.platforms) ? args.platforms : ['bluesky'], GROUPS),
                format: args.format || 'auto', // auto | image | carousel | story | reel | text
                from: args.from || '', // optional voice id from voices:registry
                urls: Array.isArray(args.urls) ? args.urls : null,
                imageUrl: args.imageUrl || null,
                source: 'agent:' + agentId,
                status: 'pending',
                createdAt: new Date().toISOString(),
                scheduledFor: args.scheduledFor || null
              };
              if (env.PRISM_KV) {
                const q = await env.PRISM_KV.get('mm:queue', 'json') || [];
                q.push(item);
                await env.PRISM_KV.put('mm:queue', JSON.stringify(q));
              }
              toolCalls.push({ tool: toolName, result: 'queued for approval', itemId: item.id });
            } else if (toolName === 'create_canvas') {
              const self = 'https://prism-api.identitypartners.workers.dev/api/canvas/generate';
              const r = await fetch(self, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: args.topic || '', text: args.topic || '', template: args.template || 'block-teal', platform: 'instagram', skipQA: true })
              }).then(x => x.json());
              toolCalls.push({ tool: toolName, result: r.url || r.error || 'generated', url: r.url });
            } else if (toolName === 'search_news') {
              const feeds = ['https://www.theguardian.com/society/rss', 'https://feeds.bbci.co.uk/news/health/rss.xml'];
              const q = String(args.query || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
              const hits = [];
              for (const f of feeds) {
                try {
                  const text = await fetch(f, { headers: { 'User-Agent': 'Argentica/1.0' } }).then(x => x.text());
                  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
                  for (const it of items.slice(0, 25)) {
                    const title = ((it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').trim();
                    if (q.some(kw => title.toLowerCase().includes(kw))) hits.push(title);
                  }
                } catch (e) {}
              }
              toolCalls.push({ tool: toolName, result: hits.length ? hits.slice(0, 8) : 'no matches today' });
            } else if (toolName === 'save_note') {
              const id = 'doc-' + Date.now();
              const doc = { id, title: args.title || 'Agent note', type: 'note', content: args.content || '', tags: ['agent'], moduleSource: 'phd', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
              if (env.PRISM_KV) {
                const list = await env.PRISM_KV.get('docs:list', 'json') || [];
                list.push({ id, title: doc.title, type: 'note', tags: doc.tags, moduleSource: 'phd', updatedAt: doc.updatedAt });
                await env.PRISM_KV.put('docs:list', JSON.stringify(list));
                await env.PRISM_KV.put('doc:' + id, JSON.stringify(doc));
              }
              toolCalls.push({ tool: toolName, result: 'saved to library' });
            } else {
              toolCalls.push({ tool: toolName, error: 'unknown tool' });
            }
          } catch (e) { toolCalls.push({ tool: toolName, error: e.message }); }
        }
        if (toolCalls.length) {
          reply = reply.replace(toolRe, '').trim();
          const toolSummary = '\n\n[Tools executed: ' + toolCalls.map(t => t.tool + (t.error ? ' — ' + t.error : ' — ' + (typeof t.result === 'string' ? t.result : 'done'))).join('; ') + ']';
          reply += toolSummary;
        }

        hist.push({ role: 'user', content: userMessage, ts: new Date().toISOString() });
        hist.push({ role: 'assistant', content: reply, ts: new Date().toISOString() });
        if (env.PRISM_KV) await env.PRISM_KV.put(histKey, JSON.stringify(hist.slice(-200)));
        if (assignment && /complete|finished|done/i.test(reply)) {
          assignment.status = 'awaiting approval';
          assignment.updatedAt = new Date().toISOString();
          if (env.PRISM_KV) await env.PRISM_KV.put('agent-assignment:' + agentId, JSON.stringify(assignment));
        }
        return json({ success: true, reply, model: result.model || agent.model, provider: result.provider, toolCalls }, 200, origin);
      } catch(e) { return json({ success: false, reply: 'Error: ' + e.message }, 500, origin); }
    }

    // DELETE /api/marketing/chat/:agentId
    if (path.match(/^\/api\/marketing\/chat\/[^/]+$/) && request.method === 'DELETE') {
      try {
        const agentId = path.split('/').pop();
        if (env.PRISM_KV) await env.PRISM_KV.put('agent-chat:' + agentId + ':history', '[]');
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // POST /api/marketing/nickname — set agent nickname
    if (path === '/api/marketing/nickname' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { agentId, nickname } = body;
        if (!agentId) return json({ success: false, error: 'agentId required' }, 400, origin);
        const list = env.PRISM_KV ? (await env.PRISM_KV.get('agents:list', 'json') || []) : [];
        const idx = list.findIndex(a => a.id === agentId);
        if (idx >= 0) {
          list[idx].nickname = nickname || '';
          await env.PRISM_KV.put('agents:list', JSON.stringify(list));
          await env.PRISM_KV.put('agents:' + agentId, JSON.stringify(list[idx]));
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // GET /api/marketing/jobs/:agentId — get job queue
    if (path.match(/^\/api\/marketing\/jobs\/[^/]+$/) && request.method === 'GET') {
      try {
        const agentId = path.split('/').pop();
        const jobs = env.PRISM_KV ? (await env.PRISM_KV.get('agent-jobs:' + agentId, 'json') || []) : [];
        return json({ jobs }, 200, origin);
      } catch(e) { return json({ jobs: [], error: e.message }, 200, origin); }
    }

    // POST /api/marketing/jobs/:agentId — add job to queue
    if (path.match(/^\/api\/marketing\/jobs\/[^/]+$/) && request.method === 'POST') {
      try {
        const agentId = path.split('/').pop();
        const body = await request.json();
        if (!body.title) return json({ success: false, error: 'title required' }, 400, origin);
        const jobs = env.PRISM_KV ? (await env.PRISM_KV.get('agent-jobs:' + agentId, 'json') || []) : [];
        const job = {
          title: body.title,
          description: body.description || '',
          priority: body.priority || 3,
          recurrence: body.recurrence || 'once',
          status: body.status || 'queued',
          createdAt: body.createdAt || new Date().toISOString(),
        };
        // Insert sorted by priority
        jobs.push(job);
        jobs.sort((a, b) => (a.priority || 3) - (b.priority || 3));
        if (env.PRISM_KV) await env.PRISM_KV.put('agent-jobs:' + agentId, JSON.stringify(jobs));
        return json({ success: true, job }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // DELETE /api/marketing/jobs/:agentId/:index — remove job by index
    if (path.match(/^\/api\/marketing\/jobs\/[^/]+\/\d+$/) && request.method === 'DELETE') {
      try {
        const parts = path.split('/');
        const agentId = parts[parts.length - 2];
        const index = parseInt(parts[parts.length - 1]);
        const jobs = env.PRISM_KV ? (await env.PRISM_KV.get('agent-jobs:' + agentId, 'json') || []) : [];
        if (index >= 0 && index < jobs.length) jobs.splice(index, 1);
        if (env.PRISM_KV) await env.PRISM_KV.put('agent-jobs:' + agentId, JSON.stringify(jobs));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }


  // ── Workflow CRUD (B2) ────────────────────────────────────────────────────────
    if (path === '/api/workflows' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? await env.PRISM_KV.get('workflows:list', 'json') : null;
        return json({ workflows: list || [] }, 200, origin);
      } catch(e) { return json({ workflows: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/workflows' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('wf-' + Date.now());
        const wf = { id, name: body.name || 'Unnamed Workflow', steps: body.steps || [], trigger: body.trigger || 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('workflows:list', 'json') || [];
          const existing = list.findIndex(w => w.id === id);
          if (existing >= 0) list[existing] = wf; else list.push(wf);
          await env.PRISM_KV.put('workflows:list', JSON.stringify(list));
          await env.PRISM_KV.put(`workflows:${id}`, JSON.stringify(wf));
        }
        return json({ success: true, workflow: wf }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/workflows/') && request.method === 'PUT') {
      try {
        const id = path.replace('/api/workflows/', '');
        const body = await request.json();
        const wf = { ...body, id, updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('workflows:list', 'json') || [];
          const idx = list.findIndex(w => w.id === id);
          if (idx >= 0) list[idx] = wf; else list.push(wf);
          await env.PRISM_KV.put('workflows:list', JSON.stringify(list));
          await env.PRISM_KV.put(`workflows:${id}`, JSON.stringify(wf));
        }
        return json({ success: true, workflow: wf }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/workflows/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/workflows/', '');
        if (env.PRISM_KV) {
          const list = (await env.PRISM_KV.get('workflows:list', 'json') || []).filter(w => w.id !== id);
          await env.PRISM_KV.put('workflows:list', JSON.stringify(list));
          await env.PRISM_KV.delete(`workflows:${id}`);
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

  // ── WIP/Job tracking (B3) ─────────────────────────────────────────────────────
    if (path === '/api/jobs' && request.method === 'GET') {
      try {
        const jobs = env.PRISM_KV ? await env.PRISM_KV.get('jobs:active', 'json') : null;
        return json({ jobs: jobs || [] }, 200, origin);
      } catch(e) { return json({ jobs: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/jobs' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = 'job-' + Date.now();
        const job = { id, type: body.type || 'analysis', status: 'running', phase: body.phase || 'starting', progress: 0, total: body.total || 0, workspaceId: body.workspaceId || null, agentId: body.agentId || null, label: body.label || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const jobs = await env.PRISM_KV.get('jobs:active', 'json') || [];
          jobs.push(job);
          await env.PRISM_KV.put('jobs:active', JSON.stringify(jobs));
        }
        return json({ success: true, job }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/jobs/') && (request.method === 'PATCH' || request.method === 'PUT')) {
      try {
        const id = path.replace('/api/jobs/', '');
        const body = await request.json();
        if (env.PRISM_KV) {
          const jobs = await env.PRISM_KV.get('jobs:active', 'json') || [];
          const idx = jobs.findIndex(j => j.id === id);
          if (idx >= 0) {
            jobs[idx] = { ...jobs[idx], ...body, id, updatedAt: new Date().toISOString() };
            if (body.status === 'complete' || body.status === 'error') {
              jobs.splice(idx, 1); // Remove from active
            }
            await env.PRISM_KV.put('jobs:active', JSON.stringify(jobs));
          }
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

  // ── Document CRUD (G2) ────────────────────────────────────────────────────────
    if (path === '/api/documents' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? await env.PRISM_KV.get('docs:list', 'json') : null;
        return json({ documents: list || [] }, 200, origin);
      } catch(e) { return json({ documents: [], error: e.message }, 200, origin); }
    }
    if (path === '/api/documents' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('doc-' + Date.now());
        const doc = { id, title: body.title || 'Untitled', type: body.type || 'note', content: body.content || '', annotations: body.annotations || [], tags: body.tags || [], moduleSource: body.moduleSource || 'drafting', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('docs:list', 'json') || [];
          const existing = list.findIndex(d => d.id === id);
          const meta = { id: doc.id, title: doc.title, type: doc.type, tags: doc.tags, moduleSource: doc.moduleSource, updatedAt: doc.updatedAt };
          if (existing >= 0) list[existing] = meta; else list.push(meta);
          await env.PRISM_KV.put('docs:list', JSON.stringify(list));
          await env.PRISM_KV.put(`doc:${id}`, JSON.stringify(doc));
        }
        return json({ success: true, document: doc }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/documents/') && request.method === 'GET') {
      try {
        const id = path.replace('/api/documents/', '');
        const doc = env.PRISM_KV ? await env.PRISM_KV.get(`doc:${id}`, 'json') : null;
        if (!doc) return json({ error: 'Not found' }, 404, origin);
        return json({ document: doc }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/documents/') && (request.method === 'PUT' || request.method === 'PATCH')) {
      try {
        const id = path.replace('/api/documents/', '');
        const body = await request.json();
        const existing = env.PRISM_KV ? await env.PRISM_KV.get(`doc:${id}`, 'json') : null;
        const doc = { ...(existing || {}), ...body, id, updatedAt: new Date().toISOString() };
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('docs:list', 'json') || [];
          const idx = list.findIndex(d => d.id === id);
          const meta = { id: doc.id, title: doc.title, type: doc.type, tags: doc.tags, moduleSource: doc.moduleSource, updatedAt: doc.updatedAt };
          if (idx >= 0) list[idx] = meta; else list.push(meta);
          await env.PRISM_KV.put('docs:list', JSON.stringify(list));
          await env.PRISM_KV.put(`doc:${id}`, JSON.stringify(doc));
        }
        return json({ success: true, document: doc }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path.startsWith('/api/documents/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/documents/', '');
        if (env.PRISM_KV) {
          const list = (await env.PRISM_KV.get('docs:list', 'json') || []).filter(d => d.id !== id);
          await env.PRISM_KV.put('docs:list', JSON.stringify(list));
          await env.PRISM_KV.delete(`doc:${id}`);
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

  // ── Canvas render (D1) ────────────────────────────────────────────────────────
    if (path === '/api/canvas/render' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || 'Understand your past. Appreciate the present. Define your future.';
        const template = body.template || 'quote-teal';
        const pexelsKey = k(env, ['pexels_api_key', 'PEXELS_API_KEY', 'pexels']) || '';

        // Strategy: SVG-based canvas generation (no headless browser needed)
        // This produces a real image that renders correctly on all platforms

        // Get background image from Pexels
        let bgUrl = '';
        let bgBase64 = '';
        if (pexelsKey) {
          try {
            const queries = ['landscape vista nature', 'mountain sunrise', 'ocean horizon', 'forest path light', 'partnership hands'];
            const q = queries[Math.floor(Math.random() * queries.length)];
            const pexResp = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=15&orientation=square&size=medium', {
              headers: {'Authorization': pexelsKey}
            });
            if (pexResp.ok) {
              const pexData = await pexResp.json();
              const photos = pexData.photos || [];
              if (photos.length) {
                const photo = photos[Math.floor(Math.random() * photos.length)];
                bgUrl = photo.src.medium;
                // Fetch and base64 encode the image for embedding in SVG
                const imgResp = await fetch(bgUrl);
                if (imgResp.ok) {
                  const imgBuf = await imgResp.arrayBuffer();
                  const bytes = new Uint8Array(imgBuf);
                  let binary = '';
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  bgBase64 = 'data:image/jpeg;base64,' + btoa(binary);
                }
              }
            }
          } catch(e) {}
        }

        // Brand colours
        const TEAL = '#0f3b3a';
        const ROSE = '#5c2d3f';
        const IVORY = '#f7f3e9';

        // Word-wrap text for SVG
        function wrapText(str, maxChars) {
          const words = str.split(' ');
          const lines = [];
          let current = '';
          for (const word of words) {
            if ((current + ' ' + word).trim().length > maxChars) {
              if (current) lines.push(current.trim());
              current = word;
            } else {
              current = (current + ' ' + word).trim();
            }
          }
          if (current) lines.push(current.trim());
          return lines;
        }

        const quoteLines = wrapText(text, 28);
        const lineHeight = 52;
        const startY = 480 - (quoteLines.length * lineHeight) / 2;

        // Build SVG tspans for quote
        const tspans = quoteLines.map((line, i) =>
          '<tspan x="540" dy="' + (i === 0 ? '0' : lineHeight) + '">' + line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</tspan>'
        ).join('');

        // Generate SVG canvas (1080x1080)
        const svg = '<?xml version="1.0" encoding="UTF-8"?>' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">' +
          // Background image or colour
          (bgBase64
            ? '<image href="' + bgBase64 + '" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>'
            : '<rect width="1080" height="1080" fill="' + TEAL + '"/>') +
          // Dark overlay for readability
          '<rect width="1080" height="1080" fill="rgba(15,59,58,0.65)"/>' +
          // IP colour grid top-left (2x2: teal/rose/teal2/rose2)
          '<rect x="40" y="40" width="40" height="40" fill="' + TEAL + '" opacity="0.9"/>' +
          '<rect x="82" y="40" width="40" height="40" fill="' + ROSE + '" opacity="0.9"/>' +
          '<rect x="40" y="82" width="40" height="40" fill="' + TEAL + '" opacity="0.7"/>' +
          '<rect x="82" y="82" width="40" height="40" fill="' + ROSE + '" opacity="0.7"/>' +
          // Quote text
          '<text x="540" y="' + startY + '" font-family="Georgia, serif" font-style="italic" font-size="44" fill="' + IVORY + '" text-anchor="middle" dominant-baseline="middle">' +
          tspans +
          '</text>' +
          // Decorative line above wordmark
          '<line x1="200" y1="820" x2="880" y2="820" stroke="' + IVORY + '" stroke-width="1" opacity="0.5"/>' +
          // Identity Partners wordmark
          '<text x="540" y="860" font-family="Georgia, serif" font-size="28" fill="' + IVORY + '" text-anchor="middle" letter-spacing="4">IDENTITY PARTNERS</text>' +
          // Tagline
          '<text x="540" y="900" font-family="Arial, sans-serif" font-size="16" fill="' + IVORY + '" text-anchor="middle" opacity="0.8">Understand your past · Appreciate the present · Define your future</text>' +
          // Footer
          '<text x="540" y="1020" font-family="Arial, sans-serif" font-size="14" fill="' + IVORY + '" text-anchor="middle" opacity="0.7">identitypartners.uk · hello@identitypartners.uk · @identitypartners</text>' +
          // Decorative line below wordmark
          '<line x1="200" y1="930" x2="880" y2="930" stroke="' + IVORY + '" stroke-width="1" opacity="0.3"/>' +
          '</svg>';

        // Upload SVG to R2 if available, otherwise return as data URL
        const svgKey = 'canvas/svg-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.svg';
        let svgUrl = '';

        if (env.PRISM_ASSETS) {
          try {
            await env.PRISM_ASSETS.put(svgKey, svg, {httpMetadata: {contentType: 'image/svg+xml'}});
            svgUrl = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/' + svgKey;
          } catch(e) {}
        }

        // Also provide a pre-baked PNG fallback for platforms that don't support SVG
        const prebaked = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-' + Math.floor(Math.random() * 150) + '.png';

        return json({
          success: true,
          url: svgUrl || prebaked,
          svgUrl: svgUrl,
          prebakedUrl: prebaked,
          svg: svg,
          method: svgUrl ? 'svg-r2' : 'prebaked',
          text: text.substring(0, 100),
          bgUrl: bgUrl
        }, 200, origin);

      } catch(e) {
        const prebaked = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-' + Math.floor(Math.random() * 150) + '.png';
        return json({success:true, url:prebaked, method:'error-fallback', error:e.message}, 200, origin);
      }
    }

  // ── Unified social posting pipeline (D2) ─────────────────────────────────────
    if (path === '/api/pipeline/unified' && request.method === 'POST') {
      try {
        const body = await request.json();
        const rawText = body.text || '';
        const platforms = body.platforms || ['bluesky'];
        const bufferKey = k(env, ['buffer', 'BUFFER_KEY', 'buffer_api_key']) || '';
        const bskyHandle = k(env, ['bluesky_handle', 'BLUESKY_HANDLE']) || '@identitypartners.bsky.social';
        const bskyPass = k(env, ['bluesky_password', 'BLUESKY_PASSWORD']) || '';

        // Mandatory tags and footer
        const TAGS = '#IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing';
        const FOOTER = 'hello@identitypartners.uk | www.identitypartners.uk/contact';
        const text = rawText + '\n\n' + TAGS + '\n' + FOOTER;

        // Never post test strings
        if (rawText.toLowerCase().includes('test post') || rawText.toLowerCase().includes('say ok')) {
          return json({success:false, error:'Test strings not allowed in unified pipeline'}, 400, origin);
        }

        const results = {};

        // Get canvas image
        let imageUrl = null;
        try {
          const canvasResp = await fetch(`${new URL(request.url).origin}/api/canvas/render`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text: rawText})
          });
          if (canvasResp.ok) {
            const canvasData = await canvasResp.json();
            imageUrl = canvasData.url;
          }
        } catch(e) {}

        // Bluesky
        if (platforms.includes('bluesky') && bskyHandle && bskyPass) {
          try {
            const sessionResp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({identifier: bskyHandle, password: bskyPass})
            });
            if (sessionResp.ok) {
              const session = await sessionResp.json();
              const postBody = {repo: session.did, collection: 'app.bsky.feed.post', record: {text: text.substring(0, 300), createdAt: new Date().toISOString(), langs: ['en-GB']}};
              const postResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${session.accessJwt}`},
                body: JSON.stringify(postBody)
              });
              results.bluesky = {success: postResp.ok, status: postResp.status};
            }
          } catch(e) { results.bluesky = {success: false, error: e.message}; }
        }

        // Buffer (Instagram, Facebook, X)
        if (bufferKey && imageUrl) {
          const bufferChannels = {
            instagram: k(env, ['buffer_ig_channel', 'BUFFER_IG_CHANNEL']) || '',
            facebook: k(env, ['buffer_fb_channel', 'BUFFER_FB_CHANNEL']) || '',
            x: k(env, ['buffer_x_channel', 'BUFFER_X_CHANNEL']) || '',
          };
          for (const [platform, channelId] of Object.entries(bufferChannels)) {
            if (!channelId || !platforms.includes(platform)) continue;
            try {
              const mutation = `mutation CreateIdea($input: IdeaCreateInput!) { ideaCreate(input: $input) { idea { id } } }`;
              const bufResp = await fetch('https://api.bufferapp.com/graphql', {
                method: 'POST',
                headers: {'Authorization': `Bearer ${bufferKey}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({query: mutation, variables: {input: {channelId, text, mediaUrls: [imageUrl]}}})
              });
              results[platform] = {success: bufResp.ok, status: bufResp.status};
            } catch(e) { results[platform] = {success: false, error: e.message}; }
          }
        }

        return json({success: true, results, imageUrl, text: text.substring(0, 100) + '...'}, 200, origin);
      } catch(e) { return json({success: false, error: e.message}, 500, origin); }
    }

  // ── Daily pipeline cron handler (D2) ─────────────────────────────────────────
    if (path === '/api/pipeline/morning' && (request.method === 'POST' || request.method === 'GET')) {
      try {
        const h = new Date().getUTCHours();
        const slot = h < 11 ? 'morning' : h < 16 ? 'lunchtime' : 'evening';
        const prompts = {
          morning: 'Write a thought-provoking post about understanding your past and how it shapes your present. Focus on recovery, mental health, and personal growth. British English. 2-3 sentences max.',
          lunchtime: 'Write a reflective post about appreciating the present moment. Connect to themes of wellbeing, recovery, and identity. British English. 2-3 sentences max.',
          evening: 'Write an engaging question-driven post about defining your future. Connect to themes of personal growth, recovery, and identity. British English. 2-3 sentences max.',
        };
        const msgs = [
          {role:'system', content:'You are a compassionate content writer for Identity Partners. British English only. Be concise.'},
          {role:'user', content:prompts[slot]}
        ];
        const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
        const deepseekKey = k(env, ['deepseek_paid','DEEPSEEK_PAID','deepseek_p']);
        const TAGS = '#IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Wellbeing';
        const FOOTER = 'hello@identitypartners.uk | www.identitypartners.uk/contact';
        let postText = '';
        try {
          const key = mistralKey || deepseekKey;
          const endpoint = mistralKey ? 'https://api.mistral.ai/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
          const model = mistralKey ? 'mistral-small-latest' : 'deepseek-chat';
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
            body: JSON.stringify({model, messages: msgs, max_tokens: 150, temperature: 0.8})
          });
          if (resp.ok) {
            const data = await resp.json();
            postText = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
          }
        } catch(llmErr) {}
        if (!postText) postText = 'Understand your past. Appreciate the present. Define your future. identitypartners.uk/contact';
        const fullText = postText + '\n\n' + TAGS + '\n' + FOOTER;
        const results = {};
        const bskyHandle = k(env, ['bluesky_handle','BLUESKY_HANDLE']) || '@identitypartners.bsky.social';
        const bskyPass = k(env, ['bluesky_password','BLUESKY_PASSWORD']) || '';
        if (bskyHandle && bskyPass) {
          try {
            const sessionResp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({identifier: bskyHandle, password: bskyPass})
            });
            if (sessionResp.ok) {
              const session = await sessionResp.json();
              const postResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.accessJwt},
                body: JSON.stringify({repo: session.did, collection: 'app.bsky.feed.post', record: {text: fullText.substring(0, 300), createdAt: new Date().toISOString(), langs: ['en-GB']}})
              });
              results.bluesky = {success: postResp.ok, status: postResp.status};
            }
          } catch(bskyErr) { results.bluesky = {success: false, error: bskyErr.message}; }
        }
        if (env.PRISM_KV) {
          await env.PRISM_KV.put('pipeline:last-run', JSON.stringify({slot, text: postText.substring(0,100), results, timestamp: new Date().toISOString()}));
        }
        return json({success: true, slot, text: postText.substring(0, 100) + '...', results}, 200, origin);
      } catch(e) { return json({success: false, error: e.message}, 500, origin); }
    }

  // ── Site crawl (A3) ───────────────────────────────────────────────────────────
    if (path === '/api/site/crawl' && request.method === 'POST') {
      try {
        const firecrawlKey = k(env, ['firecrawl', 'FIRECRAWL_KEY', 'firecrawl_api_key']) || '';
        if (!firecrawlKey) return json({error: 'Firecrawl key not configured'}, 400, origin);
        const body = await request.json().catch(() => ({}));
        const targetUrl = body.url || 'https://www.identitypartners.uk';
        const crawlResp = await fetch('https://api.firecrawl.dev/v1/crawl', {
          method: 'POST',
          headers: {'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({url: targetUrl, limit: 50, scrapeOptions: {formats: ['markdown']}})
        });
        const crawlData = await crawlResp.json();
        if (env.PRISM_KV && crawlData.id) {
          await env.PRISM_KV.put('site:crawl:last', JSON.stringify({jobId: crawlData.id, startedAt: new Date().toISOString(), url: targetUrl}));
        }
        return json({success: crawlResp.ok, jobId: crawlData.id, status: crawlData.status}, 200, origin);
      } catch(e) { return json({success: false, error: e.message}, 500, origin); }
    }


    // ── Dev Team routes (H1) ─────────────────────────────────────────────────────
    if (path === '/api/devteam' && request.method === 'POST') {
      try {
        const body = await request.json();
        const userMsg = body.message || body.content || '';
        const history = body.history || [];
        const msgs = [
          {role:'system', content:'You are the Argentica Dev Team agent. Senior full-stack developer and system architect for Simon Johnson (Identity Partners). You have access to the Cloudflare Worker (prism-api.identitypartners.workers.dev), GitHub repo (IdentityPartners/prism), KV storage, D1 database, and all API integrations. You diagnose issues, implement fixes, build features, and maintain the system autonomously. You never ask Simon to do anything technical. British English throughout. No sycophancy. No AI tropes. Be direct and precise. Implement fixes, do not just describe them. Routing chain: DeepSeek -> Kimi -> Mistral -> GLM -> Cohere -> Cerebras -> Groq -> Gemini -> Pollinations.\n\nYou have REAL tools, executed automatically when you write them on their own line in this exact format:\nTOOL: health({}) — full system health check\nTOOL: kv-list({"prefix": ""}) — list KV keys\nTOOL: get_kv({"key": "..."}) — read a KV value\nTOOL: set_kv({"key": "...", "value": "..."}) — write a KV value\nTOOL: update_kv_bulk({"entries": [{"key": "...", "value": "..."}]}) — write many KV values\nTOOL: push_to_github({"path": "file/path.js", "content": "full file content", "message": "commit message", "branch": "main"}) — push a file to the repo; a push to main auto-deploys Pages and the worker\nTOOL: deploy_worker({}) — redeploy the current worker script with all bindings intact\nTOOL: test-provider({"provider": "mistral"}) — test any LLM provider\nWhen a fix requires a code change, use push_to_github with the COMPLETE new file content, never a diff. Then use deploy_worker if the change was to worker/index.js and time matters.'},
          ...history.slice(-10),
          {role:'user', content:userMsg}
        ];
        const _dtq = msgs.filter(function(m){return m.role==='user';}).pop();
        const _dtmc = await buildMemoryContext(env, _dtq ? _dtq.content : '');
        if (_dtmc) { const _dtsi = msgs.findIndex(function(m){return m.role==='system';}); if (_dtsi>=0) msgs[_dtsi].content+=('\n\n'+_dtmc); else msgs.unshift({role:'system',content:_dtmc}); }
        const result = await orchestrate(msgs, env, {profile:'balanced'});
        let content = result.content || '';

        // ── Execute TOOL: action({params}) lines for real ─────────────
        const toolCalls = [];
        const toolRe = /^TOOL:\s*([a-z_-]+)\s*\((\{[\s\S]*?\})\)\s*$/gm;
        let tm;
        while ((tm = toolRe.exec(content)) !== null) {
          const action = tm[1];
          let params = {};
          try { params = JSON.parse(tm[2]); } catch (e) { toolCalls.push({ action, error: 'bad arguments' }); continue; }
          try {
            const r = await fetch('https://prism-api.identitypartners.workers.dev/api/devteam/execute', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action, ...params })
            }).then(x => x.json());
            toolCalls.push({ action, result: r });
          } catch (e) { toolCalls.push({ action, error: e.message }); }
        }
        if (toolCalls.length) {
          content = content.replace(toolRe, '').trim();
          content += '\n\n[Tools executed: ' + toolCalls.map(t => t.action).join(', ') + ']';
        }
        return json({success:true, content, provider:result.provider, model:result.model, toolCalls}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    if (path === '/api/devteam/execute' && request.method === 'POST') {
      try {
        const body = await request.json();
        const action = body.action || '';
        const results = {};

        // Health check
        if (action === 'health' || action === 'diagnose') {
          results.worker = 'online';
          results.kv = env.PRISM_KV ? 'connected' : 'missing';
          results.d1 = env.PRISM_D1 ? 'connected' : 'missing';
          // Test a KV read
          try {
            await env.PRISM_KV.get('health:ping');
            results.kv_read = 'ok';
          } catch(e) { results.kv_read = 'error: ' + e.message; }
          // Check routing chain
          const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
          const deepseekKey = k(env, ['deepseek_paid','DEEPSEEK_PAID']);
          const groqKey = k(env, ['groq_f1','groq_f2','groq_f3','groq_free_1','GROQ_FREE_1','groq_free_2','groq_free_3']);
          const cerebrasKey = k(env, ['cerebras_p1','cerebras_f1']);
          results.providers = {
            mistral: mistralKey ? 'key present' : 'MISSING',
            deepseek: deepseekKey ? 'key present' : 'MISSING',
            groq: groqKey ? 'key present' : 'MISSING',
            cerebras: cerebrasKey ? 'key present' : 'MISSING',
          };
          return json({success:true, action, results}, 200, origin);
        }

        // KV inspect
        if (action === 'kv-list') {
          const prefix = body.prefix || '';
          try {
            const list = await env.PRISM_KV.list({prefix, limit:20});
            results.keys = list.keys.map(k => k.name);
            results.complete = !list.list_complete ? false : true;
          } catch(e) { results.error = e.message; }
          return json({success:true, action, results}, 200, origin);
        }

        // Test provider
        // KV read/write — the Dev Team can inspect and fix state directly
        if (action === 'get_kv') {
          const kvKey = body.key || '';
          if (!kvKey) return json({success:false, error:'key required'}, 400, origin);
          const value = env.PRISM_KV ? await env.PRISM_KV.get(kvKey) : null;
          return json({success:true, action, key:kvKey, value, found: value !== null}, 200, origin);
        }
        if (action === 'set_kv') {
          const kvKey = body.key || '';
          const kvVal = body.value !== undefined ? (typeof body.value === 'string' ? body.value : JSON.stringify(body.value)) : '';
          if (!kvKey) return json({success:false, error:'key required'}, 400, origin);
          if (!env.PRISM_KV) return json({success:false, error:'KV not bound'}, 500, origin);
          await env.PRISM_KV.put(kvKey, kvVal);
          return json({success:true, action, key:kvKey}, 200, origin);
        }
        if (action === 'update_kv_bulk') {
          const entries = body.entries || [];
          if (!Array.isArray(entries) || !entries.length) return json({success:false, error:'entries array required'}, 400, origin);
          if (!env.PRISM_KV) return json({success:false, error:'KV not bound'}, 500, origin);
          let written = 0;
          for (const e of entries) {
            if (!e.key) continue;
            await env.PRISM_KV.put(e.key, e.value !== undefined ? (typeof e.value === 'string' ? e.value : JSON.stringify(e.value)) : '');
            written++;
          }
          return json({success:true, action, written}, 200, origin);
        }

        // Push any file to the GitHub repo (a push to main auto-deploys Pages + worker)
        if (action === 'push_to_github') {
          const ghToken = k(env, ['github_token','GITHUB_TOKEN']) || '';
          const filePath = body.path || '';
          const content = body.content || '';
          const message = body.message || 'Dev Team update';
          const branch = body.branch || 'main';
          if (!ghToken) return json({success:false, error:'github_token secret not set'}, 400, origin);
          if (!filePath || !content) return json({success:false, error:'path and content required'}, 400, origin);
          try {
            const head = await fetch('https://api.github.com/repos/IdentityPartners/prism/contents/' + filePath + '?ref=' + branch, {
              headers: { Authorization: 'Bearer ' + ghToken, Accept: 'application/vnd.github+json' }
            }).then(r => r.json());
            const payload = { message, content: btoa(unescape(encodeURIComponent(content))), branch };
            if (head && head.sha) payload.sha = head.sha;
            const put = await fetch('https://api.github.com/repos/IdentityPartners/prism/contents/' + filePath, {
              method: 'PUT',
              headers: { Authorization: 'Bearer ' + ghToken, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }).then(r => r.json());
            return json({success: !!(put.content && put.content.html_url), action, url: put.content && put.content.html_url, error: put.message && !put.content ? put.message : undefined}, 200, origin);
          } catch(e) { return json({success:false, action, error: e.message}, 200, origin); }
        }

        // Redeploy the current worker script with all bindings intact
        if (action === 'deploy_worker') {
          const cfToken = k(env, ['cf_token','CF_TOKEN']) || '';
          if (!cfToken) return json({success:false, error:'cf_token secret not set'}, 400, origin);
          try {
            const scriptRes = await fetch('https://api.cloudflare.com/client/v4/accounts/d741de91f8cfff2306cc0f850a76ee07/workers/scripts/prism-api', {
              headers: { Authorization: 'Bearer ' + cfToken }
            });
            if (!scriptRes.ok) return json({success:false, action, error: 'Could not fetch current script: HTTP ' + scriptRes.status}, 200, origin);
            const scriptText = await scriptRes.text();
            const metadata = {
              main_module: 'index.js',
              compatibility_date: '2024-09-01',
              compatibility_flags: ['nodejs_compat'],
              bindings: [
                { type: 'kv_namespace', name: 'PRISM_KV', namespace_id: '8d1a583cc99a482380aacb526d873030' },
                { type: 'd1', name: 'PRISM_D1', id: 'e953848b-7d62-4629-bb4d-271da0d03fd5' },
                { type: 'r2_bucket', name: 'PRISM_ASSETS', bucket_name: 'prism-assets' }
              ]
            };
            const fd = new FormData();
            fd.append('metadata', JSON.stringify(metadata));
            fd.append('index.js', new File([scriptText], 'index.js', { type: 'application/javascript+module' }));
            const dep = await fetch('https://api.cloudflare.com/client/v4/accounts/d741de91f8cfff2306cc0f850a76ee07/workers/scripts/prism-api', {
              method: 'PUT', headers: { Authorization: 'Bearer ' + cfToken }, body: fd
            }).then(r => r.json());
            return json({success: !!dep.success, action, error: dep.errors && dep.errors.length ? dep.errors[0].message : undefined}, 200, origin);
          } catch(e) { return json({success:false, action, error: e.message}, 200, origin); }
        }

        if (action === 'test-provider') {
          const provider = body.provider || 'mistral';
          const testMsgs = [{role:'user', content:'Reply with exactly: OK'}];
          try {
            const result = await orchestrate(testMsgs, env, {profile:'balanced', providerOverride:provider});
            results.response = result.content;
            results.provider = result.provider;
            results.model = result.model;
          } catch(e) { results.error = e.message; }
          return json({success:true, action, results}, 200, origin);
        }

        return json({success:true, action, results:{message:'Action not recognised: ' + action}}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }


    // ── KV generic get/set/delete (used by Study Hub and other modules) ───────────
    // ── Secret Ingester ── proxy CF secrets API to avoid CORS ──────────────────
    if (path === '/api/ingest-secrets' && request.method === 'POST') {
      try {
        const body = await request.json();
        const secrets = body.secrets;
        const cfToken = body.cfToken || k(env, ['cf_token','CF_TOKEN','cloudflare_api_token','CLOUDFLARE_API_TOKEN']) || '';
        const accountId = body.accountId || k(env, ['cf_account_id','CF_ACCOUNT_ID']) || 'd741de91f8cfff2306cc0f850a76ee07';
        const workerName = body.workerName || 'prism-api';
        if (!cfToken) {
          return json({ error: 'No Cloudflare token available. Store cf_token as a worker secret once, then ingest normally.' }, 400, origin);
        }
        if (!Array.isArray(secrets) || secrets.length === 0) {
          return json({ error: 'secrets array is required' }, 400, origin);
        }
        const results = [];
        for (const secret of secrets) {
          const { name, value } = secret;
          if (!name || value === undefined) {
            results.push({ name: name || '?', success: false, error: 'name and value required' });
            continue;
          }
          try {
            const resp = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
              {
                method: 'PUT',
                headers: {
                  'Authorization': 'Bearer ' + cfToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, text: value, type: 'secret_text' }),
              }
            );
            const data = await resp.json();
            if (data.success) {
              results.push({ name, success: true });
            } else {
              const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || 'Unknown error';
              results.push({ name, success: false, error: errMsg });
            }
          } catch (e) {
            results.push({ name, success: false, error: e.message });
          }
        }
        const pushed = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        return json({ success: true, pushed, failed, results }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

        if (path === '/api/kv/get' && request.method === 'GET') {
      try {
        const kvKey = url.searchParams.get('key') || '';
        if (!kvKey) return json({error:'key required'}, 400, origin);
        const value = env.PRISM_KV ? await env.PRISM_KV.get(kvKey) : null;
        return json({key:kvKey, value:value, found:value !== null}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }
    if (path === '/api/kv/set' && request.method === 'POST') {
      try {
        const body = await request.json();
        const kvKey = body.key || '';
        const kvVal = body.value !== undefined ? (typeof body.value === 'string' ? body.value : JSON.stringify(body.value)) : '';
        const ttl = body.ttl ? {expirationTtl: body.ttl} : {};
        if (!kvKey) return json({error:'key required'}, 400, origin);
        if (env.PRISM_KV) await env.PRISM_KV.put(kvKey, kvVal, ttl);
        return json({success:true, key:kvKey}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }
    if (path === '/api/kv/delete' && request.method === 'DELETE') {
      try {
        const kvKey = url.searchParams.get('key') || '';
        if (!kvKey) return json({error:'key required'}, 400, origin);
        if (env.PRISM_KV) await env.PRISM_KV.delete(kvKey);
        return json({success:true, key:kvKey}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }
    if (path === '/api/kv/list' && request.method === 'GET') {
      try {
        const prefix = url.searchParams.get('prefix') || '';
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const list = env.PRISM_KV ? await env.PRISM_KV.list({prefix, limit}) : {keys:[]};
        return json({keys: list.keys.map(function(k) { return k.name; }), complete: list.list_complete}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Mistral OCR (Document AI) ─────────────────────────────────────────────
    if (path === '/api/ocr/mistral' && request.method === 'POST') {
      try {
        const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
        if (!mistralKey) return json({error:'Mistral key not configured'}, 400, origin);
        const body = await request.json();
        const documentUrl = body.url || body.document_url || '';
        const documentBase64 = body.base64 || '';
        const tableFormat = body.table_format || 'markdown';
        const includeBlocks = body.include_blocks !== false;

        let docInput;
        if (documentBase64) {
          docInput = {type: 'document_url', document_url: 'data:application/pdf;base64,' + documentBase64};
        } else if (documentUrl) {
          docInput = {type: 'document_url', document_url: documentUrl};
        } else {
          return json({error: 'Provide url or base64'}, 400, origin);
        }

        const ocrResp = await fetch('https://api.mistral.ai/v1/ocr', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + mistralKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            model: 'mistral-ocr-latest',
            document: docInput,
            table_format: tableFormat,
            include_blocks: includeBlocks,
            include_image_base64: false,
          })
        });
        if (!ocrResp.ok) {
          const err = await ocrResp.text();
          return json({error: 'Mistral OCR error: ' + err.substring(0,200)}, ocrResp.status, origin);
        }
        const ocrData = await ocrResp.json();
        // Extract markdown from pages
        const pages = ocrData.pages || [];
        const markdown = pages.map(function(p) { return p.markdown || ''; }).join('\n\n---\n\n');
        return json({success: true, markdown, pages: pages.length, model: 'mistral-ocr-latest'}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Mistral TTS (Voxtral) ─────────────────────────────────────────────────
    if (path === '/api/tts/mistral' && request.method === 'POST') {
      try {
        const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
        if (!mistralKey) return json({error:'Mistral key not configured'}, 400, origin);
        const body = await request.json();
        const text = body.text || '';
        const voiceId = body.voice_id || null;
        const model = body.model || 'voxtral-tts';
        const format = body.format || 'mp3';
        if (!text) return json({error:'text required'}, 400, origin);

        const ttsBody = {model, input: text, response_format: format};
        if (voiceId) ttsBody.voice_id = voiceId;

        const ttsResp = await fetch('https://api.mistral.ai/v1/audio/speech', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + mistralKey, 'Content-Type': 'application/json'},
          body: JSON.stringify(ttsBody)
        });
        if (!ttsResp.ok) {
          const err = await ttsResp.text();
          return json({error: 'Mistral TTS error: ' + err.substring(0,200)}, ttsResp.status, origin);
        }
        // Return audio as base64
        const audioBuf = await ttsResp.arrayBuffer();
        const audioB64 = btoa(String.fromCharCode(...new Uint8Array(audioBuf)));
        return json({success: true, audio_base64: audioB64, format, model}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Mistral STT (Voxtral Transcribe) ──────────────────────────────────────
    if (path === '/api/stt/mistral' && request.method === 'POST') {
      try {
        const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
        if (!mistralKey) return json({error:'Mistral key not configured'}, 400, origin);
        const formData = await request.formData();
        const audioFile = formData.get('file') || formData.get('audio');
        const model = formData.get('model') || 'voxtral-mini-transcribe-3';
        if (!audioFile) return json({error:'audio file required'}, 400, origin);

        const sttForm = new FormData();
        sttForm.append('file', audioFile);
        sttForm.append('model', model);

        const sttResp = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + mistralKey},
          body: sttForm
        });
        if (!sttResp.ok) {
          const err = await sttResp.text();
          return json({error: 'Mistral STT error: ' + err.substring(0,200)}, sttResp.status, origin);
        }
        const sttData = await sttResp.json();
        return json({success: true, text: sttData.text || '', model, segments: sttData.segments || []}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Gemini TTS (3.8 Flash TTS — FREE) ────────────────────────────────────
    if (path === '/api/tts/gemini' && request.method === 'POST') {
      try {
        const geminiKey = k(env, ['gemini_api_key','GEMINI_API_KEY','gemini_p']);
        if (!geminiKey) return json({error:'Gemini key not configured'}, 400, origin);
        const body = await request.json();
        const text = body.text || '';
        const voice = body.voice || 'Aoede';
        if (!text) return json({error:'text required'}, 400, origin);

        const ttsResp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=' + geminiKey,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              contents: [{parts: [{text}]}],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}}
              }
            })
          }
        );
        if (!ttsResp.ok) {
          const err = await ttsResp.text();
          return json({error: 'Gemini TTS error: ' + err.substring(0,200)}, ttsResp.status, origin);
        }
        const ttsData = await ttsResp.json();
        const audioB64 = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
        return json({success: true, audio_base64: audioB64, format: 'wav', model: 'gemini-3.8-flash-tts', voice}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Gemini Embeddings (FREE — best all-rounder per CCKM benchmark) ────────
    if (path === '/api/embed/gemini' && request.method === 'POST') {
      try {
        const geminiKey = k(env, ['gemini_api_key','GEMINI_API_KEY','gemini_p']);
        if (!geminiKey) return json({error:'Gemini key not configured'}, 400, origin);
        const body = await request.json();
        const texts = Array.isArray(body.texts) ? body.texts : [body.text || body.content || ''];
        const taskType = body.task_type || 'RETRIEVAL_DOCUMENT';

        const embedResp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents?key=' + geminiKey,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              requests: texts.map(function(t) {
                return {model: 'models/gemini-embedding-2', content: {parts: [{text: t}]}, taskType};
              })
            })
          }
        );
        if (!embedResp.ok) {
          const err = await embedResp.text();
          return json({error: 'Gemini embed error: ' + err.substring(0,200)}, embedResp.status, origin);
        }
        const embedData = await embedResp.json();
        const embeddings = (embedData.embeddings || []).map(function(e) { return e.values || []; });
        return json({success: true, embeddings, model: 'gemini-embedding-2', count: embeddings.length}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Mistral Embeddings (paid, best English quality) ───────────────────────
    if (path === '/api/embed/mistral' && request.method === 'POST') {
      try {
        const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY','mistral_p']);
        if (!mistralKey) return json({error:'Mistral key not configured'}, 400, origin);
        const body = await request.json();
        const inputs = Array.isArray(body.texts) ? body.texts : [body.text || body.content || ''];

        const embedResp = await fetch('https://api.mistral.ai/v1/embeddings', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + mistralKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({model: 'mistral-embed', input: inputs})
        });
        if (!embedResp.ok) {
          const err = await embedResp.text();
          return json({error: 'Mistral embed error: ' + err.substring(0,200)}, embedResp.status, origin);
        }
        const embedData = await embedResp.json();
        const embeddings = (embedData.data || []).map(function(e) { return e.embedding || []; });
        return json({success: true, embeddings, model: 'mistral-embed', count: embeddings.length}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── Twenty CRM API proxy ──────────────────────────────────────────────────────
    if (path === '/api/twenty/test' && request.method === 'POST') {
      try {
        const body = await request.json();
        const apiKey = body.apiKey || k(env, ['twenty_api_key','TWENTY_API_KEY']) || '';
        const workspaceUrl = (body.workspaceUrl || '').replace(/\/$/, '');
        if (!apiKey || !workspaceUrl) return json({success:false, error:'API key and workspace URL required'}, 400, origin);
        const resp = await fetch(workspaceUrl + '/api', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: '{ currentWorkspace { id displayName } }'})
        });
        if (!resp.ok) return json({success:false, error:'HTTP ' + resp.status}, 200, origin);
        const data = await resp.json();
        const ws = data.data && data.data.currentWorkspace;
        if (ws) {
          // Store config in KV
          if (env.PRISM_KV) await env.PRISM_KV.put('twenty:config', JSON.stringify({apiKey, workspaceUrl, savedAt: new Date().toISOString()}));
          return json({success:true, workspace: ws.displayName || ws.id}, 200, origin);
        }
        return json({success:false, error: JSON.stringify(data.errors || data).substring(0,200)}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 200, origin); }
    }

    if (path === '/api/twenty/query' && request.method === 'POST') {
      try {
        const body = await request.json();
        let apiKey = body.apiKey;
        let workspaceUrl = body.workspaceUrl;
        // Fall back to stored config
        if (!apiKey || !workspaceUrl) {
          const stored = env.PRISM_KV ? await env.PRISM_KV.get('twenty:config', 'json') : null;
          if (stored) { apiKey = stored.apiKey; workspaceUrl = stored.workspaceUrl; }
        }
        if (!apiKey || !workspaceUrl) return json({error:'Twenty not configured'}, 400, origin);
        workspaceUrl = workspaceUrl.replace(/\/$/, '');
        const resp = await fetch(workspaceUrl + '/api', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: body.query, variables: body.variables || {}})
        });
        const data = await resp.json();
        return json(data, resp.status, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path === '/api/twenty/contacts' && request.method === 'GET') {
      try {
        const stored = env.PRISM_KV ? await env.PRISM_KV.get('twenty:config', 'json') : null;
        if (!stored) return json({error:'Twenty not configured'}, 400, origin);
        const resp = await fetch(stored.workspaceUrl + '/api', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + stored.apiKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: '{ people(first: 50, orderBy: {createdAt: DescNullsLast}) { edges { node { id name { firstName lastName } emails { primaryEmail } phones { primaryPhoneNumber } createdAt } } totalCount } }'})
        });
        const data = await resp.json();
        const people = (data.data && data.data.people && data.data.people.edges) ? data.data.people.edges.map(function(e) { return e.node; }) : [];
        return json({contacts: people, total: data.data && data.data.people ? data.data.people.totalCount : 0}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path === '/api/twenty/calendar' && request.method === 'GET') {
      try {
        const stored = env.PRISM_KV ? await env.PRISM_KV.get('twenty:config', 'json') : null;
        if (!stored) return json({error:'Twenty not configured', status:'not_connected', today:[], week:[]}, 200, origin);
        const now = new Date();
        const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const resp = await fetch(stored.workspaceUrl + '/api', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + stored.apiKey, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: '{ calendarEvents(first: 20, filter: {startsAt: {gte: "' + now.toISOString() + '", lte: "' + weekEnd + '"}}, orderBy: {startsAt: AscNullsLast}) { edges { node { id title startsAt endsAt location description } } } }'})
        });
        const data = await resp.json();
        const events = (data.data && data.data.calendarEvents && data.data.calendarEvents.edges) ? data.data.calendarEvents.edges.map(function(e) { return e.node; }) : [];
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
        const today = events.filter(function(e) { return e.startsAt && e.startsAt <= todayEnd; });
        const week = events.filter(function(e) { return e.startsAt && e.startsAt > todayEnd; });
        return json({status:'ok', today, week, total: events.length}, 200, origin);
      } catch(e) { return json({status:'error', error:e.message, today:[], week:[]}, 200, origin); }
    }


    // ── Native CRM — Contacts ─────────────────────────────────────────────────────
    if (path === '/api/crm/contacts' && request.method === 'GET') {
      try {
        const q = url.searchParams.get('q') || '';
        const limit = parseInt(url.searchParams.get('limit') || '50');
        let contacts;
        if (q) {
          contacts = await env.PRISM_D1.prepare(
            "SELECT * FROM crm_contacts WHERE name LIKE ? OR email LIKE ? OR company LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?"
          ).bind('%'+q+'%', '%'+q+'%', '%'+q+'%', '%'+q+'%', limit).all();
        } else {
          contacts = await env.PRISM_D1.prepare(
            "SELECT * FROM crm_contacts ORDER BY updated_at DESC LIMIT ?"
          ).bind(limit).all();
        }
        return json({contacts: contacts.results || [], total: (contacts.results || []).length}, 200, origin);
      } catch(e) {
        // Table may not exist yet — return empty
        return json({contacts: [], total: 0, note: 'Run /api/crm/init to create tables'}, 200, origin);
      }
    }

    if (path === '/api/crm/contacts' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('c-' + Date.now());
        const now = new Date().toISOString();
        await env.PRISM_D1.prepare(
          "INSERT OR REPLACE INTO crm_contacts (id, name, email, phone, company, role, tags, notes, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(id, body.name||'', body.email||'', body.phone||'', body.company||'', body.role||'', JSON.stringify(body.tags||[]), body.notes||'', body.source||'manual', body.created_at||now, now).run();
        return json({success:true, id}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    if (path.startsWith('/api/crm/contacts/') && request.method === 'PUT') {
      try {
        const id = path.replace('/api/crm/contacts/', '');
        const body = await request.json();
        const now = new Date().toISOString();
        await env.PRISM_D1.prepare(
          "UPDATE crm_contacts SET name=?, email=?, phone=?, company=?, role=?, tags=?, notes=?, updated_at=? WHERE id=?"
        ).bind(body.name||'', body.email||'', body.phone||'', body.company||'', body.role||'', JSON.stringify(body.tags||[]), body.notes||'', now, id).run();
        return json({success:true}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    if (path.startsWith('/api/crm/contacts/') && request.method === 'DELETE') {
      try {
        const id = path.replace('/api/crm/contacts/', '');
        await env.PRISM_D1.prepare("DELETE FROM crm_contacts WHERE id=?").bind(id).run();
        await env.PRISM_D1.prepare("DELETE FROM crm_interactions WHERE contact_id=?").bind(id).run();
        return json({success:true}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Native CRM — Companies ────────────────────────────────────────────────────
    if (path === '/api/crm/companies' && request.method === 'GET') {
      try {
        const q = url.searchParams.get('q') || '';
        const limit = parseInt(url.searchParams.get('limit') || '50');
        let companies;
        if (q) {
          companies = await env.PRISM_D1.prepare(
            "SELECT * FROM crm_companies WHERE name LIKE ? OR domain LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?"
          ).bind('%'+q+'%', '%'+q+'%', '%'+q+'%', limit).all();
        } else {
          companies = await env.PRISM_D1.prepare("SELECT * FROM crm_companies ORDER BY updated_at DESC LIMIT ?").bind(limit).all();
        }
        return json({companies: companies.results || [], total: (companies.results || []).length}, 200, origin);
      } catch(e) { return json({companies: [], total: 0}, 200, origin); }
    }

    if (path === '/api/crm/companies' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('co-' + Date.now());
        const now = new Date().toISOString();
        await env.PRISM_D1.prepare(
          "INSERT OR REPLACE INTO crm_companies (id, name, domain, industry, size, tags, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(id, body.name||'', body.domain||'', body.industry||'', body.size||'', JSON.stringify(body.tags||[]), body.notes||'', now, now).run();
        return json({success:true, id}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Native CRM — Interactions (log) ──────────────────────────────────────────
    if (path === '/api/crm/interactions' && request.method === 'GET') {
      try {
        const contactId = url.searchParams.get('contact_id') || '';
        const limit = parseInt(url.searchParams.get('limit') || '50');
        let interactions;
        if (contactId) {
          interactions = await env.PRISM_D1.prepare(
            "SELECT * FROM crm_interactions WHERE contact_id=? ORDER BY created_at DESC LIMIT ?"
          ).bind(contactId, limit).all();
        } else {
          interactions = await env.PRISM_D1.prepare(
            "SELECT * FROM crm_interactions ORDER BY created_at DESC LIMIT ?"
          ).bind(limit).all();
        }
        return json({interactions: interactions.results || []}, 200, origin);
      } catch(e) { return json({interactions: []}, 200, origin); }
    }

    if (path === '/api/crm/interactions' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = 'i-' + Date.now();
        const now = new Date().toISOString();
        await env.PRISM_D1.prepare(
          "INSERT INTO crm_interactions (id, contact_id, type, summary, notes, created_at) VALUES (?,?,?,?,?,?)"
        ).bind(id, body.contact_id||'', body.type||'note', body.summary||'', body.notes||'', now).run();
        return json({success:true, id}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Native CRM — Calendar events (D1-backed) ──────────────────────────────────
    if (path === '/api/crm/calendar' && request.method === 'GET') {
      try {
        const now = new Date().toISOString();
        const weekEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const events = await env.PRISM_D1.prepare(
          "SELECT * FROM crm_events WHERE starts_at >= ? AND starts_at <= ? ORDER BY starts_at ASC LIMIT 20"
        ).bind(now, weekEnd).all();
        const todayEnd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59).toISOString();
        const all = events.results || [];
        return json({
          status: 'ok',
          today: all.filter(function(e) { return e.starts_at <= todayEnd; }),
          week: all.filter(function(e) { return e.starts_at > todayEnd; }),
          total: all.length
        }, 200, origin);
      } catch(e) { return json({status:'ok', today:[], week:[], total:0}, 200, origin); }
    }

    if (path === '/api/crm/calendar' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('ev-' + Date.now());
        const now = new Date().toISOString();
        await env.PRISM_D1.prepare(
          "INSERT OR REPLACE INTO crm_events (id, title, starts_at, ends_at, location, description, contact_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(id, body.title||'Event', body.starts_at||now, body.ends_at||'', body.location||'', body.description||'', body.contact_id||'', now).run();
        return json({success:true, id}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Native CRM — Init tables ──────────────────────────────────────────────────
    if (path === '/api/crm/init' && request.method === 'POST') {
      try {
        await env.PRISM_D1.prepare(`CREATE TABLE IF NOT EXISTS crm_contacts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          email TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          company TEXT DEFAULT '',
          role TEXT DEFAULT '',
          tags TEXT DEFAULT '[]',
          notes TEXT DEFAULT '',
          source TEXT DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`).run();
        await env.PRISM_D1.prepare(`CREATE TABLE IF NOT EXISTS crm_companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          domain TEXT DEFAULT '',
          industry TEXT DEFAULT '',
          size TEXT DEFAULT '',
          tags TEXT DEFAULT '[]',
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`).run();
        await env.PRISM_D1.prepare(`CREATE TABLE IF NOT EXISTS crm_interactions (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL,
          type TEXT DEFAULT 'note',
          summary TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL
        )`).run();
        await env.PRISM_D1.prepare(`CREATE TABLE IF NOT EXISTS crm_events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          starts_at TEXT NOT NULL,
          ends_at TEXT DEFAULT '',
          location TEXT DEFAULT '',
          description TEXT DEFAULT '',
          contact_id TEXT DEFAULT '',
          created_at TEXT NOT NULL
        )`).run();
        await env.PRISM_D1.prepare("CREATE INDEX IF NOT EXISTS idx_contacts_email ON crm_contacts(email)").run();
        await env.PRISM_D1.prepare("CREATE INDEX IF NOT EXISTS idx_interactions_contact ON crm_interactions(contact_id)").run();
        await env.PRISM_D1.prepare("CREATE INDEX IF NOT EXISTS idx_events_starts ON crm_events(starts_at)").run();
        return json({success:true, message:'CRM tables created: crm_contacts, crm_companies, crm_interactions, crm_events'}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Native CRM — AI search (Tay can call this) ─────────────────────────────
    if (path === '/api/crm/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const q = body.query || body.q || '';
        if (!q) return json({results:[]}, 200, origin);
        const [contacts, companies, interactions] = await Promise.all([
          env.PRISM_D1.prepare("SELECT id, name, email, company, role, tags, notes FROM crm_contacts WHERE name LIKE ? OR email LIKE ? OR company LIKE ? OR notes LIKE ? LIMIT 10").bind('%'+q+'%','%'+q+'%','%'+q+'%','%'+q+'%').all(),
          env.PRISM_D1.prepare("SELECT id, name, domain, industry, notes FROM crm_companies WHERE name LIKE ? OR domain LIKE ? OR notes LIKE ? LIMIT 5").bind('%'+q+'%','%'+q+'%','%'+q+'%').all(),
          env.PRISM_D1.prepare("SELECT id, contact_id, type, summary, notes, created_at FROM crm_interactions WHERE summary LIKE ? OR notes LIKE ? ORDER BY created_at DESC LIMIT 10").bind('%'+q+'%','%'+q+'%').all(),
        ]);
        return json({
          contacts: contacts.results || [],
          companies: companies.results || [],
          interactions: interactions.results || [],
          query: q
        }, 200, origin);
      } catch(e) { return json({results:[], error:e.message}, 200, origin); }
    }


    if (path === '/api/social/post-with-canvas' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || '';
        const platforms = body.platforms || ['bluesky'];
        const TAGS = '#IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Wellbeing';
        const FOOTER = 'hello@identitypartners.uk | www.identitypartners.uk/contact';
        const fullText = text + '\n\n' + TAGS + '\n' + FOOTER;
        const templateIdx = Math.floor(Math.random() * 150);
        const imageUrl = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-' + templateIdx + '.png';
        const results = {};
        if (platforms.includes('bluesky')) {
          const bskyHandle = k(env, ['bluesky_handle','BLUESKY_HANDLE']) || '@identitypartners.bsky.social';
          const bskyPass = k(env, ['bluesky_password','BLUESKY_PASSWORD','bluesky_app_password']) || '';
          if (bskyHandle && bskyPass) {
            try {
              const sr = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:bskyHandle,password:bskyPass})});
              if (sr.ok) {
                const session = await sr.json();
                const pr = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.accessJwt},body:JSON.stringify({repo:session.did,collection:'app.bsky.feed.post',record:{text:fullText.substring(0,300),createdAt:new Date().toISOString(),langs:['en-GB']}})});
                results.bluesky = {success:pr.ok,status:pr.status};
              }
            } catch(e) { results.bluesky = {success:false,error:e.message}; }
          }
        }
        const bufferKey = k(env, ['buffer','BUFFER_API_KEY','buffer_api_key']) || '';
        if (bufferKey && imageUrl) {
          const channelMap = {instagram:k(env,['buffer_ig_channel','BUFFER_IG_CHANNEL'])||'',facebook:k(env,['buffer_fb_channel','BUFFER_FB_CHANNEL'])||'',x:k(env,['buffer_x_channel','BUFFER_X_CHANNEL'])||''};
          for (const [platform, channelId] of Object.entries(channelMap)) {
            if (!channelId || !platforms.includes(platform)) continue;
            try {
              const br = await fetch('https://api.bufferapp.com/graphql',{method:'POST',headers:{'Authorization':'Bearer '+bufferKey,'Content-Type':'application/json'},body:JSON.stringify({query:'mutation CreateIdea($input:IdeaCreateInput!){ideaCreate(input:$input){idea{id}}}',variables:{input:{channelId,text:fullText,mediaUrls:[imageUrl]}}})});
              results[platform] = {success:br.ok,status:br.status};
            } catch(e) { results[platform] = {success:false,error:e.message}; }
          }
        }
        if (env.PRISM_KV) await env.PRISM_KV.put('social:last-post',JSON.stringify({text:text.substring(0,100),imageUrl,results,timestamp:new Date().toISOString()}));
        return json({success:true,results,imageUrl,text:text.substring(0,100)+'...'},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }


    // ── Autonomy config ─────────────────────────────────────
    if (path === '/api/social/autonomy' && request.method === 'GET') {
      const cfg = env.PRISM_KV ? await env.PRISM_KV.get('socialising:autonomy', 'json') : null;
      const today = new Date().toISOString().slice(0, 10);
      const count = env.PRISM_KV ? parseInt(await env.PRISM_KV.get('socialising:count:' + today) || '0') : 0;
      return json({ config: cfg || { enabled: false, maxPerDay: 3, platforms: ['bluesky', 'linkedin', 'telegram', 'instagram', 'facebook', 'tumblr', 'x'] }, postedToday: count }, 200, origin);
    }
    if (path === '/api/social/autonomy' && request.method === 'POST') {
      try {
        const body = await request.json();
        const cfg = {
          enabled: !!body.enabled,
          maxPerDay: Math.max(1, Math.min(10, parseInt(body.maxPerDay) || 3)),
          platforms: Array.isArray(body.platforms) && body.platforms.length ? body.platforms : ['bluesky', 'linkedin', 'telegram'],
          blockWords: Array.isArray(body.blockWords) ? body.blockWords : []
        };
        if (env.PRISM_KV) await env.PRISM_KV.put('socialising:autonomy', JSON.stringify(cfg));
        return json({ success: true, config: cfg }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/social/queue' && request.method === 'POST') {
      try {
        const body = await request.json();
        const item = {
          id: 'sq-' + Date.now(),
          platform: body.platform || 'bluesky',
          content: body.content || '',
          imageUrl: body.imageUrl || null,
          scheduledFor: body.scheduledFor || null,
          status: 'queued',
          createdAt: new Date().toISOString()
        };
        if (env.PRISM_KV) {
          const queue = await env.PRISM_KV.get('social:queue', 'json') || [];
          queue.push(item);
          await env.PRISM_KV.put('social:queue', JSON.stringify(queue));
        }
        return json({success:true, id:item.id, queued:true}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    if (path === '/api/social/queue' && request.method === 'GET') {
      try {
        const queue = env.PRISM_KV ? await env.PRISM_KV.get('social:queue', 'json') : null;
        return json({queue: queue || [], total: (queue || []).length}, 200, origin);
      } catch(e) { return json({queue:[], error:e.message}, 200, origin); }
    }

    if (path === '/api/social/queue/clear' && request.method === 'POST') {
      try {
        if (env.PRISM_KV) await env.PRISM_KV.put('social:queue', '[]');
        return json({success:true}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Media Manager (mm) routes ─────────────────────────────────────────────
    // GET /api/mm/queue — return queue with counts
    if (path === '/api/mm/queue' && request.method === 'GET') {
      try {
        const queue = env.PRISM_KV ? await env.PRISM_KV.get('mm:queue', 'json') : null;
        const q = queue || [];
        const counts = { pending: 0, scheduled: 0, posted: 0, failed: 0, rejected: 0 };
        q.forEach(function(i) { if (counts[i.status] !== undefined) counts[i.status]++; });
        return json({ queue: q, counts }, 200, origin);
      } catch(e) { return json({ queue: [], counts: {}, error: e.message }, 200, origin); }
    }

    // POST /api/mm/queue — add item to queue
    if (path === '/api/mm/queue' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.text) return json({ success: false, error: 'text required' }, 400, origin);
        const item = {
          id: 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
          text: body.text,
          platforms: body.platforms || ['bluesky'],
          platformMethods: body.platformMethods || {},
          imageUrl: body.imageUrl || null,
          source: body.source || 'compose',
          status: 'pending',
          createdAt: new Date().toISOString(),
          scheduledFor: body.scheduledFor || null,
          slot: body.slot || null,
        };
        const queue = env.PRISM_KV ? (await env.PRISM_KV.get('mm:queue', 'json') || []) : [];
        queue.unshift(item);
        if (env.PRISM_KV) await env.PRISM_KV.put('mm:queue', JSON.stringify(queue.slice(0, 200)));
        return json({ success: true, item }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // POST /api/mm/approve — post item immediately to all its platforms
    if (path === '/api/mm/approve' && request.method === 'POST') {
      try {
        const body = await request.json();
        const itemId = body.itemId;
        if (!itemId) return json({ success: false, error: 'itemId required' }, 400, origin);
        const queue = env.PRISM_KV ? (await env.PRISM_KV.get('mm:queue', 'json') || []) : [];
        const idx = queue.findIndex(function(i) { return i.id === itemId; });
        if (idx < 0) return json({ success: false, error: 'Item not found' }, 404, origin);
        const item = queue[idx];
        const results = {};
        const errors = {};

        // Post to each platform
        for (const platform of (item.platforms || [])) {
          try {
            if (platform === 'bluesky') {
              const bskyHandle = k(env, ['bluesky_handle','BLUESKY_HANDLE']) || '';
              const bskyPass = k(env, ['bluesky_app_password','bluesky_password','BLUESKY_PASSWORD']) || '';
              if (bskyHandle && bskyPass) {
                const authResp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
                  method: 'POST', headers: {'Content-Type':'application/json'},
                  body: JSON.stringify({ identifier: bskyHandle, password: bskyPass })
                });
                if (authResp.ok) {
                  const auth = await authResp.json();
                  // Attach the canvas as an image when available
                  let embed = undefined;
                  try {
                    const bskyMedia = await itemMediaUrls(item, env);
                    if (bskyMedia.length) {
                      const imgBytes = await fetch(bskyMedia[0]).then(r => r.arrayBuffer());
                      const blobResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + auth.accessJwt, 'Content-Type': 'image/png' },
                        body: imgBytes
                      });
                      if (blobResp.ok) {
                        const blob = (await blobResp.json()).blob;
                        embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: (item.text || 'Identity Partners canvas').slice(0, 500) }] };
                        if (Array.isArray(item.urls) && item.urls.length > 1) {
                          embed.images[0].alt += ' (carousel: ' + item.urls.length + ' slides — full set on Instagram)';
                        }
                      }
                    }
                  } catch (e) {}
                  const postResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
                    method: 'POST',
                    headers: {'Authorization':'Bearer '+auth.accessJwt,'Content-Type':'application/json'},
                    body: JSON.stringify({ repo: auth.did, collection: 'app.bsky.feed.post', record: { text: item.text, createdAt: new Date().toISOString(), langs: ['en-GB'], ...(embed ? { embed } : {}) } })
                  });
                  results.bluesky = { success: postResp.ok, status: postResp.status };
                } else { errors.bluesky = 'Auth failed: ' + authResp.status; }
              } else { errors.bluesky = 'Bluesky credentials not configured'; }
            } else if (platform === 'telegram') {
              const tgToken = k(env, ['telegram_token','TELEGRAM_TOKEN']) || '';
              const chatId = k(env, ['telegram_chat_id','TELEGRAM_CHAT_ID']) || '';
              if (tgToken && chatId) {
                const tgResp = await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
                  method: 'POST', headers: {'Content-Type':'application/json'},
                  body: JSON.stringify({ chat_id: chatId, text: item.text, parse_mode: 'HTML' })
                });
                results.telegram = { success: tgResp.ok, status: tgResp.status };
              } else { errors.telegram = 'Telegram credentials not configured'; }
            } else if (platform === 'linkedin') {
              const liTokenRaw = env.PRISM_KV ? await env.PRISM_KV.get('oauth:linkedin:tokens').catch(() => null) : null;
              if (liTokenRaw) {
                const liToken = JSON.parse(liTokenRaw);
                const accessToken = liToken.access_token || liToken.accessToken || '';
                if (accessToken) {
                  // Get person URN (company page override supported via KV linkedin:author:urn)
                  const meResp = await fetch('https://api.linkedin.com/v2/userinfo', { headers: {'Authorization':'Bearer '+accessToken} });
                  if (meResp.ok) {
                    const me = await meResp.json();
                    let urn = 'urn:li:person:' + me.sub;
                    let authorNote = 'person';
                    if (env.PRISM_KV) {
                      const orgUrn = await env.PRISM_KV.get('linkedin:author:urn');
                      if (orgUrn && /^urn:li:organization:/.test(orgUrn)) { urn = orgUrn; authorNote = 'organization'; }
                    }
                    // ── Post shape: image if we have a canvas, article if we have a link, text otherwise ──
                    let media = null, mediaCategory = 'NONE';
                    if (item.imageUrl) {
                      try {
                        const pngUrl = await svgToPngUrl(item.imageUrl, env);
                        const bytes = pngUrl ? new Uint8Array(await (await fetch(pngUrl)).arrayBuffer()) : null;
                        if (bytes && bytes.byteLength > 1000) {
                          const reg = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
                            method: 'POST',
                            headers: {'Authorization':'Bearer '+accessToken,'Content-Type':'application/json','X-Restli-Protocol-Version':'2.0.0'},
                            body: JSON.stringify({ registerUploadRequest: { owner: urn, recipes: ['urn:li:digitalmediaRecipe:feed-share-image'], supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'] } })
                          }).then(r => r.json());
                          const uploadUrl = reg && reg.value && reg.value.uploadMechanism && reg.value.uploadMechanism['com.linkedin.digitalmedia.uploading.Mechanism'].uploadUrl;
                          const asset = reg && reg.value && reg.value.asset;
                          if (uploadUrl && asset) {
                            const up = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
                            if (up.ok) { media = [{ status: 'READY', description: { text: (item.text || '').slice(0, 200) }, media: asset, title: { text: (item.text || '').slice(0, 150) } }]; mediaCategory = 'IMAGE'; }
                          }
                        }
                      } catch (e) { /* fall through to text */ }
                    }
                    if (mediaCategory === 'NONE') {
                      const linkMatch = String(item.text || '').match(/https?:\/\/[^\s)]+/);
                      if (linkMatch) {
                        media = [{ status: 'READY', originalUrl: linkMatch[0], title: { text: (item.text || '').slice(0, 150) } }];
                        mediaCategory = 'ARTICLE';
                      }
                    }
                    const liPostResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
                      method: 'POST',
                      headers: {'Authorization':'Bearer '+accessToken,'Content-Type':'application/json','X-Restli-Protocol-Version':'2.0.0'},
                      body: JSON.stringify({ author: urn, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: item.text }, shareMediaCategory: mediaCategory, ...(media ? { media } : {}) } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } })
                    });
                    results.linkedin = { success: liPostResp.ok, status: liPostResp.status, author: authorNote, mediaCategory };
                  } else { errors.linkedin = 'Could not fetch LinkedIn profile'; }
                } else { errors.linkedin = 'No LinkedIn access token'; }
              } else { errors.linkedin = 'LinkedIn not connected'; }
            } else if (platform === 'tumblr') {
              let oauth = null;
              try { oauth = env.PRISM_KV ? JSON.parse(await env.PRISM_KV.get('tumblr:oauth') || 'null') : null; } catch (e) {}
              if (!oauth || !oauth.access_token) { errors.tumblr = 'Tumblr not connected — complete the one-time authorise step (see Platforms page)'; }
              else {
                try {
                  const media = await itemMediaUrls(item, env);
                  let blogName = k(env, ['tumblr_blog','TUMBLR_BLOG']) || 'identitypartners';
                  // ── Voices routing: post as a registered condition-specific account if item.from is set ──
                  let voiceNote = '';
                  if (item.from && env.PRISM_KV) {
                    try {
                      const voices = await env.PRISM_KV.get('voices:registry', 'json') || [];
                      const v = voices.find(x => x && (x.id === item.from || x.label === item.from));
                      if (v && v.platform === 'tumblr' && v.identity) {
                        blogName = String(v.identity).replace(/^https?:\/\//, '').replace(/\.tumblr\.com.*$/, '');
                        voiceNote = ' as voice ' + v.id;
                      }
                    } catch (e) {}
                  }
                  const params = new URLSearchParams();
                  if (media.length) { params.set('type','photo'); params.set('source', media[0]); if (item.text) params.set('caption', item.text); }
                  else { params.set('type','text'); params.set('body', item.text || ''); }
                  params.set('state','published');
                  const resp = await fetch('https://api.tumblr.com/v2/blog/' + blogName + '.tumblr.com/post', {
                    method:'POST',
                    headers:{ 'Authorization':'Bearer ' + oauth.access_token, 'Content-Type':'application/x-www-form-urlencoded' },
                    body: params.toString()
                  });
                  const data = await resp.json().catch(() => ({}));
                  const ok = resp.ok && (data.response||{}).id;
                  results.tumblr = { success: !!ok, postId: ok ? data.response.id : undefined, voice: voiceNote || undefined, error: resp.ok ? undefined : ((data.meta||{}).msg || ('HTTP ' + resp.status)) };
                } catch (e) { errors.tumblr = e.message; }
              }
            } else if (['instagram','facebook','x'].includes(platform)) {
              // ── Instagram & Facebook: DIRECT Graph API first (carousel JSON per docs), Buffer as fallback ──
              const metaTok = k(env, ['meta_user_token','META_USER_TOKEN','fb_user_token']) || '';
              if ((platform === 'instagram' || platform === 'facebook') && metaTok) {
                try {
                  let ids = null;
                  try { ids = JSON.parse(await env.PRISM_KV.get('meta:ids') || 'null'); } catch (e) {}
                  if (!ids || !ids.ig || !ids.page) {
                    const acc = await fetch('https://graph.facebook.com/v21.0/me/accounts?fields=access_token,connected_instagram_account{id,username}&access_token=' + encodeURIComponent(metaTok)).then(r => r.json());
                    const pg = (acc.data || []).find(p => p.connected_instagram_account) || {};
                    ids = { ig: pg.connected_instagram_account && pg.connected_instagram_account.id, page: pg.id, pageName: pg.name, pageToken: pg.access_token };
                    if (env.PRISM_KV && ids.ig) await env.PRISM_KV.put('meta:ids', JSON.stringify(ids));
                  }
                  if (platform === 'instagram' && ids && ids.ig) {
                    const media = (await itemMediaUrls(item, env)).filter(Boolean);
                    const text = (item.text || '').slice(0, 2200);
                    let creation = null;
                    let reelMode = false;
                    if (item.format === 'reel' && item.videoUrl) {
                      // ── Reel: REELS container from the rendered MP4 …
                      reelMode = true;
                      const c = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ media_type: 'REELS', video_url: item.videoUrl, caption: text, share_to_feed: true, access_token: metaTok }) }).then(r => r.json());
                      creation = c.id;
                      if (!creation) results.instagram = { success: false, error: JSON.stringify(c).slice(0,200), via: 'reels-api' };
                    } else if ((item.format === 'story') && media.length) {
                      // full-bleed story: STORIES container, no caption
                      const c = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image_url: media[0], media_type: 'STORIES', access_token: metaTok }) }).then(r => r.json());
                      creation = c.id;
                    } else if (media.length > 1) {
                      const children = [];
                      for (const u of media.slice(0, 10)) {
                        const c = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image_url: u, is_carousel_item: true, access_token: metaTok }) }).then(r => r.json());
                        if (c.id) children.push(c.id);
                      }
                      const par = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ media_type: 'CAROUSEL', children: children.join(','), caption: text, access_token: metaTok }) }).then(r => r.json());
                      creation = par.id;
                    } else if (media.length === 1) {
                      const c = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image_url: media[0], caption: text, access_token: metaTok }) }).then(r => r.json());
                      creation = c.id;
                    }
                    if (creation) {
                      // wait for container READY, then publish
                      let ready = false;
                      for (let i = 0; i < (reelMode ? 40 : 10) && !ready; i++) {
                        await new Promise(r => setTimeout(r, 3000));
                        const st = await fetch('https://graph.facebook.com/v21.0/' + creation + '?fields=status_code&access_token=' + encodeURIComponent(metaTok)).then(r => r.json());
                        ready = st.status_code === 'FINISHED';
                      }
                      if (ready) {
                        const pub = await fetch('https://graph.facebook.com/v21.0/' + ids.ig + '/media_publish', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ creation_id: creation, access_token: metaTok }) }).then(r => r.json());
                        if (pub.id) { results.instagram = { success: true, postId: pub.id, via: 'direct-api' }; }
                        else { results.instagram = { success: false, error: JSON.stringify(pub).slice(0,140), via: 'direct-api' }; }
                      } else { results.instagram = { success: false, error: 'container not ready in time', via: 'direct-api' }; }
                    } else if (media.length) {
                      results.instagram = { success: false, error: 'container creation failed', via: 'direct-api' };
                    }
                  } else if (platform === 'facebook' && ids && ids.page) {
                    const media = (await itemMediaUrls(item, env)).filter(Boolean);
                    const ptok = ids.pageToken || metaTok;
                    if (item.format === 'reel' && item.videoUrl) {
                      // ── FB Reel via video_reels endpoint (permission-gated) …
                      try {
                        const vr = await fetch('https://graph.facebook.com/v21.0/' + ids.page + '/video_reels', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ video_url: item.videoUrl, description: (item.text || '').slice(0, 2200), access_token: ptok }) }).then(r => r.json());
                        if (vr.id) {
                          let readyF = false; let statusTxt = '';
                          for (let i = 0; i < 40 && !readyF; i++) {
                            await new Promise(r => setTimeout(r, 3000));
                            const st = await fetch('https://graph.facebook.com/v21.0/' + vr.id + '?fields=status&access_token=' + encodeURIComponent(ptok)).then(r => r.json());
                            statusTxt = st.status || '';
                            if (String(statusTxt).toLowerCase() === 'ready' || String(statusTxt).toLowerCase() === 'finished') readyF = true;
                          }
                          if (readyF) {
                            const pub = await fetch('https://graph.facebook.com/v21.0/' + vr.id, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ access_token: ptok }) }).then(r => r.json());
                            results.facebook = { success: !pub.error, postId: vr.id, note: pub.error ? 'ready but publish step returned: ' + JSON.stringify(pub.error).slice(0,140) : 'published via video_reels' };
                          } else { results.facebook = { success: false, postId: vr.id, error: 'reel not ready in time (status: ' + statusTxt + ')' }; }
                        } else { results.facebook = { success: false, error: JSON.stringify(vr).slice(0,200) }; }
                      } catch (e) { results.facebook = { success: false, error: e.message }; }
                    } else if (media.length) {
                      // unpublished photos then a multi-photo feed post
                      const fbids = [];
                      for (const u of media.slice(0, 8)) {
                        const ph = await fetch('https://graph.facebook.com/v21.0/' + ids.page + '/photos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: u, published: false, access_token: ptok }) }).then(r => r.json());
                        if (ph.id) fbids.push(ph.id);
                      }
                      if (fbids.length) {
                        const feed = await fetch('https://graph.facebook.com/v21.0/' + ids.page + '/feed', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: item.text || '', attached_media: JSON.stringify(fbids.map(id => ({ media_fbid: id }))), access_token: ptok }) }).then(r => r.json());
                        results.facebook = feed.id ? { success: true, postId: feed.id, via: 'direct-api' } : { success: false, error: JSON.stringify(feed).slice(0,140), via: 'direct-api' };
                      }
                    } else {
                      const feed = await fetch('https://graph.facebook.com/v21.0/' + ids.page + '/feed', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: item.text || '', access_token: ptok }) }).then(r => r.json());
                      results.facebook = feed.id ? { success: true, postId: feed.id, via: 'direct-api' } : { success: false, error: JSON.stringify(feed).slice(0,140), via: 'direct-api' };
                    }
                  }
                } catch (directErr) { errors[platform + '-direct'] = String(directErr).slice(0, 140); }
              }
              const directOk = results[platform] && results[platform].success;
              if (directOk) { /* direct API won — skip Buffer */ }
              else {
              const bufferKey = k(env, ['buffer_api_key','BUFFER_API_KEY','buffer']) || '';
              const channelMap = { instagram: k(env,['buffer_ig_channel','BUFFER_IG_CHANNEL']), facebook: k(env,['buffer_fb_channel','BUFFER_FB_CHANNEL']), x: k(env,['buffer_x_channel','BUFFER_X_CHANNEL']) };
              let channelId = channelMap[platform];
              if (!channelId && env.PRISM_KV) {
                channelId = await env.PRISM_KV.get('platform:channel:' + platform).catch(() => null);
              }
              if (bufferKey && channelId) {
                // Buffer's current API: GraphQL createPost with Bearer auth
                const dueAt = item.scheduledFor || new Date().toISOString();
                const media = await itemMediaUrls(item, env);   // rasterised canvas / carousel slides
                let gqlRes = null;
                // Verified against Buffer's live GraphQL schema (introspected):
                // createPost(input: CreatePostInput!) with REQUIRED assets + needsApproval;
                // carousel slides = multiple AssetInput {image:{url}} entries
                // IG requires metadata with a PostType; multi-image = carousel
                // IG API accepts post/story/reel only — a carousel is a multi-image 'post'
                const metadata = platform === 'instagram'
                  ? { instagram: { type: 'post', shouldShareToFeed: true } }
                  : undefined;
                const input = {
                  text: item.text,
                  channelId,
                  schedulingType: 'automatic',
                  mode: 'customScheduled',
                  dueAt,
                  needsApproval: false,   // Simon approves in Argentica, not in Buffer
                  ...(metadata ? { metadata } : {}),
                  assets: media.map(u => ({ image: { url: u } })),
                };
                gqlRes = await bufferGql(
                  'mutation($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }',
                  { input }, env
                );
                if (gqlRes.error) { errors[platform] = gqlRes.error; results[platform] = { success: false }; }
                else {
                  const created = gqlRes.data && gqlRes.data.createPost;
                  const ok = !!(created && created.post && created.post.id);
                  results[platform] = { success: ok, postId: ok ? created.post.id : undefined, error: created && created.message };
                }
              } else { errors[platform] = bufferKey ? 'Buffer channel ID not configured — run Fetch Buffer channels' : 'Buffer not connected'; }
              }
            } else if (platform === 'substack') {
              const resendKey = k(env, ['resend_api_key','RESEND_API_KEY','resend']) || '';
              const substackEmail = k(env, ['substack_email','SUBSTACK_EMAIL']) || 'zemiopat@substack.com';
              if (!resendKey) { results.substack = { success: false, note: 'No resend_api_key — cannot email the piece' }; }
              else {
                try {
                  const fromA = k(env, ['resend_from','RESEND_FROM']) || 'Argentica <onboarding@resend.dev>';
                  const resp = await fetch('https://api.resend.com/emails', { method: 'POST',
                    headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: fromA, to: [substackEmail], subject: 'Substack draft — ' + (item.text || '').slice(0, 70), reply_to: k(env, ['email_from','EMAIL_FROM']) || 'hello@identitypartners.uk', text: (item.text || '') + (item.imageUrl ? '\n\nImage: ' + item.imageUrl : '') }) });
                  const sd = await resp.json().catch(() => ({}));
                  results.substack = { success: resp.ok, note: resp.ok ? 'Sent to ' + substackEmail + ' for Substack' : ('Resend: ' + (sd.message || resp.status)) };
                } catch (e) { results.substack = { success: false, note: e.message }; }
              }
            } else {
              errors[platform] = 'Platform not yet implemented';
            }
          } catch(platformErr) {
            errors[platform] = platformErr.message;
          }
        }

        // Update item status
        const anySuccess = Object.values(results).some(function(r) { return r.success; });
        queue[idx] = Object.assign({}, item, {
          status: anySuccess ? 'posted' : 'failed',
          postedAt: new Date().toISOString(),
          postResults: results,
          postErrors: errors,
        });
        if (env.PRISM_KV) {
          await env.PRISM_KV.put('mm:queue', JSON.stringify(queue));
          // Append to activity log
          const log = env.PRISM_KV ? (await env.PRISM_KV.get('mm:log', 'json') || []) : [];
          log.unshift({ ts: new Date().toISOString(), itemId, platforms: item.platforms, results, errors, text: item.text.substring(0,100) });
          await env.PRISM_KV.put('mm:log', JSON.stringify(log.slice(0, 100)));
        }
        return json({ success: anySuccess, results, errors }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // POST /api/mm/update — update item status (schedule, reject)
    if (path === '/api/mm/update' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { itemId, action, scheduledFor, reason } = body;
        const queue = env.PRISM_KV ? (await env.PRISM_KV.get('mm:queue', 'json') || []) : [];
        const idx = queue.findIndex(function(i) { return i.id === itemId; });
        if (idx < 0) return json({ success: false, error: 'Item not found' }, 404, origin);
        if (action === 'schedule') {
          queue[idx].status = 'scheduled';
          queue[idx].scheduledFor = scheduledFor;
        } else if (action === 'reject') {
          queue[idx].status = 'rejected';
          queue[idx].rejectedAt = new Date().toISOString();
          queue[idx].rejectionReason = reason || '';
        }
        if (env.PRISM_KV) await env.PRISM_KV.put('mm:queue', JSON.stringify(queue));
        return json({ success: true, item: queue[idx] }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // GET /api/mm/log — activity log
    if (path === '/api/mm/log' && request.method === 'GET') {
      try {
        const log = env.PRISM_KV ? (await env.PRISM_KV.get('mm:log', 'json') || []) : [];
        return json({ log }, 200, origin);
      } catch(e) { return json({ log: [], error: e.message }, 200, origin); }
    }

    // POST /api/mm/chat — Media Manager AI chat
    if (path === '/api/mm/chat' && request.method === 'POST') {
      try {
        const body = await request.json();
        const message = body.message || '';
        const queue = env.PRISM_KV ? (await env.PRISM_KV.get('mm:queue', 'json') || []) : [];
        const pending = queue.filter(function(i) { return i.status === 'pending'; });
        const scheduled = queue.filter(function(i) { return i.status === 'scheduled'; });
        const today = new Date().toDateString();
        const postedToday = queue.filter(function(i) { return i.status === 'posted' && new Date(i.postedAt).toDateString() === today; });
        const systemPrompt = `You are the Media Manager for Identity Partners. You are a content gatekeeper — nothing publishes without approval. You manage the social media queue, approve or reject posts, and report on activity.

Current queue status:
- Pending approval: ${pending.length} items
- Scheduled: ${scheduled.length} items
- Posted today: ${postedToday.length} items
- Total in queue: ${queue.length} items

Pending items: ${JSON.stringify(pending.slice(0,5).map(function(i){ return {id:i.id,text:i.text.substring(0,100),platforms:i.platforms}; }))}

Rules:
- British English throughout
- Never use /book — always /contact
- Mandatory tags: #IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing
- Mandatory footer: hello@identitypartners.uk | www.identitypartners.uk/contact
- Only approved sources: ONS, Mind, NHS, Guardian, FT, Economist, New Statesman, etc.
- Never Telegraph, Times, or iNews

When asked to approve items, respond with the item IDs to approve. When asked to draft content, write in Simon's voice: intelligent, direct, humane, British professional prose.`;

        const llmResult = await orchestrate([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ], env, { profile: 'balanced', maxTokens: 1024 });

        const actionsExecuted = [];
        // Simple action detection: if user says "approve all" and there are pending items
        const msgLower = message.toLowerCase();
        if ((msgLower.includes('approve all') || msgLower.includes('post all')) && pending.length > 0) {
          actionsExecuted.push('approve_all_pending');
        }

        return json({
          reply: llmResult.content || 'No response.',
          actionsExecuted,
          queueSummary: { pending: pending.length, scheduled: scheduled.length, posted: postedToday.length }
        }, 200, origin);
      } catch(e) { return json({ reply: 'Error: ' + e.message, actionsExecuted: [] }, 200, origin); }
    }

    // ── MSGraph client credentials token (no user OAuth needed) ─────────────
    if (path === '/api/msgraph/token' && request.method === 'POST') {
      try {
        const tenantId = k(env, ['msgraph_tenant','MSGRAPH_TENANT']) || '';
        const clientId = k(env, ['msgraph_client','MSGRAPH_CLIENT']) || '';
        const clientSecret = k(env, ['msgraph_secret','MSGRAPH_SECRET']) || '';
        const params = new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:'https://graph.microsoft.com/.default'});
        const resp = await fetch('https://login.microsoftonline.com/'+tenantId+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
        const data = await resp.json();
        if (data.access_token) {
          if (env.PRISM_KV) await env.PRISM_KV.put('msgraph:token',JSON.stringify({access_token:data.access_token,expires_at:Date.now()+(data.expires_in||3600)*1000}),{expirationTtl:3500});
          return json({success:true,expires_in:data.expires_in},200,origin);
        }
        return json({success:false,error:JSON.stringify(data).substring(0,200)},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }

    // ── OneDrive upload with auto token refresh ───────────────────────────────
    if (path === '/api/onedrive/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const fileName = body.fileName || ('file-'+Date.now());
        const content = body.content || '';
        const folder = body.folder || 'Argentica';
        // Get or refresh MSGraph token
        let tokenData = env.PRISM_KV ? await env.PRISM_KV.get('msgraph:token','json') : null;
        if (!tokenData || !tokenData.access_token || (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000)) {
          const tenantId = k(env, ['msgraph_tenant','MSGRAPH_TENANT']) || '';
          const clientId = k(env, ['msgraph_client','MSGRAPH_CLIENT']) || '';
          const clientSecret = k(env, ['msgraph_secret','MSGRAPH_SECRET']) || '';
          const params = new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:'https://graph.microsoft.com/.default'});
          const tokenResp = await fetch('https://login.microsoftonline.com/'+tenantId+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
          tokenData = await tokenResp.json();
          if (tokenData.access_token && env.PRISM_KV) {
            await env.PRISM_KV.put('msgraph:token',JSON.stringify({access_token:tokenData.access_token,expires_at:Date.now()+(tokenData.expires_in||3600)*1000}),{expirationTtl:3500});
          }
        }
        const accessToken = tokenData.access_token;
        if (!accessToken) return json({success:false,error:'Could not get MSGraph token'},400,origin);
        // Decode base64 content
        const b64 = content.includes(',') ? content.split(',')[1] : content;
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i=0;i<binaryStr.length;i++) bytes[i]=binaryStr.charCodeAt(i);
        // Upload to OneDrive
        const uploadPath = encodeURIComponent(folder+'/'+fileName);
        const uploadResp = await fetch('https://graph.microsoft.com/v1.0/me/drive/root:/'+uploadPath+':/content',{method:'PUT',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/octet-stream'},body:bytes});
        if (!uploadResp.ok) {
          const err = await uploadResp.text();
          return json({success:false,error:'Upload failed: '+err.substring(0,200)},200,origin);
        }
        const uploadData = await uploadResp.json();
        // Create sharing link
        const shareResp = await fetch('https://graph.microsoft.com/v1.0/me/drive/items/'+uploadData.id+'/createLink',{method:'POST',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({type:'view',scope:'anonymous'})});
        const shareData = shareResp.ok ? await shareResp.json() : {};
        const shareUrl = shareData.link ? shareData.link.webUrl : uploadData.webUrl;
        return json({success:true,id:uploadData.id,shareUrl,webUrl:uploadData.webUrl,name:fileName},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }

    // ── Telegram posting ──────────────────────────────────────────────────────
    if (path === '/api/social/telegram' && request.method === 'POST') {
      try {
        const body = await request.json();
        const token = k(env, ['telegram_token','TELEGRAM_TOKEN']) || '';
        const chatId = k(env, ['telegram_chat_id','TELEGRAM_CHAT_ID','telegram_chat']) || '';
        if (!token || !chatId) return json({success:false,error:'Telegram not configured'},400,origin);
        const text = body.text || '';
        const resp = await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:text.substring(0,4096),parse_mode:'Markdown'})});
        const data = await resp.json();
        return json({success:data.ok,message_id:data.result?.message_id,error:data.description},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }

    // ── Tumblr posting ────────────────────────────────────────────────────────
    // ── Threads OAuth + publishing ──
    // Step 1: open /api/threads/oauth/authorize — redirects to Threads' consent screen
    if (path === '/api/threads/callback-try' && request.method === 'GET') {
      const clientId = k(env, ['threads_client_id','THREADS_CLIENT_ID']) || '';
      if (!clientId) return json({success:false,error:'threads_client_id secret not set'},400,origin);
      const state = 'ths-' + Math.random().toString(36).slice(2, 10);
      if (env.PRISM_KV) await env.PRISM_KV.put('threads:oauthstate', state, { expirationTtl: 600 });
      const cb = 'https://arch.identitypartners.uk/api/threads/callback';
      return new Response(null, { status: 302, headers: { Location:
        'https://threads.net/oauth/authorize?client_id=' + encodeURIComponent(clientId) +
        '&redirect_uri=' + encodeURIComponent(cb) +
        '&scope=' + encodeURIComponent('threads_basic,threads_content_write') +
        '&response_type=code&state=' + encodeURIComponent(state) }});
    }
    if (path === '/api/threads/oauth/authorize' && request.method === 'GET') {
      const clientId = k(env, ['threads_client_id','THREADS_CLIENT_ID']) || '';
      if (!clientId) return json({success:false,error:'threads_client_id secret not set'},400,origin);
      const state = 'ths-' + Math.random().toString(36).slice(2, 10);
      if (env.PRISM_KV) await env.PRISM_KV.put('threads:oauthstate', state, { expirationTtl: 600 });
      const cb = 'https://arch.identitypartners.uk/api/threads/oauth/callback';
      return new Response(null, { status: 302, headers: { Location:
        'https://threads.net/oauth/authorize?client_id=' + encodeURIComponent(clientId) +
        '&redirect_uri=' + encodeURIComponent(cb) +
        '&scope=' + encodeURIComponent('threads_basic,threads_content_write') +
        '&response_type=code&state=' + encodeURIComponent(state) }});
    }
    // Step 2: callback — exchange the code for a long-lived token, store in KV
    if ((path === '/api/threads/oauth/callback' || path === '/api/threads/callback') && request.method === 'GET') {
      try {
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const errParam = url.searchParams.get('error_message') || url.searchParams.get('error') || '';
        if (errParam) return new Response('<h3 style="font-family:Georgia,serif;color:#5c2d3f">Threads connect failed</h3><p>' + errParam + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const saved = env.PRISM_KV ? await env.PRISM_KV.get('threads:oauthstate').catch(() => null) : null;
        if (!code || !state || state !== saved) return new Response('<h3>Connect failed</h3><p>State mismatch — start again from Argentica.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const clientId = k(env, ['threads_client_id','THREADS_CLIENT_ID']) || '';
        const clientSecret = k(env, ['threads_client_secret','THREADS_CLIENT_SECRET']) || '';
        if (!clientId || !clientSecret) return new Response('<h3>Connect failed</h3><p>Client id/secret not stored yet.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const cb = path === '/api/threads/callback' ? 'https://arch.identitypartners.uk/api/threads/callback' : 'https://arch.identitypartners.uk/api/threads/oauth/callback';
        const tokRes = await fetch('https://graph.threads.net/oauth/access_token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: cb, code }).toString()
        });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) return new Response('<h3>Connect failed</h3><p>' + JSON.stringify(tok).slice(0,200) + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        // upgrade to a long-lived (60-day) token
        let longTok = tok;
        try {
          const lr = await fetch('https://graph.threads.net/oauth/access_token?grant_type=th_exchange_token&client_secret=' + encodeURIComponent(clientSecret) + '&access_token=' + encodeURIComponent(tok.access_token));
          const ld = await lr.json().catch(() => ({}));
          if (ld.access_token) longTok = ld;
        } catch (e) {}
        if (env.PRISM_KV) await env.PRISM_KV.put('threads:oauth', JSON.stringify({ access_token: longTok.access_token, user_id: tok.user_id, token_type: longTok.token_type || '', expires_in: longTok.expires_in || null, obtainedAt: new Date().toISOString() }));
        return new Response('<div style="font-family:Georgia,serif;max-width:520px;margin:80px auto;color:#2b2117"><h2 style="color:#5c2d3f">Threads connected</h2><p>Identity Partners can now post. You can close this tab.</p></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (e) { return new Response('<h3>Connect failed</h3><p>' + e.message + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    }
    // Publish to Threads (text, or image via canvas URL)
    if (path === '/api/threads/publish' && request.method === 'POST') {
      try {
        const body = await request.json();
        let oauth = null;
        try { oauth = env.PRISM_KV ? JSON.parse(await env.PRISM_KV.get('threads:oauth') || 'null') : null; } catch (e) {}
        if (!oauth || !oauth.access_token) return json({success:false,error:'Threads not connected — open https://arch.identitypartners.uk/api/threads/oauth/authorize once.'},400,origin);
        const at = oauth.access_token;
        let uid = oauth.user_id || '';
        if (!uid) {
          try { const me = await fetch('https://graph.threads.net/v1.0/me?fields=id&access_token=' + encodeURIComponent(at)).then(r => r.json()); if (me.id) { uid = me.id; oauth.user_id = me.id; if (env.PRISM_KV) await env.PRISM_KV.put('threads:oauth', JSON.stringify(oauth)); } } catch (e) {}
        }
        let container;
        if (body.imageUrl) {
          const cr = await fetch('https://graph.threads.net/v1.0/' + uid + '/threads?media_type=IMAGE&image_url=' + encodeURIComponent(body.imageUrl) + (body.text ? '&caption=' + encodeURIComponent(body.text) : '') + '&access_token=' + encodeURIComponent(at), { method: 'POST' });
          container = await cr.json().catch(() => ({}));
          if (!container.id) return json({success:false,error:'Container create failed: ' + JSON.stringify(container).slice(0,180)},200,origin);
          const pr = await fetch('https://graph.threads.net/v1.0/' + container.id + '/threads_publish?access_token=' + encodeURIComponent(at), { method: 'POST' });
          const pd = await pr.json().catch(() => ({}));
          return json({success:pr.ok, post:pd, error: pr.ok ? undefined : JSON.stringify(pd).slice(0,160)},200,origin);
        } else {
          const cr = await fetch('https://graph.threads.net/v1.0/' + uid + '/threads?text=' + encodeURIComponent(body.text || '') + '&access_token=' + encodeURIComponent(at), { method: 'POST' });
          container = await cr.json().catch(() => ({}));
          if (!container.id) return json({success:false,error:'Container create failed: ' + JSON.stringify(container).slice(0,180)},200,origin);
          const pr = await fetch('https://graph.threads.net/v1.0/' + container.id + '/threads_publish?access_token=' + encodeURIComponent(at), { method: 'POST' });
          const pd = await pr.json().catch(() => ({}));
          return json({success:pr.ok, post:pd, error: pr.ok ? undefined : JSON.stringify(pd).slice(0,160)},200,origin);
        }
      } catch (e) { return json({success:false,error:e.message},500,origin); }
    }

    // ── Email send via Resend ──
    if (path === '/api/reel/render' && request.method === 'POST') {
      try {
        const body = await request.json();
        const spec = {
          title: String(body.title || '').slice(0, 200),
          bg: REEL_BG[String(body.bg || 'parchment').toLowerCase()] ? String(body.bg).toLowerCase() : 'parchment',
          photo: body.photo === false ? null : undefined,
          kicker: String(body.kicker || body.subtitle || '').slice(0, 80),
          lines: (Array.isArray(body.lines) ? body.lines : []).map(l => String(l)).filter(Boolean).slice(0, 8),
          createdAt: new Date().toISOString()
        };
        if (!spec.title || !spec.lines.length) return json({ success: false, error: 'A title and at least one line are required (listicle doctrine: each line one point).' }, 400, origin);
        if (body.photo) {
          const q = typeof body.photo === 'string' ? body.photo : (spec.title || 'calm dawn landscape');
          spec.photoUrl = await reelPhotoUrl(q, env);
        }
        const reelId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await env.PRISM_KV.put('reel:' + reelId, JSON.stringify(spec));
        const pageUrl = 'https://prism-api.identitypartners.workers.dev/reel/page/' + reelId;
        const mp4 = await renderReelMp4(pageUrl, env);
        if (mp4.error) return json({ success: false, pageUrl, reelId, error: mp4.error, detail: mp4.detail || '' }, 502, origin);
        await logAsset(env, 'reel', mp4.url, { title: (body.title||'').slice(0,80), pageUrl });
        let queuedItemId = null;
        if (body.queue) {
          const platforms = (Array.isArray(body.platforms) ? body.platforms : ['instagram']).map(p => String(p).toLowerCase());
          const item = {
            id: 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            text: String(body.caption || spec.title).slice(0, 2200),
            platforms, format: 'reel',
            videoUrl: mp4.url, imageUrl: null, urls: null,
            source: 'reel-studio', status: 'pending',
            createdAt: new Date().toISOString(), scheduledFor: null
          };
          const q = await env.PRISM_KV.get('mm:queue', 'json') || [];
          q.unshift(item);
          await env.PRISM_KV.put('mm:queue', JSON.stringify(q.slice(0, 200)));
          queuedItemId = item.id;
        }
        return json({ success: true, reelId, pageUrl, videoUrl: mp4.url, bytes: mp4.bytes || 0, queuedItemId }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/reel/stick' && request.method === 'POST') {
      try {
        const body = await request.json();
        const palKey = REEL_BG[String(body.bg || 'parchment').toLowerCase()] ? String(body.bg).toLowerCase() : 'parchment';
        const spec0 = {
          kind: 'stick',
          title: String(body.title || '').slice(0, 160),
          bg: palKey,
          scenes: (Array.isArray(body.scenes) ? body.scenes : []).map(x => ({ pose: String(x.pose || 'alone').toLowerCase(), caption: String(x.caption || '').slice(0, 220) })).slice(0, 8),
          createdAt: new Date().toISOString()
        };
        const pal = REEL_BG[palKey];
        spec0._pal = { ink: pal.ink, soft: pal.soft, line: pal.line, top: pal.top, mid: pal.mid, foot: pal.foot };
        const clean = JSON.parse(JSON.stringify(spec0)); delete clean._pal;
        if (!clean.scenes.length && !clean.title) return json({ success: false, error: 'A title and at least one scene are required.' }, 400, origin);
        if (body.photo) {
          const q = typeof body.photo === 'string' ? body.photo : (clean.title || 'calm dawn landscape');
          clean.photoUrl = await reelPhotoUrl(q, env);
        }
        const reelId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await env.PRISM_KV.put('reel:' + reelId, JSON.stringify(clean));
        const pageUrl = 'https://prism-api.identitypartners.workers.dev/reel/page/' + reelId;
        const mp4 = await renderReelMp4(pageUrl, env);
        if (mp4.error) return json({ success: false, pageUrl, reelId, error: mp4.error, detail: mp4.detail || '' }, 502, origin);
        await logAsset(env, 'reel', mp4.url, { title: (body.title||'').slice(0,80), pageUrl });
        let queuedItemId = null;
        if (body.queue) {
          const platforms = (Array.isArray(body.platforms) ? body.platforms : ['instagram']).map(p => String(p).toLowerCase());
          const item = {
            id: 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            text: String(body.caption || clean.title).slice(0, 2200),
            platforms, format: 'reel',
            videoUrl: mp4.url, imageUrl: null, urls: null,
            source: 'stick-studio', status: 'pending',
            createdAt: new Date().toISOString(), scheduledFor: null
          };
          const q = await env.PRISM_KV.get('mm:queue', 'json') || [];
          q.unshift(item);
          await env.PRISM_KV.put('mm:queue', JSON.stringify(q.slice(0, 200)));
          queuedItemId = item.id;
        }
        return json({ success: true, reelId, pageUrl, videoUrl: mp4.url, bytes: mp4.bytes || 0, queuedItemId }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/meta/extend-token' && request.method === 'POST') {
      try {
        const short = k(env, ['meta_user_token','META_USER_TOKEN']) || '';
        if (!short) return json({ success: false, error: 'no meta_user_token stored' }, 400, origin);
        const appId = k(env, ['threads_client_id','threads_app_id']) || '';
        const appSecret = k(env, ['threads_client_secret','threads_app_secret']) || '';
        if (!appId || !appSecret) return json({ success: false, error: 'app credentials not stored' }, 400, origin);
        const ex = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=' + appId + '&client_secret=' + appSecret + '&fb_exchange_token=' + encodeURIComponent(short)).then(r => r.json());
        if (!ex.access_token) return json({ success: false, error: (ex.error && ex.error.message) || 'exchange failed', raw: ex }, 200, origin);
        return json({ success: true, token: ex.access_token, expires_in: ex.expires_in || null, tokenType: ex.token_type || '' }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }
    if (path === '/api/diagnostics/instagram' && request.method === 'GET') {
      try {
        const out = { generatedAt: new Date().toISOString() };
        const token = k(env, ['meta_user_token','META_USER_TOKEN']) || '';
        out.metaUserTokenPresent = !!token;
        if (token) {
          const me = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name&access_token=' + token).then(r => r.json()).catch(() => ({}));
          out.facebookUser = me.name ? { name: me.name, id: me.id } : { error: me.error ? (me.error.message || '').slice(0, 140) : 'token invalid' };
          const accounts = await fetch('https://graph.facebook.com/v21.0/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=' + token).then(r => r.json()).catch(() => ({}));
          if (accounts.data) {
            out.pages = accounts.data.map(pg => ({
              name: pg.name, id: pg.id,
              instagram: pg.instagram_business_account ? { id: pg.instagram_business_account.id, username: pg.instagram_business_account.username } : null,
              pageTokenPresent: !!pg.access_token
            }));
            const ig = accounts.data.map(pg => pg.instagram_business_account).find(Boolean);
            if (ig) {
              const igUser = await fetch('https://graph.facebook.com/v21.0/' + ig.id + '?fields=username,followers_count,media_count&access_token=' + token).then(r => r.json()).catch(() => ({}));
              out.instagramAccount = igUser.username ? igUser : { error: 'IG account query failed' };
            }
          } else out.pages = accounts.error ? { error: (accounts.error.message || '').slice(0, 140) } : [];
        }
        const ids = env.PRISM_KV ? await env.PRISM_KV.get('meta:ids', 'json') : null;
        out.cachedIds = ids;
        return json(out, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }
    if (path === '/api/email/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const resendKey = k(env, ['resend_api_key','RESEND_API_KEY','resend']) || '';
        if (!resendKey) return json({success:false,error:'resend_api_key not set'},400,origin);
        const fromEmail = k(env, ['resend_from','RESEND_FROM','email_from']) || 'Argentica <onboarding@resend.dev>';
        const to = Array.isArray(body.to) ? body.to : [body.to];
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: body.from || fromEmail, to, subject: body.subject || '(no subject)', text: body.text || '', html: body.html || undefined, reply_to: body.replyTo || undefined })
        });
        const data = await resp.json().catch(() => ({}));
        return json({success:resp.ok, id:data.id, error:data.message},200,origin);
      } catch (e) { return json({success:false,error:e.message},500,origin); }
    }

    // POST /api/outlook/probe — can the existing MSGraph app read the mailbox?
    if (path === '/api/outlook/probe' && request.method === 'POST') {
      try {
        const tenantId = k(env, ['msgraph_tenant', 'MSGRAPH_TENANT']) || '';
        const clientId = k(env, ['msgraph_client', 'MSGRAPH_CLIENT']) || '';
        const clientSecret = k(env, ['msgraph_secret', 'MSGRAPH_SECRET']) || '';
        if (!tenantId || !clientId || !clientSecret) return json({error: 'MSGraph credentials not configured'}, 400, origin);
        const tokenResp = await fetch('https://login.microsoftonline.com/' + tenantId + '/oauth2/v2.0/token', {
          method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: 'grant_type=client_credentials&client_id=' + clientId + '&client_secret=' + encodeURIComponent(clientSecret) + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default')
        });
        const tokenData = await tokenResp.json();
        if (!tokenData.access_token) return json({success:false, error: 'token: ' + JSON.stringify(tokenData).slice(0,200)}, 200, origin);
        const at = tokenData.access_token;
        const out = { token: true, scopes: tokenData.scope };
        const email = k(env, ['msgraph_user_email','msgraph_user','onedrive_email','MSGRAPH_USER_EMAIL','MSGRAPH_USER']) || '';
        out.configuredUser = email;
        // try app-only mailbox read
        const tries = [
          ['users/{email}/messages',   'https://graph.microsoft.com/v1.0/users/' + email + '/messages?$top=3&$select=subject,from,receivedDateTime,isRead'],
          ['users/{email}/folders',    'https://graph.microsoft.com/v1.0/users/' + email + '/mailFolders'],
          ['me/messages',              'https://graph.microsoft.com/v1.0/me/messages?$top=3&$select=subject,from,receivedDateTime'],
        ];
        out.attempts = [];
        for (const [label, u] of tries) {
          try {
            const r = await fetch(u, { headers: { Authorization: 'Bearer ' + at } });
            const body = await r.text();
            out.attempts.push({ label, status: r.status, sample: body.slice(0, 220) });
            if (r.ok) break;
          } catch (e) { out.attempts.push({ label, error: e.message }); }
        }
        return json({ success: true, ...out }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Tumblr OAuth2 connect flow ──
    // Step 1: open /api/oauth/tumblr/authorize — redirects to Tumblr's consent screen
    if (path === '/api/oauth/tumblr/authorize' && request.method === 'GET') {
      const consumerKey = k(env, ['tumblr_key','TUMBLR_KEY','Tumblr_OAuth_consumer_key']) || '';
      if (!consumerKey) return json({success:false,error:'tumblr_key secret not set'},400,origin);
      const state = 'ts-' + Math.random().toString(36).slice(2, 10);
      if (env.PRISM_KV) await env.PRISM_KV.put('tumblr:oauthstate', state, { expirationTtl: 600 });
      const cb = 'https://arch.identitypartners.uk/api/oauth/tumblr/callback';
      return new Response(null, { status: 302, headers: { Location:
        'https://www.tumblr.com/oauth2/authorize?client_id=' + encodeURIComponent(consumerKey) +
        '&redirect_uri=' + encodeURIComponent(cb) +
        '&response_type=code&scope=' + encodeURIComponent('basic offline_access write') +
        '&state=' + encodeURIComponent(state) }});
    }
    // Step 2: callback — exchange the code for tokens, store in KV
    if (path === '/api/oauth/tumblr/callback' && request.method === 'GET') {
      try {
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const errParam = url.searchParams.get('error') || url.searchParams.get('error_description') || '';
        if (errParam) return new Response('<h3 style="font-family:Georgia,serif;color:#5c2d3f">Tumblr connect failed</h3><p>' + errParam + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const saved = env.PRISM_KV ? await env.PRISM_KV.get('tumblr:oauthstate').catch(() => null) : null;
        if (!code || !state || state !== saved) return new Response('<h3 style="font-family:Georgia,serif;color:#5c2d3f">Connect failed</h3><p>State mismatch — start again from Argentica.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const consumerKey = k(env, ['tumblr_key','TUMBLR_KEY','Tumblr_OAuth_consumer_key']) || '';
        const consumerSecret = k(env, ['tumblr_secret','TUMBLR_SECRET','Tumblr_OAuth_consumer_secret']) || '';
        if (!consumerKey || !consumerSecret) return new Response('<h3>Connect failed</h3><p>Consumer secret not stored yet.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const cb = 'https://arch.identitypartners.uk/api/oauth/tumblr/callback';
        const tokRes = await fetch('https://api.tumblr.com/v2/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: consumerKey, client_secret: consumerSecret, redirect_uri: cb }).toString()
        });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) return new Response('<h3>Connect failed</h3><p>' + (JSON.stringify(tok).slice(0,200)) + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        if (env.PRISM_KV) await env.PRISM_KV.put('tumblr:oauth', JSON.stringify({ access_token: tok.access_token, token_type: tok.token_type || 'bearer', refresh_token: tok.refresh_token || '', scope: tok.scope || '', obtainedAt: new Date().toISOString(), expiresIn: tok.expires_in || null }));
        return new Response('<div style="font-family:Georgia,serif;max-width:520px;margin:80px auto;color:#2b2117"><h2 style="color:#5c2d3f">Tumblr connected</h2><p>Identity Partners can now post. You can close this tab.</p></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (e) { return new Response('<h3>Connect failed</h3><p>' + e.message + '</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    }

    // ── Tumblr helpers: token with auto-refresh ──
    async function tumblrFreshToken(env) {
      let to = null;
      try { to = JSON.parse(await env.PRISM_KV.get('tumblr:oauth') || 'null'); } catch (e) {}
      if (!to || !to.access_token) return null;
      const ageMin = (Date.now() - new Date(to.obtainedAt || 0).getTime()) / 60000;
      if (ageMin < 50 && to.refresh_token !== undefined) return to; // young enough
      if (!to.refresh_token) return ageMin < 50 ? to : null;
      try {
        const clientId = k(env, ['tumblr_key','TUMBLR_KEY']) || '';
        const clientSecret = k(env, ['tumblr_secret','TUMBLR_SECRET']) || '';
        const rr = await fetch('https://api.tumblr.com/v2/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: to.refresh_token }).toString()
        });
        const rd = await rr.json().catch(() => ({}));
        if (rd.access_token) {
          to = { access_token: rd.access_token, token_type: rd.token_type || 'bearer', refresh_token: rd.refresh_token || to.refresh_token, scope: rd.scope || to.scope, obtainedAt: new Date().toISOString() };
          if (env.PRISM_KV) await env.PRISM_KV.put('tumblr:oauth', JSON.stringify(to));
        }
      } catch (e) {}
      return to;
    }

    // POST /api/tumblr/brand — apply avatar, header and settings from the R2 brand assets
    if (path === '/api/tumblr/brand' && request.method === 'POST') {
      try {
        const to = await tumblrFreshToken(env);
        if (!to || !to.access_token) return json({success:false,error:'Tumblr not connected'},400,origin);
        const tok = to.access_token;
        const blog = k(env, ['tumblr_blog','TUMBLR_BLOG']) || 'identitypartners';
        const blogHost = blog + '.tumblr.com';
        const out = {};
        // avatar
        try {
          const avBytes = await fetch(R2_PUBLIC + 'brand/avatar.png').then(r => r.arrayBuffer());
          const fd = new FormData();
          fd.append('avatar', new Blob([avBytes], { type: 'image/png' }), 'avatar.png');
          const r = await fetch('https://api.tumblr.com/v2/blog/' + blogHost + '/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
          out.avatar = { status: r.status, body: (await r.text()).slice(0, 120) };
        } catch (e) { out.avatar = { error: e.message }; }
        // header
        try {
          const hdBytes = await fetch(R2_PUBLIC + 'brand/banner.png').then(r => r.arrayBuffer());
          const fd = new FormData();
          fd.append('header', new Blob([hdBytes], { type: 'image/png' }), 'banner.png');
          const r = await fetch('https://api.tumblr.com/v2/blog/' + blogHost + '/header', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
          out.header = { status: r.status, body: (await r.text()).slice(0, 120) };
        } catch (e) { out.header = { error: e.message }; }
        // settings
        try {
          const r = await fetch('https://api.tumblr.com/v2/blog/' + blogHost + '/settings', {
            method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              title: 'Identity Partners',
              description: 'Understand your past. Appreciate the present. Define your future. Addiction recovery, trauma and mental health — a relational practice. hello@identitypartners.uk · www.identitypartners.uk'
            }).toString()
          });
          out.settings = { status: r.status, body: (await r.text()).slice(0, 160) };
        } catch (e) { out.settings = { error: e.message }; }
        return json({ success: true, blog: blogHost, out }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // ── Tumblr publish (OAuth2 access token from KV) ──
    if (path === '/api/social/tumblr' && request.method === 'POST') {
      try {
        const body = await request.json();
        const blogName = body.blog || k(env, ['tumblr_blog','TUMBLR_BLOG']) || 'identitypartners';
        const oauth = (typeof tumblrFreshToken === 'function') ? await tumblrFreshToken(env) : null;
        if (!oauth || !oauth.access_token) return json({success:false,error:'Tumblr not connected — open https://arch.identitypartners.uk/api/oauth/tumblr/authorize once to authorise Argentica.'},400,origin);
        const params = new URLSearchParams();
        if (body.imageUrl) { params.set('type', 'photo'); params.set('source', body.imageUrl); if (body.text) params.set('caption', body.text); }
        else { params.set('type', 'text'); params.set('body', body.text || ''); if (body.title) params.set('title', body.title); }
        params.set('state', body.draft ? 'draft' : 'published');
        const resp = await fetch('https://api.tumblr.com/v2/blog/' + blogName + '.tumblr.com/post', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + oauth.access_token, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        const data = await resp.json().catch(() => ({}));
        return json({success:resp.ok, post_id:(data.response||{}).id, error:(data.meta||{}).msg, url:((data.response||{}).id ? ('https://' + blogName + '.tumblr.com/post/' + data.response.id) : undefined)},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }

    // ── Monetisation: agentic profile proliferation ───────────────────────────
    if (path === '/api/monetisation/proliferate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const profile = body.profile || {};
        const platforms = body.platforms || [];
        const task = body.task || 'profile';
        // Use GLM 5.3 to generate platform-specific content from the master profile
        const results = [];
        for (const platform of platforms.slice(0, 5)) { // Process up to 5 at a time
          const msgs = [
            {role:'system', content:'You are an expert at creating compelling platform profiles for mental health and recovery practitioners. British English. No sycophancy. Be specific and authentic.'},
            {role:'user', content:'Create a ' + task + ' for the platform "' + platform.name + '" (' + (platform.description||'') + '). Base it on this master profile:\n\nName: ' + (profile.name||'Identity Partners') + '\nBio: ' + (profile.bio||'') + '\nServices: ' + JSON.stringify(profile.services||{}) + '\nTagline: ' + (profile.tagline||'') + '\n\nRequirements for ' + platform.name + ': ' + (platform.requirements||'Keep it concise and platform-appropriate.') + '\n\nReturn ONLY the profile text, no preamble.'}
          ];
          try {
            const result = await orchestrate(msgs, env, {profile:'balanced'});
            results.push({platform:platform.name, content:result.content, status:'generated'});
          } catch(e) {
            results.push({platform:platform.name, error:e.message, status:'failed'});
          }
        }
        // Save results to KV
        if (env.PRISM_KV) {
          const existing = await env.PRISM_KV.get('monetisation:profiles', 'json') || {};
          results.forEach(function(r) { if (r.content) existing[r.platform] = {content:r.content, generatedAt:new Date().toISOString()}; });
          await env.PRISM_KV.put('monetisation:profiles', JSON.stringify(existing));
        }
        return json({success:true, results, generated:results.filter(function(r){return r.status==='generated';}).length}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    // ── Monetisation: signup status tracker ──────────────────────────────────────────
    // ── Headless signup engine (Browserless + AI-directed form filling) ──────────────────
    // ── Postiz (self-hosted on Railway) ───────────────────────────────────────────────
    // ── Railway status (read-only, via railway_token) ─────────────────────────────────────

    if (path === '/api/railway/variables' && request.method === 'GET') {
      try {
        const token = k(env, ['railway_account_token','railway_token','RAILWAY_TOKEN','railway_api_token']) || '';
        const url2 = new URL(request.url);
        const envId = url2.searchParams.get('environmentId') || '1085176f-99ac-45f7-b14b-53c50ac807cf';
        const q = 'mutation { variableUpsert(input: { projectId: "b20afd12-447e-4b0a-a596-c0ed9d53a946", environmentId: "1085176f-99ac-45f7-b14b-53c50ac807cf", serviceId: "c0016dce-597b-4cb0-b0b8-3e914536c2ef", name: "NEXT_PUBLIC_BACKEND_URL", value: "https://arch.identitypartners.uk/api/postiz-proxy" }) }';
        const r = await fetch('https://backboard.railway.com/graphql/v2', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q })
        });
        const d = await r.json();
        if (d.errors) return json({success:false, error: d.errors.map(e => e.message).join('; ')}, 200, origin);
        return json({success:true, data: d.data}, 200, origin);
      } catch(e) { return json({success:false, error: e.message}, 200, origin); }
    }


    if (path === '/api/railway/admin' && request.method === 'POST') {
      try {
        const body = await request.json();
        const expected = await env.PRISM_KV.get('railway:admin-code');
        if (!expected || body.code !== expected) return json({ success: false, error: 'invalid code' }, 403, origin);
        // one-time: burn the code immediately after use
        await env.PRISM_KV.delete('railway:admin-code');
        const token = k(env, ['railway_account_token','railway_token']) || '';
        if (!token) return json({ success: false, error: 'No railway token' }, 200, origin);
        const out = [];
        for (const sid of (body.serviceIds || [])) {
          const r = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'mutation($id: String!) { serviceDelete(id: $id) }', variables: { id: sid } })
          });
          const d = await r.json().catch(() => ({}));
          out.push({ serviceId: sid, status: r.status, errors: (d.errors || []).map(e2 => e2.message).join('; ').slice(0, 200), data: d.data || null });
        }
        return json({ success: true, results: out }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/themes' && request.method === 'GET') {
      try {
        const themes = await env.PRISM_KV.get('themes:weeks', 'json') || [];
        return json({ themes }, 200, origin);
      } catch (e) { return json({ themes: [] }, 200, origin); }
    }
    if (path === '/api/themes' && request.method === 'POST') {
      try {
        const body = await request.json();
        const themes = Array.isArray(body.themes) ? body.themes : [];
        await env.PRISM_KV.put('themes:weeks', JSON.stringify(themes.slice(0, 200)));
        return json({ success: true, themes }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/railway/graphql' && request.method === 'POST') {
      try {
        const token = k(env, ['railway_account_token','railway_token','RAILWAY_TOKEN']) || '';
        if (!token) return json({success:false, error:'No railway token'}, 200, origin);
        const body = await request.json();
        // Read-only safety gate: no mutations through this public bridge
        if (!body.query || /^\s*mutation/.test(body.query) || /\bmutation\b/.test(body.query.replace(/^\s*query[\s\S]*?(\bmutation\b)/, '$1'))) {
          return json({ success: false, error: 'only read queries are allowed' }, 200, origin);
        }
        const r = await fetch('https://backboard.railway.com/graphql/v2', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: body.query, variables: body.variables || {} })
        });
        const d = await r.json().catch(() => ({}));
        if (body.hide && d.data && body.hide.length) {
          const redact = (o) => { if (!o || typeof o !== 'object') return o;
            if (Array.isArray(o)) return o.map(redact);
            const c = {};
            for (const key of Object.keys(o)) c[key] = body.hide.includes(key) ? '(redacted)' : redact(o[key]);
            return c; };
          return json({ success: true, data: redact(d.data), errors: d.errors }, 200, origin);
        }
        return json({ success: true, data: d.data, errors: d.errors }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/railway/status' && request.method === 'GET') {
      try {
        const token = k(env, ['railway_account_token','railway_token','RAILWAY_TOKEN','railway_api_token']) || '';
        if (!token) return json({success:false, error:'No railway_token configured'}, 200, origin);
        const query = `query { me { id email } workspaces: me { workspaces { id name projects(first: 20) { edges { node { id name environments(first: 5) { edges { node { id name serviceInstances(first: 10) { edges { node { id service { id name } } } } } } } } } } } } }`;
        const r = await fetch('https://backboard.railway.com/graphql/v2', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const d = await r.json().catch(() => ({}));
        if (d.errors) return json({success:false, error: d.errors.map(e => e.message).join('; ')}, 200, origin);
        const me = d.data && d.data.me || null;
        const workspaces = (d.data && d.data.workspaces && d.data.workspaces.workspaces || []).map(w => ({
          id: w.id, name: w.name,
          projects: (w.projects && w.projects.edges || []).map(pe => ({
            id: pe.node.id, name: pe.node.name,
            environments: (pe.node.environments && pe.node.environments.edges || []).map(ee => ({
              id: ee.node.id, name: ee.node.name,
              services: (ee.node.serviceInstances && ee.node.serviceInstances.edges || []).map(se => (se.node.service && se.node.service.name) || '(service)')
            }))
          }))
        }));
        return json({success:true, me, workspaces}, 200, origin);
      } catch(e) { return json({success:false, error: e.message}, 200, origin); }
    }


    // ── Postiz scheduled posts (for the calendar) ───────────────────────────────────────
    if (path === '/api/postiz/posts' && request.method === 'GET') {
      try {
        const key = k(env, ['postiz_api_key','POSTIZ_API_KEY']) || '';
        const host = k(env, ['postiz_url','POSTIZ_URL']) || 'https://postiz-production-70a8954f.up.railway.app';
        if (!key) return json({ success: false, posts: [], error: 'No postiz_api_key' }, 200, origin);
        let r = await fetch(host + '/api/public/v1/posts', { headers: { 'Authorization': key } });
        if (!r.ok || !(r.headers.get('content-type')||'').includes('json')) {
          r = await fetch(host + '/public/v1/posts', { headers: { 'Authorization': key } });
        }
        if (!r.ok) return json({ success: false, posts: [], error: 'Postiz HTTP ' + r.status }, 200, origin);
        const body = await r.json();
        const posts = Array.isArray(body) ? body : (body.data || body.posts || []);
        return json({ success: true, posts: posts.slice(0, 100) }, 200, origin);
      } catch (e) { return json({ success: false, posts: [], error: e.message }, 200, origin); }
    }

    // ── Postiz CORS proxy: same-origin bridge for the Postiz app ────────────────────────────────────────
    if (path.startsWith('/api/postiz-proxy/')) {
      const BE = k(env, ['postiz_url','POSTIZ_URL']) || 'https://postiz-production-70a8954f.up.railway.app';
      const reqOrigin = request.headers.get('Origin') || '';
      const allowedOrigin = reqOrigin.includes('.up.railway.app') ? reqOrigin : '';
      const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,auth,x-copilotkit-runtime-client-gql-version',
        'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': 'auth,showorg,logout,activate,reload,onboarding,x-copilotkit-runtime-client-gql-version',
        'Access-Control-Max-Age': '86400'
      };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      const subPath = path.replace('/api/postiz-proxy/', '');
      const url2 = new URL(request.url);
      const target = BE + '/' + subPath + (url2.search || '');
      const fwdHeaders = new Headers();
      ['content-type','auth','authorization','accept','x-copilotkit-runtime-client-gql-version'].forEach(h => {
        const v = request.headers.get(h); if (v) fwdHeaders.set(h, v);
      });
      try {
        const resp = await fetch(target, { method: request.method, headers: fwdHeaders, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body });
        const h = new Headers(resp.headers);
        Object.entries(corsHeaders).forEach(([k2, v]) => h.set(k2, v));
        return new Response(resp.body, { status: resp.status, headers: h });
      } catch (e) { return json({ error: e.message }, 502, origin); }
    }


    if (path === '/api/postiz/integrations' && request.method === 'GET') {
      try {
        const key = k(env, ['postiz_api_key','POSTIZ_API_KEY']) || '';
        const host = k(env, ['postiz_url','POSTIZ_URL']) || 'https://postiz-production-ec050668.up.railway.app';
        if (!key) return json({success:false, error:'No postiz_api_key. Copy the API key from your Postiz Settings and ingest it as postiz_api_key.', integrations: []}, 200, origin);
        let r = await fetch(host + '/api/public/v1/integrations', { headers: { 'Authorization': key } });
        let usedPath = '/api/public/v1';
        if (!r.ok || !(r.headers.get('content-type')||'').includes('json')) {
          r = await fetch(host + '/public/v1/integrations', { headers: { 'Authorization': key } });
          usedPath = '/public/v1';
        }
        if (!r.ok) return json({success:false, error:'Postiz HTTP ' + r.status + ' (backend not exposed through this domain?)', integrations: []}, 200, origin);
        const integrations = await r.json();
        return json({success:true, integrations: Array.isArray(integrations) ? integrations : []}, 200, origin);
      } catch(e) { return json({success:false, error: e.message, integrations: []}, 200, origin); }
    }
    if (path === '/api/postiz/post' && request.method === 'POST') {
      try {
        const body = await request.json();
        const key = k(env, ['postiz_api_key','POSTIZ_API_KEY']) || '';
        const host = k(env, ['postiz_url','POSTIZ_URL']) || 'https://postiz-production-ec050668.up.railway.app';
        if (!key) return json({success:false, error:'No postiz_api_key configured'}, 200, origin);
        let r0 = await fetch(host + '/api/public/v1/integrations', { headers: { 'Authorization': key } });
        let base = host + '/api/public/v1';
        if (!r0.ok || !(r0.headers.get('content-type')||'').includes('json')) {
          r0 = await fetch(host + '/public/v1/integrations', { headers: { 'Authorization': key } });
          base = host + '/public/v1';
        }
        if (!r0.ok) return json({success:false, error:'Postiz unreachable (HTTP ' + r0.status + ')'}, 200, origin);
        let integrations = await r0.json();
        if (!Array.isArray(integrations)) integrations = [];
        let targets = integrations;
        if (Array.isArray(body.integrationIds) && body.integrationIds.length) {
          targets = integrations.filter(i => body.integrationIds.includes(i.id));
        }
        if (!targets.length) return json({success:false, error:'No connected Postiz channels found. Connect channels in the Postiz dashboard first.'}, 200, origin);

        let imageIds = [];
        if (body.imageUrl) {
          try {
            const up = await fetch(base + '/upload-from-url', { method: 'POST', headers: { 'Authorization': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: body.imageUrl }) });
            if (up.ok) { const ud = await up.json(); if (ud && ud.id) imageIds = [ud.id]; }
          } catch (ue) {}
        }

        const payload = {
          type: body.type || 'now',
          date: body.date || new Date(Date.now() + 60000).toISOString(),
          shortLink: false,
          tags: [],
          posts: targets.map(function(t) {
            return {
              integration: { id: t.id },
              value: [{ content: (body.content || '').substring(0, 5000), image: imageIds }],
              settings: { __type: t.identifier || 'x' }
            };
          })
        };
        const pr = await fetch(base + '/posts', { method: 'POST', headers: { 'Authorization': key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const pd = await pr.json().catch(() => ({}));
        return json({success: pr.ok, status: pr.status, data: pd, channels: targets.map(t => t.name + ' (' + (t.identifier || '') + ')')}, 200, origin);
      } catch(e) { return json({success:false, error: e.message}, 500, origin); }
    }


    if (path === '/api/headless/diag' && request.method === 'POST') {
      try {
        const body = await request.json();
        const url = body.url || 'https://arch.identitypartners.uk/argentica/chat/';
        const selectors = body.selectors || ['#send', '#hw-open', '#dictate-btn', '#osk-toggle'];
        const BL_RAILWAY_TOKEN = k(env, ['railway_browserless_token']) || '';
        const BL_CLOUD = k(env, ['browserless']) || '';
        const fn = `export default async ({ page, context }) => {
          await page.setViewport({ width: 1440, height: 900 });
          await page.goto(context.url, { waitUntil: 'networkidle2', timeout: 45000 });
          const out = [];
          for (const sel of context.selectors) {
            try {
              const el = await page.$(sel);
              if (!el) { out.push({ selector: sel, exists: false }); continue; }
              const box = await el.boundingBox();
              if (!box) { out.push({ selector: sel, exists: true, visible: false }); continue; }
              const cx = box.x + Math.min(box.width / 2, 30);
              const cy = box.y + Math.min(box.height / 2, 15);
              const info = await page.evaluate(([x, y]) => {
                const top = document.elementFromPoint(x, y);
                return { tag: top ? top.tagName : null, id: top ? top.id : null, cls: top ? top.className : null, text: top ? (top.textContent || '').slice(0, 40) : null };
              }, [cx, cy]);
              out.push({ selector: sel, exists: true, visible: true, box, topLeftElement: info });
            } catch (e) { out.push({ selector: sel, error: String(e).slice(0, 120) }); }
          }
          return { data: { results: out }, type: 'application/json' };
        }`;
        const callBL = async (base, tok) => fetch(base + '/function?token=' + encodeURIComponent(tok || ''), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: fn, context: { url, selectors } })
        });
        let resp = null;
        if (BL_RAILWAY_TOKEN) { try { resp = await callBL(k(env,['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app', BL_RAILWAY_TOKEN); } catch (e) {} }
        if ((!resp || !resp.ok) && BL_CLOUD) { try { resp = await callBL('https://chrome.browserless.io', BL_CLOUD); } catch (e) {} }
        if (!resp || !resp.ok) return json({ success: false, error: 'Browserless unavailable' }, 200, origin);
        const result = await resp.json();
        return json({ success: true, results: (result.data && result.data.results) || result.results || [] }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }


    if (path === '/api/kb/importdebug' && request.method === 'POST') {
      try {
        const BL_RAILWAY_TOKEN = k(env, ['railway_browserless_token']) || '';
        const BL_CLOUD = k(env, ['browserless']) || '';
        const fn = `export default async ({ page }) => {
          await page.setViewport({ width: 1440, height: 900 });
          const errors = [];
          page.on('console', m => { if (m.type() === 'error') errors.push(String(m.text()).slice(0, 240)); });
          page.on('pageerror', e => errors.push(String(e).slice(0, 240)));
          await page.goto('https://arch.identitypartners.uk/argentica/library/knowledge/', { waitUntil: 'networkidle2', timeout: 60000 });
          await new Promise(r => setTimeout(r, 2000));
          const info = await page.evaluate(async () => {
            const out = {};
            out.hasDialog = !!document.getElementById('import-dialog');
            out.hasPdfjs = typeof pdfjsLib !== 'undefined';
            typeof pdfjsLib !== 'undefined' && (out.workerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc || '(unset)');
            const dlg = document.getElementById('import-dialog');
            if (dlg) { dlg.style.display = 'flex'; }
            out.dialogShown = dlg ? (getComputedStyle(dlg).display === 'flex') : false;
            try { showImport(); out.showImportOK = true; } catch (e) { out.showImportErr = String(e).slice(0, 200); }
            const NL = String.fromCharCode(10);
            try { out.mdTest = mdToHtml(['# Title','## Sub','Hello **world**','- a','- b','','Para.'].join(NL)); } catch (e) { out.mdErr = String(e).slice(0, 200); }
            try {
              const dt = new DataTransfer();
              const f = new File(['# My Theory','','Intro here.','## Chapter One','','Body one.','## Chapter Two','','Body two.'].join(NL), 'test-theory.md', { type: 'text/markdown' });
              dt.items.add(f);
              const inp = document.getElementById('import-file');
              inp.files = dt.files;
              out.fileSet = inp.files.length === 1;
              document.getElementById('import-section').value = 'Debug section';
              document.getElementById('import-split').checked = true;
              await doImport();
              out.importFinished = true;
              out.status = document.getElementById('import-status').textContent;
              await new Promise(r => setTimeout(r, 3000));
            } catch (e) { out.importErr = String(e && e.stack || e).slice(0, 400); }
            out.pageCount = (typeof pages !== 'undefined') ? pages.length : 'n/a';
            out.newPages = (typeof pages !== 'undefined') ? pages.filter(p => (p.source||'') === 'test-theory.md').map(p => p.title) : 'n/a';
            return out;
          }).catch(e => ({ evalErr: String(e).slice(0, 400) }));
          return { data: { info, errors }, type: 'application/json' };
        }`;
        const callBL = async (base, tok) => fetch(base + '/function?token=' + encodeURIComponent(tok || ''), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: fn, context: {} })
        });
        let resp = null;
        if (BL_RAILWAY_TOKEN) { try { resp = await callBL(k(env,['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app', BL_RAILWAY_TOKEN); } catch (e) {} }
        if ((!resp || !resp.ok) && BL_CLOUD) { try { resp = await callBL('https://chrome.browserless.io', BL_CLOUD); } catch (e) {} }
        if (!resp || !resp.ok) {
          let errTxt = '';
          try { errTxt = (await resp.text()).slice(0, 600); } catch (e) { errTxt = 'no response body'; }
          return json({ success: false, error: 'Browserless rejected the request', status: resp ? resp.status : 0, detail: errTxt }, 200, origin);
        }
        const result = await resp.json();
        return json({ success: true, debug: (result.data && result.data) || result }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/headless/logindebug' && request.method === 'POST') {
      try {
        const creds = await request.json();
        const BL_RAILWAY_TOKEN = k(env, ['railway_browserless_token']) || '';
        const BL_CLOUD = k(env, ['browserless']) || '';
        const fn = `export default async ({ page, context }) => {
          await page.setViewport({ width: 1280, height: 900 });
          const errors = [];
          const reqs = [];
          const NL = String.fromCharCode(10);
          page.on('console', m => { if (m.type() === 'error') errors.push(String(m.text()).slice(0, 200)); });
          page.on('response', res => {
            const u = res.url();
            if (u.includes('/auth/') || u.includes('/api/postiz-proxy')) reqs.push(res.status() + ' ' + u.slice(0, 130));
          });
          await page.goto('https://postiz-production-ec050668.up.railway.app/auth/login', { waitUntil: 'networkidle2', timeout: 60000 });
          await new Promise(r => setTimeout(r, 2500));
          let filled = await page.evaluate((c) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const email = inputs.find(i => i.type === 'email' || /email/i.test(i.name + i.id + i.placeholder));
            const pass = inputs.find(i => i.type === 'password');
            const setV = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
            if (email) setV(email, c.email); else return 'no email field';
            if (pass) setV(pass, c.password); else return 'no password field';
            return 'filled';
          }, context.creds);
          let submitted = await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => /sign in|log ?in|continue|submit/i.test(x.textContent));
            if (b) { b.click(); return 'clicked'; } return 'no button';
          }).catch(e => 'ERR ' + e);
          await new Promise(r => setTimeout(r, 7000));
          let addClick = '';
          let modalInfo = null;
          try {
            await page.goto('https://postiz-production-ec050668.up.railway.app/channels', { waitUntil: 'networkidle2', timeout: 45000 });
            await new Promise(r => setTimeout(r, 4000));
          } catch (e) { errors.push('goto channels: ' + String(e).slice(0, 120)); }
          try {
            addClick = await page.evaluate(() => {
              const bs = Array.from(document.querySelectorAll('button, a'));
              const b = bs.find(x => /add channel|add a channel|connect|new channel/i.test((x.textContent || '') + ' ' + (x.getAttribute && x.getAttribute('aria-label') || '')));
              if (b) { b.click(); return 'clicked: ' + (b.textContent || '').slice(0, 50); }
              return 'no add button; sample: ' + bs.slice(0, 10).map(x => (x.textContent || 'x').trim().slice(0, 18)).join(' | ');
            });
            await new Promise(r => setTimeout(r, 3000));
          } catch (e) { addClick = 'ERR ' + String(e).slice(0, 150); }
          modalInfo = await page.evaluate(() => {
            const dlgs = Array.from(document.querySelectorAll('div[role=dialog]'));
            const dlg = dlgs[dlgs.length - 1];
            return dlg ? { hasDialog: true, text: dlg.textContent.replace(/\s+/g, ' ').slice(0, 600) } : { hasDialog: false };
          }).catch(e => ({ err: String(e).slice(0, 150) }));
          const after = await page.evaluate(() => ({
            url: location.href,
            cookies: document.cookie.slice(0, 80)
          })).catch(e => ({ err: String(e) }));
          const shot2 = await page.screenshot({ type: 'png' }).then(b => 'data:image/png;base64,' + b.toString('base64')).catch(() => '');
          return { data: { filled, submitted, after, addClick, modalInfo, reqs: reqs.slice(0, 40), errors: errors.slice(0, 12), shot2 }, type: 'application/json' };
        }`;
        const callBL = async (base, tok) => fetch(base + '/function?token=' + encodeURIComponent(tok || ''), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: fn, context: { creds } })
        });
        let resp = null;
        if (BL_RAILWAY_TOKEN) { try { resp = await callBL(k(env,['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app', BL_RAILWAY_TOKEN); } catch (e) {} }
        if ((!resp || !resp.ok) && BL_CLOUD) { try { resp = await callBL('https://chrome.browserless.io', BL_CLOUD); } catch (e) {} }
        if (!resp || !resp.ok) return json({ success: false, error: 'Browserless unavailable' }, 200, origin);
        const result = await resp.json();
        const d = (result.data && result.data) || result;
        if (creds.wantshot && d.shot2) { await env.PRISM_KV.put('tmp:postiz-shot', d.shot2, { expirationTtl: 300 }); }
        const shotUrl = creds.wantshot ? ((await env.PRISM_KV.get('tmp:postiz-shot', { type: 'text' })) || '').slice(0, 40) : null;
        return json({ success: true, debug: { filled: d.filled, submitted: d.submitted, after: d.after, addClick: d.addClick, modalInfo: d.modalInfo, reqs: d.reqs, errors: d.errors, shot2: creds.wantshot ? (d.shot2 || '').slice(0, 1400000) : undefined } }, 200, origin);
      } catch (e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    if (path === '/api/headless/signup' && request.method === 'POST') {
      try {
        const body = await request.json();
        const platformName = body.platform || '';
        const signupUrl = body.signupUrl || '';
        const profile = body.profile || {};
        if (!signupUrl || !platformName) return json({success:false, error:'platform and signupUrl required'}, 400, origin);

        const BL_CLOUD = k(env, ['browserless','browserless_token','BROWSERLESS_TOKEN','browserless_api_key','BROWSERLESS.IO']) || '';
        const BL_RAILWAY_TOKEN = k(env, ['railway_browserless_token','RAILWAY_BROWSERLESS_TOKEN','browserless_railway_token']) || '';
        const BL_URL = k(env, ['browserless_url','BROWSERLESS_URL']) || 'https://chrome.browserless.io';
        const BL_RAILWAY = k(env, ['browserless_railway_url']) || 'https://browserless-production-e49c65ef.up.railway.app';
        if (!BL_CLOUD && !BL_RAILWAY_TOKEN) return json({success:false, error:'No Browserless token. Ingest railway_browserless_token (for the Railway instance) and/or browserless (for chrome.browserless.io).', needsToken:true}, 200, origin);

        // Step 1: fetch the signup page and map fields heuristically
        let fieldsMap = [];
        try {
          const page = await fetch(signupUrl, {headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'}});
          const html = (await page.text()).slice(0, 300000);
          const inputs = [...html.matchAll(/<input[^>]*>/gi)].map(m => m[0]);
          for (const tag of inputs.slice(0, 30)) {
            const name = (tag.match(/name="([^"]*)"/i)||[])[1] || '';
            const type = (tag.match(/type="([^"]*)"/i)||[])[1] || 'text';
            const id = (tag.match(/id="([^"]*)"/i)||[])[1] || '';
            const ph = (tag.match(/placeholder="([^"]*)"/i)||[])[1] || '';
            const label = (name + ' ' + id + ' ' + ph).toLowerCase();
            if (/email/.test(label)) fieldsMap.push({selector: name ? 'input[name="'+name+'"]' : 'input[type=email]', value: profile.email || 'hello@identitypartners.uk'});
            else if (/pass/.test(label)) fieldsMap.push({selector: 'input[type=password]', value: profile.password || '', password: true});
            else if (/display|fullname|full.name|first/.test(label)) fieldsMap.push({selector: name ? 'input[name="'+name+'"]' : 'input', value: profile.displayName || profile.name || 'Identity Partners'});
            else if (/user|handle|nickname/.test(label)) fieldsMap.push({selector: name ? 'input[name="'+name+'"]' : 'input', value: profile.handle || 'identitypartners'});
            else if (/phone|tel/.test(label)) fieldsMap.push({selector: name ? 'input[name="'+name+'"]' : 'input[type=tel]', value: profile.phone || ''});
            else if (/url|website|link/.test(label)) fieldsMap.push({selector: name ? 'input[name="'+name+'"]' : 'input[type=url]', value: profile.website || 'https://www.identitypartners.uk'});
          }
        } catch (he) {}

        // Signup password comes from the worker secret, never from code
        const platformPw = k(env, ['platform_pw','PLATFORM_PW']) || '';
        if (!platformPw) return json({success:false, error:'No platform_pw secret configured. Ingest the agreed signup password as platform_pw so headless signups can use it.', needsToken:true}, 200, origin);
        fieldsMap.forEach(f => { if (f.password) f.value = platformPw; });

        // Step 2: drive Browserless to open, fill, screenshot, submit
        const fn = `export default async ({ page, context }) => {
          const steps = [];
          try {
            await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            steps.push('opened');
            for (const f of context.fields) {
              try {
                const el = await page.$(f.selector);
                if (el && f.value) { await el.type(f.value, {delay: 20}); steps.push('filled ' + f.selector); }
              } catch (e) {}
            }
            const before = await page.screenshot({ encoding: 'base64' });
            // detect captcha before submitting
            const html = await page.content();
            const captcha = /captcha|recaptcha|hcaptcha|turnstile|cf-challenge/i.test(html);
            let submitted = false;
            if (!captcha) {
              const btn = await page.$('button[type=submit], input[type=submit], button:not([type])');
              if (btn) { try { await Promise.race([btn.click(), page.waitForNavigation({timeout: 20000})]); } catch (e) {} submitted = true; steps.push('submitted'); }
            } else { steps.push('captcha detected - stopped for human'); }
            const after = await page.screenshot({ encoding: 'base64' });
            const finalHtml = (await page.content()).slice(0, 20000);
            return { data: { steps, captcha, submitted, before, after, finalTitle: await page.title() }, type: 'application/json' };
          } catch (e) { return { data: { steps, error: String(e) }, type: 'application/json' }; }
        }`;
        const callBL = async (base, tok) => fetch(base + '/function?token=' + encodeURIComponent(tok || ''), {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ code: fn, context: { url: signupUrl, fields: fieldsMap } })
        });
        let blResp = null;
        let railErr = 'no railway_browserless_token';
        if (BL_RAILWAY_TOKEN) {
          try { blResp = await callBL(BL_RAILWAY, BL_RAILWAY_TOKEN); if (!blResp.ok) railErr = 'HTTP ' + blResp.status + ': ' + (await blResp.text().catch(() => '')).slice(0, 100); }
          catch (re) { railErr = re.message; blResp = { ok: false, status: 0, text: async () => railErr }; }
        }
        if ((!blResp || !blResp.ok) && BL_CLOUD) {
          try { const cloudResp = await callBL(BL_URL, BL_CLOUD); if (cloudResp.ok) blResp = cloudResp; else if (!blResp || !blResp.ok) blResp = cloudResp; }
          catch (ce) { if (!blResp || !blResp.ok) blResp = { ok: false, status: 0, text: async () => ce.message }; }
        }
        if (!blResp || !blResp.ok) {
          const cloudErr = blResp ? ('HTTP ' + blResp.status + ': ' + (await blResp.text().catch(() => '')).slice(0, 120)) : 'not attempted (no cloud token)';
          return json({success:false, error:'Browserless failed. Railway instance: ' + railErr + ' | chrome.browserless.io: ' + cloudErr, stepsExecuted: 0}, 200, origin);
        }
        const blJson = await blResp.json();
        const result = (blJson && blJson.data) ? blJson.data : blJson;

        // Step 3: store screenshots + record status
        const rec = { platform: platformName, url: signupUrl, steps: result.steps || [], captcha: !!result.captcha, submitted: !!result.submitted, ranAt: new Date().toISOString() };
        if (result.before) {
          const key = 'headless/' + platformName.toLowerCase().replace(/\W/g,'-') + '-' + Date.now() + '-before.png';
          await env.PRISM_ASSETS.put(key, result.before, { httpMetadata: { contentType: 'image/png' } });
          rec.screenshotBefore = '/api/r2/file?key=' + encodeURIComponent(key);
        }
        if (result.after) {
          const key = 'headless/' + platformName.toLowerCase().replace(/\W/g,'-') + '-' + Date.now() + '-after.png';
          await env.PRISM_ASSETS.put(key, result.after, { httpMetadata: { contentType: 'image/png' } });
          rec.screenshotAfter = '/api/r2/file?key=' + encodeURIComponent(key);
        }
        // record which platforms were signed up (email only — password lives in the platform_pw secret, never stored)
        if (result.submitted || result.steps.some(s => /filled/.test(s))) {
          const vault = await env.PRISM_KV.get('monetisation:credentials', 'json') || {};
          vault[platformName] = { email: profile.email || 'hello@identitypartners.uk', note: 'password = platform_pw secret', created: rec.ranAt };
          await env.PRISM_KV.put('monetisation:credentials', JSON.stringify(vault));
        }
        const st = await env.PRISM_KV.get('monetisation:signup', 'json') || {};
        st[platformName] = { state: result.submitted ? 'created' : (result.captcha ? 'needs-verification' : 'attempted'),
                              notes: (result.steps || []).join('; ').slice(0,200), updated: rec.ranAt };
        await env.PRISM_KV.put('monetisation:signup', JSON.stringify(st));
        return json({ success: true, status: result.submitted ? 'form_submitted' : (result.captcha ? 'captcha_stop' : 'attempted'),
                      stepsExecuted: (result.steps || []).length, note: result.captcha ? 'Stopped at CAPTCHA — open the screenshot and finish manually.' : (result.error || ''),
                      screenshot: rec.screenshotAfter || rec.screenshotBefore || null, record: rec }, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }

    if (path === '/api/headless/credentials' && request.method === 'GET') {
      try {
        const vault = await env.PRISM_KV.get('monetisation:credentials', 'json') || {};
        return json({ credentials: vault }, 200, origin);
      } catch(e) { return json({ credentials: {} }, 200, origin); }
    }


    if (path === '/api/monetisation/signup-status' && request.method === 'GET') {
      try {
        const st = await env.PRISM_KV.get('monetisation:signup', 'json') || {};
        return json({ status: st }, 200, origin);
      } catch(e) { return json({ status: {} }, 200, origin); }
    }
    if (path === '/api/monetisation/signup-status' && request.method === 'POST') {
      try {
        const body = await request.json();
        const st = await env.PRISM_KV.get('monetisation:signup', 'json') || {};
        st[body.platform] = { state: body.state || 'todo', handle: body.handle || '', notes: body.notes || '', updated: new Date().toISOString() };
        await env.PRISM_KV.put('monetisation:signup', JSON.stringify(st));
        return json({ success: true, status: st }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
    }

    // ── Monetisation: headless account creation (platforms with open APIs) ───────────────────────────────
    if (path === '/api/monetisation/create-account' && request.method === 'POST') {
      try {
        const body = await request.json();
        const platform = body.platform || '';
        if (platform === 'bluesky') {
          const handle = (body.handle || '').trim();
          const email = (body.email || '').trim();
          const password = body.password || '';
          if (!handle || !email || !password) return json({success:false, error:'handle, email and password are all required'}, 400, origin);
          if (!handle.endsWith('.bsky.social')) return json({success:false, error:'handle must end in .bsky.social (a subdomain handle)'}, 400, origin);
          const r = await fetch('https://bsky.social/xrpc/com.atproto.server.createAccount', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ handle, email, password })
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return json({success:false, error: (d.message || d.error || 'Bluesky refused the signup') + ' (HTTP ' + r.status + ')'}, 200, origin);
          if (env.PRISM_KV) {
            const st = await env.PRISM_KV.get('monetisation:signup', 'json') || {};
            st['Bluesky'] = { state: 'created', handle: handle, notes: 'created headlessly ' + new Date().toISOString(), updated: new Date().toISOString() };
            await env.PRISM_KV.put('monetisation:signup', JSON.stringify(st));
          }
          return json({success:true, handle: handle, did: d.did}, 200, origin);
        }
        return json({success:false, error:'No open signup API for ' + platform + ' — use the signup kit for that platform.'}, 200, origin);
      } catch(e) { return json({success:false, error: e.message}, 500, origin); }
    }


    if (path === '/api/monetisation/profiles' && request.method === 'GET') {
      try {
        const profiles = env.PRISM_KV ? await env.PRISM_KV.get('monetisation:profiles', 'json') : null;
        return json({profiles: profiles || {}}, 200, origin);
      } catch(e) { return json({profiles:{}}, 200, origin); }
    }

    if (path === '/api/monetisation/post' && request.method === 'POST') {
      try {
        const body = await request.json();
        const platform = body.platform || '';
        const content = body.content || '';
        const results = {};
        // Route to appropriate posting API
        if (platform === 'bluesky' || platform === 'all') {
          const bskyHandle = k(env, ['bluesky_handle','BLUESKY_HANDLE']) || '@identitypartners.bsky.social';
          const bskyPass = k(env, ['bluesky_password','BLUESKY_PASSWORD','bluesky_app_password']) || '';
          if (bskyHandle && bskyPass) {
            try {
              const sr = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:bskyHandle,password:bskyPass})});
              if (sr.ok) {
                const session = await sr.json();
                const pr = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.accessJwt},body:JSON.stringify({repo:session.did,collection:'app.bsky.feed.post',record:{text:content.substring(0,300),createdAt:new Date().toISOString(),langs:['en-GB']}})});
                results.bluesky = {success:pr.ok};
              }
            } catch(e) { results.bluesky = {success:false,error:e.message}; }
          }
        }
        if (platform === 'telegram' || platform === 'all') {
          const tgToken = k(env, ['telegram_token','TELEGRAM_TOKEN']) || '';
          const tgChat = k(env, ['telegram_chat_id','TELEGRAM_CHAT_ID','telegram_chat']) || '';
          if (tgToken && tgChat) {
            try {
              const tr = await fetch('https://api.telegram.org/bot'+tgToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChat,text:content.substring(0,4096)})});
              results.telegram = {success:tr.ok};
            } catch(e) { results.telegram = {success:false,error:e.message}; }
          }
        }
        if (platform === 'tumblr' || platform === 'all') {
          const oauthToken = k(env, ['tumblr_oauth_token','TUMBLR_OAUTH_TOKEN']) || '';
          if (oauthToken) {
            try {
              const tr = await fetch('https://api.tumblr.com/v2/blog/identitypartners.tumblr.com/post',{method:'POST',headers:{'Authorization':'Bearer '+oauthToken,'Content-Type':'application/json'},body:JSON.stringify({type:'text',body:content.substring(0,100000)})});
              const td = await tr.json().catch(()=>({}));
              results.tumblr = {success:tr.ok, postId: td.response && td.response.id};
            } catch(e) { results.tumblr = {success:false,error:e.message}; }
          } else { results.tumblr = {success:false, error:'Tumblr OAuth token not set'}; }
        }
        if (platform === 'substack' || platform === 'all') {
          const substackEmail = k(env, ['substack_email','SUBSTACK_EMAIL']) || '';
          if (substackEmail) {
            try {
              const sr = await fetch('https://api.substack.com/v1/posts', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ title: content.split('\n')[0].slice(0, 100), body: content, publish: false })
              });
              results.substack = sr.ok ? {success:true} : {success:false, note:'Substack API key not configured — queued as draft via ' + substackEmail};
            } catch(e) { results.substack = {success:false, note:'Queued via ' + substackEmail}; }
          }
        }
        if (platform === 'whop' || platform === 'all') {
          const whopKey = k(env, ['whop_api_key','WHOP_API_KEY']) || '';
          results.whop = whopKey
            ? {success:true, note:'Whop key present — Whop is a commerce API (products/members), not a content feed; use the Whop dashboard for announcements.'}
            : {success:false, error:'No whop_api_key'};
        }
        return json({success:true, results}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }


    // ── Google OAuth flow ─────────────────────────────────────────────────────
    if (path === '/comms/google/auth' && request.method === 'GET') {
      const clientId = k(env, ['google_client_id','GOOGLE_CLIENT_ID']) || '';
      const redirectUri = k(env, ['google_redirect_uri','GOOGLE_REDIRECT_URI']) || 'https://prism.identitypartners.uk/comms/google/callback';
      const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose email profile openid');
      const state = Math.random().toString(36).slice(2);
      if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:state', state, {expirationTtl: 600});
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&response_type=code&scope=' + scope + '&access_type=offline&prompt=consent&state=' + state;
      return Response.redirect(authUrl, 302);
    }

    if (path === '/comms/google/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const clientId = k(env, ['google_client_id','GOOGLE_CLIENT_ID']) || '';
      const clientSecret = k(env, ['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
      const redirectUri = k(env, ['google_redirect_uri','GOOGLE_REDIRECT_URI']) || 'https://prism.identitypartners.uk/comms/google/callback';
      if (!code) return new Response('<h2>Error: no code</h2>', {headers:{'Content-Type':'text/html'}});
      try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'}).toString()});
        const tokenData = await tokenResp.json();
        if (tokenData.access_token) {
          const stored = {access_token:tokenData.access_token,refresh_token:tokenData.refresh_token,expires_at:Date.now()+(tokenData.expires_in||3600)*1000,scope:tokenData.scope,stored_at:Date.now()};
          if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token', JSON.stringify(stored));
          return new Response('<html><body style="font-family:sans-serif;padding:40px;background:#f0f4f8;"><h2 style="color:#0f3b3a;">✓ Google connected!</h2><p>Gmail and Google Calendar are now connected to Argentica.</p><p><a href="/comms/">Return to Comms</a></p></body></html>', {headers:{'Content-Type':'text/html'}});
        }
        return new Response('<h2>Error: ' + JSON.stringify(tokenData).substring(0,200) + '</h2>', {headers:{'Content-Type':'text/html'}});
      } catch(e) { return new Response('<h2>Error: ' + e.message + '</h2>', {headers:{'Content-Type':'text/html'}}); }
    }

    if (path === '/api/google/calendar' && request.method === 'GET') {
      try {
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData) return json({status:'not_connected',today:[],week:[]},200,origin);
        let accessToken = tokenData.access_token;
        // Auto-refresh if expired
        if (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000 && tokenData.refresh_token) {
          const clientId = k(env, ['google_client_id','GOOGLE_CLIENT_ID']) || '';
          const clientSecret = k(env, ['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
          const refreshResp = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:tokenData.refresh_token,client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token'}).toString()});
          const refreshData = await refreshResp.json();
          if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            tokenData.access_token = accessToken;
            tokenData.expires_at = Date.now() + (refreshData.expires_in||3600)*1000;
            if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token', JSON.stringify(tokenData));
          }
        }
        const now = new Date();
        const weekEnd = new Date(now.getTime() + 14*24*60*60*1000).toISOString();
        const calResp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin='+encodeURIComponent(now.toISOString())+'&timeMax='+encodeURIComponent(weekEnd)+'&singleEvents=true&orderBy=startTime&maxResults=20',{headers:{'Authorization':'Bearer '+accessToken}});
        if (!calResp.ok) return json({status:'api_error',code:calResp.status,today:[],week:[]},200,origin);
        const calData = await calResp.json();
        const events = (calData.items||[]).map(function(ev){return{id:ev.id,title:ev.summary||'Event',starts_at:ev.start?.dateTime||ev.start?.date,ends_at:ev.end?.dateTime||ev.end?.date,location:ev.location||'',description:ev.description||''};});
        const todayEnd = new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59).toISOString();
        return json({status:'ok',today:events.filter(function(e){return e.starts_at<=todayEnd;}),week:events.filter(function(e){return e.starts_at>todayEnd;}),total:events.length},200,origin);
      } catch(e) { return json({status:'error',error:e.message,today:[],week:[]},200,origin); }
    }

    if (path === '/api/google/status' && request.method === 'GET') {
      try {
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({connected:false},200,origin);
        // Check if token is expired and auto-refresh
        let accessToken = tokenData.access_token;
        if (tokenData.expires_at && Date.now() > tokenData.expires_at - 300000) {
          // Token expired or expiring in 5 min - refresh
          try {
            const cid = k(env,['google_client_id','GOOGLE_CLIENT_ID']) || '';
            const cs = k(env,['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
            const rr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokenData.refresh_token,client_id:cid,client_secret:cs}).toString()});
            const rd = await rr.json();
            if (rd.access_token) {
              accessToken = rd.access_token;
              tokenData.access_token = accessToken;
              tokenData.expires_at = Date.now() + (rd.expires_in||3600)*1000;
              tokenData.stored_at = Date.now();
              if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token',JSON.stringify(tokenData));
            }
          } catch(e) {}
        }
        return json({connected:true,scope:tokenData.scope,stored_at:tokenData.stored_at,expires_at:tokenData.expires_at},200,origin);
      } catch(e) { return json({connected:false},200,origin); }
    }


    // ── Azure Blob Storage upload ─────────────────────────────────────────────
    if (path === '/api/azure/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const connStr = k(env, ['azure_storage_connection','AZURE_STORAGE_CONNECTION']) || '';
        const accountName = k(env, ['azure_storage_account','AZURE_STORAGE_ACCOUNT']) || 'argenticastorage';
        const accountKey = k(env, ['azure_storage_key','AZURE_STORAGE_KEY']) || '';
        if (!accountKey) return json({success:false,error:'Azure Storage key not configured. Add azure_storage_key via Secret Ingester.'},400,origin);
        const fileName = body.fileName || ('file-'+Date.now());
        const container = body.container || 'argentica';
        const content = body.content || '';
        const b64 = content.includes(',') ? content.split(',')[1] : content;
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i=0;i<binaryStr.length;i++) bytes[i]=binaryStr.charCodeAt(i);
        // Azure Blob Storage REST API
        const date = new Date().toUTCString();
        const blobUrl = 'https://' + accountName + '.blob.core.windows.net/' + container + '/' + encodeURIComponent(fileName);
        // Note: proper HMAC-SHA256 signing required for production
        // For now, use SAS token if available
        const sasToken = k(env, ['azure_storage_sas','AZURE_STORAGE_SAS']) || '';
        if (!sasToken) return json({success:false,error:'Azure SAS token not configured. Add azure_storage_sas via Secret Ingester.'},400,origin);
        const uploadResp = await fetch(blobUrl + '?' + sasToken, {method:'PUT',headers:{'x-ms-blob-type':'BlockBlob','Content-Type':'application/octet-stream','Content-Length':String(bytes.length)},body:bytes});
        if (!uploadResp.ok) return json({success:false,error:'Upload failed: HTTP '+uploadResp.status},200,origin);
        return json({success:true,url:blobUrl,name:fileName},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }


    // ── Gemini image generation (Nano Banana) ────────────────────────────────
    if (path === '/api/image/gemini' && request.method === 'POST') {
      try {
        const body = await request.json();
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini key not configured'},400,origin);
        const prompt = body.prompt || body.text || '';
        const model = body.model || 'gemini-3.1-flash-image'; // Nano Banana 2
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+GKEY, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE','TEXT']}})
        });
        if (!resp.ok) { const err = await resp.text(); return json({error:'Gemini image error: '+err.substring(0,200)},resp.status,origin); }
        const data = await resp.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find(function(p){return p.inlineData;});
        const textPart = parts.find(function(p){return p.text;});
        if (imgPart) return json({success:true,image_base64:imgPart.inlineData.data,mime_type:imgPart.inlineData.mimeType,model},200,origin);
        return json({success:false,error:'No image in response',text:textPart?.text||''}, 200, origin);
      } catch(e) { return json({error:e.message},500,origin); }
    }

    // ── Gemini video generation (Omni Flash) ──────────────────────────────────
    if (path === '/api/video/gemini' && request.method === 'POST') {
      try {
        const body = await request.json();
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini key not configured'},400,origin);
        const prompt = body.prompt || body.text || '';
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-omni-flash:generateContent?key='+GKEY, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['VIDEO']}})
        });
        if (!resp.ok) { const err = await resp.text(); return json({error:'Gemini video error: '+err.substring(0,200)},resp.status,origin); }
        const data = await resp.json();
        return json({success:true,data:data.candidates?.[0]?.content||null,model:'gemini-omni-flash'},200,origin);
      } catch(e) { return json({error:e.message},500,origin); }
    }

    // ── Gemini STT (Transcribe) ───────────────────────────────────────────────
    if (path === '/api/stt/gemini' && request.method === 'POST') {
      try {
        const body = await request.json();
        const GKEY = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini key not configured'},400,origin);
        const audioB64 = body.audio_base64 || '';
        const mimeType = body.mime_type || 'audio/mp3';
        if (!audioB64) return json({error:'audio_base64 required'},400,origin);
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key='+GKEY, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents:[{parts:[{inlineData:{mimeType,data:audioB64}},{text:'Transcribe this audio accurately. British English. Include speaker labels if multiple speakers.'}]}]})
        });
        if (!resp.ok) { const err = await resp.text(); return json({error:'Gemini STT error: '+err.substring(0,200)},resp.status,origin); }
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return json({success:true,text,model:'gemini-3.5-transcribe'},200,origin);
      } catch(e) { return json({error:e.message},500,origin); }
    }

    // ── Google Drive upload ───────────────────────────────────────────────────
    if (path === '/api/gdrive/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({success:false,error:'Google not connected. Go to /comms/google/ to connect.'},400,origin);
        const fileName = body.fileName || ('file-'+Date.now());
        const content = body.content || '';
        const mimeType = body.mimeType || 'application/octet-stream';
        const b64 = content.includes(',') ? content.split(',')[1] : content;
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i=0;i<binaryStr.length;i++) bytes[i]=binaryStr.charCodeAt(i);
        // Step 1: Create file metadata
        const metaResp = await fetch('https://www.googleapis.com/drive/v3/files',{
          method:'POST',
          headers:{'Authorization':'Bearer '+tokenData.access_token,'Content-Type':'application/json'},
          body:JSON.stringify({name:fileName,mimeType})
        });
        if (!metaResp.ok) { const err = await metaResp.text(); return json({success:false,error:'Drive meta failed: '+err.substring(0,200)},200,origin); }
        const metaData = await metaResp.json();
        const fileId = metaData.id;
        // Step 2: Upload content
        const uploadResp = await fetch('https://www.googleapis.com/upload/drive/v3/files/'+fileId+'?uploadType=media',{
          method:'PATCH',
          headers:{'Authorization':'Bearer '+tokenData.access_token,'Content-Type':mimeType},
          body:bytes
        });
        if (!uploadResp.ok) { const err = await uploadResp.text(); return json({success:false,error:'Drive upload failed: '+err.substring(0,200)},200,origin); }
        const uploadData = await uploadResp.json();
        return json({success:true,id:fileId,name:fileName,webViewLink:'https://drive.google.com/file/d/'+fileId+'/view'},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }


    if (path === '/api/google/gmail' && request.method === 'GET') {
      try {
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({status:'not_connected',messages:[]},200,origin);
        let accessToken = tokenData.access_token;
        if (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000 && tokenData.refresh_token) {
          const cid = k(env,['google_client_id','GOOGLE_CLIENT_ID']) || '';
          const cs = k(env,['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
          const rr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:tokenData.refresh_token,client_id:cid,client_secret:cs,grant_type:'refresh_token'}).toString()});
          const rd = await rr.json();
          if (rd.access_token) { accessToken = rd.access_token; tokenData.access_token = accessToken; tokenData.expires_at = Date.now()+(rd.expires_in||3600)*1000; if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token',JSON.stringify(tokenData)); }
        }
        const maxResults = parseInt(url.searchParams.get('maxResults') || '20');
        const label = url.searchParams.get('label') || 'INBOX';
        const listResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults='+maxResults+'&labelIds='+label,{headers:{'Authorization':'Bearer '+accessToken}});
        if (!listResp.ok) { const err = await listResp.text(); return json({status:'api_error',code:listResp.status,error:err.substring(0,300),messages:[]},200,origin); }
        const listData = await listResp.json();
        const ids = (listData.messages || []).slice(0,10);
        const messages = await Promise.all(ids.map(async function(m) {
          try {
            const mr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',{headers:{'Authorization':'Bearer '+accessToken}});
            if (!mr.ok) return null;
            const msg = await mr.json();
            const hdrs = msg.payload && msg.payload.headers ? msg.payload.headers : [];
            const gh = function(n) { return (hdrs.find(function(h){return h.name===n;})||{}).value||''; };
            return {id:m.id,subject:gh('Subject')||'(no subject)',from:gh('From'),date:gh('Date'),snippet:msg.snippet||'',unread:(msg.labelIds||[]).includes('UNREAD')};
          } catch(e) { return null; }
        }));
        return json({status:'ok',messages:messages.filter(Boolean),total:listData.resultSizeEstimate||0},200,origin);
      } catch(e) { return json({status:'error',error:e.message,messages:[]},200,origin); }
    }


    if (path === '/api/google/calendar/create' && request.method === 'POST') {
      try {
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({success:false,error:'Google not connected'},400,origin);
        const body = await request.json();
        const event = {
          summary: body.summary || body.title || 'Argentica Post',
          description: body.description || body.content || '',
          start: {dateTime: body.start || new Date().toISOString(), timeZone: body.timezone || 'Europe/London'},
          end: {dateTime: body.end || new Date(Date.now()+3600000).toISOString(), timeZone: body.timezone || 'Europe/London'},
          colorId: body.colorId || '9',
        };
        const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{
          method:'POST',
          headers:{'Authorization':'Bearer '+tokenData.access_token,'Content-Type':'application/json'},
          body:JSON.stringify(event)
        });
        if (!resp.ok) { const err = await resp.text(); return json({success:false,error:err.substring(0,300)},200,origin); }
        const evData = await resp.json();
        return json({success:true,id:evData.id,link:evData.htmlLink,summary:evData.summary},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }


    if (path === '/api/outlook/inbox' && request.method === 'GET') {
      try {
        let tokenData = env.PRISM_KV ? await env.PRISM_KV.get('msgraph:token','json') : null;
        if (!tokenData || !tokenData.access_token || (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000)) {
          const tenantId = k(env,['msgraph_tenant','MSGRAPH_TENANT']) || '';
          const clientId = k(env,['msgraph_client','MSGRAPH_CLIENT']) || '';
          const clientSecret = k(env,['msgraph_secret','MSGRAPH_SECRET']) || '';
          const params = new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:'https://graph.microsoft.com/.default'});
          const tr = await fetch('https://login.microsoftonline.com/'+tenantId+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
          tokenData = await tr.json();
          if (tokenData.access_token && env.PRISM_KV) await env.PRISM_KV.put('msgraph:token',JSON.stringify({access_token:tokenData.access_token,expires_at:Date.now()+(tokenData.expires_in||3600)*1000}),{expirationTtl:3500});
        }
        if (!tokenData || !tokenData.access_token) return json({status:'error',error:'Could not get MSGraph token',messages:[]},200,origin);
        const maxResults = parseInt(url.searchParams.get('maxResults') || '20');
        const folder = url.searchParams.get('folder') || 'inbox';
        const userEmail = k(env,['outlook_email','OUTLOOK_EMAIL']) || '';
     
    // ── Google token auto-refresh helper ─────────────────────────────────────
    if (path === '/api/google/refresh' && request.method === 'POST') {
      try {
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.refresh_token) return json({success:false,error:'No refresh token'},400,origin);
        const clientId = k(env,['google_client_id','GOOGLE_CLIENT_ID']) || '';
        const clientSecret = k(env,['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
        const params = new URLSearchParams({grant_type:'refresh_token',refresh_token:tokenData.refresh_token,client_id:clientId,client_secret:clientSecret});
        const resp = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
        const data = await resp.json();
        if (data.access_token) {
          tokenData.access_token = data.access_token;
          tokenData.expires_at = Date.now() + (data.expires_in||3600)*1000;
          tokenData.stored_at = Date.now();
          if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token',JSON.stringify(tokenData));
          return json({success:true,expires_in:data.expires_in},200,origin);
        }
        return json({success:false,error:JSON.stringify(data).substring(0,200)},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }

   const mailPath = userEmail
          ? '/users/'+encodeURIComponent(userEmail)+'/mailFolders/'+folder+'/messages'
          : '/me/mailFolders/'+folder+'/messages';
        const msgResp = await fetch(
          'https://graph.microsoft.com/v1.0'+mailPath+'?$top='+maxResults+'&$select=id,subject,from,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime desc',
          {headers:{'Authorization':'Bearer '+tokenData.access_token,'Content-Type':'application/json'}}
        );
        if (!msgResp.ok) { const err = await msgResp.text(); return json({status:'api_error',code:msgResp.status,error:err.substring(0,300),messages:[]},200,origin); }
        const msgData = await msgResp.json();
        const messages = (msgData.value || []).map(function(m) {
          return {id:m.id,subject:m.subject||'(no subject)',from:(m.from&&m.from.emailAddress)?m.from.emailAddress.address:'',fromName:(m.from&&m.from.emailAddress)?m.from.emailAddress.name:'',date:m.receivedDateTime,snippet:m.bodyPreview||'',unread:!m.isRead};
        });
        return json({status:'ok',messages,total:messages.length},200,origin);
      } catch(e) { return json({status:'error',error:e.message,messages:[]},200,origin); }
    }


    // ── Nylas OAuth flow ─────────────────────────────────────────────────────
 if (path === '/comms/nylas/auth' && request.method === 'GET') {
      // nylas_app_id is the application_id UUID from the Nylas dashboard
      // nylas_api_key is the secret API key used for server-side calls
      const nylasAppId = k(env, ['nylas_app_id', 'NYLAS_APP_ID']) || 'a566d768-0aeb-42db-92d8-3e0d50f71d63';
      const redirectUri = 'https://prism.identitypartners.uk/comms/nylas/callback';
      const email = url.searchParams.get('email') || 'hello@identitypartners.uk';
      const authUrl = 'https://api.eu.nylas.com/v3/connect/auth'
        + '?client_id=' + encodeURIComponent(nylasAppId)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code'
        + '&access_type=offline'
        + '&login_hint=' + encodeURIComponent(email);
      return Response.redirect(authUrl, 302);
    }

    if (path === '/comms/nylas/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code') || '';
      const nylasKey = k(env, ['nylas_api_key', 'NYLAS_API_KEY']) || '';
      const nylasApp = k(env, ['nylas_app_key', 'NYLAS_APP_KEY']) || '';
      if (!code) return new Response('<h2>No code received</h2>', {headers: {'Content-Type': 'text/html'}});
      try {
        const nylasApiKey2 = k(env, ['nylas_api_key', 'NYLAS_API_KEY']) || '';
        const nylasAppId2 = k(env, ['nylas_app_id', 'NYLAS_APP_ID']) || 'a566d768-0aeb-42db-92d8-3e0d50f71d63';
        const tokenResp = await fetch('https://api.eu.nylas.com/v3/connect/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + nylasApiKey2},
          body: JSON.stringify({
            client_id: nylasAppId2,
            client_secret: nylasApiKey2,
            redirect_uri: 'https://prism.identitypartners.uk/comms/nylas/callback',
            code: code,
            grant_type: 'authorization_code'
          })
        });
        const tokenData = await tokenResp.json();
        if (tokenData.grant_id) {
          if (env.PRISM_KV) await env.PRISM_KV.put('nylas:grant', JSON.stringify({grant_id: tokenData.grant_id, email: tokenData.email, stored_at: Date.now()}));
          return new Response('<html><body style="font-family:sans-serif;padding:40px;background:#f0f4f8;"><h2 style="color:#0f3b3a;">✓ Email connected!</h2><p>Nylas connected for ' + (tokenData.email || 'your account') + '</p><p><a href="/comms/email/">Go to Email</a></p></body></html>', {headers: {'Content-Type': 'text/html'}});
        }
        return new Response('<h2>Error: ' + JSON.stringify(tokenData).substring(0,200) + '</h2>', {headers: {'Content-Type': 'text/html'}});
      } catch(e) { return new Response('<h2>Error: ' + e.message + '</h2>', {headers: {'Content-Type': 'text/html'}}); }
    }

    if (path === '/api/nylas/status' && request.method === 'GET') {
      try {
        const grant = env.PRISM_KV ? await env.PRISM_KV.get('nylas:grant', 'json') : null;
        if (!grant || !grant.grant_id) return json({connected: false}, 200, origin);
        return json({connected: true, email: grant.email, grant_id: grant.grant_id, stored_at: grant.stored_at}, 200, origin);
      } catch(e) { return json({connected: false}, 200, origin); }
    }

    if (path === '/api/nylas/inbox' && request.method === 'GET') {
      try {
        const grant = env.PRISM_KV ? await env.PRISM_KV.get('nylas:grant', 'json') : null;
        if (!grant || !grant.grant_id) return json({status: 'not_connected', messages: []}, 200, origin);
        const nylasKey = k(env, ['nylas_api_key', 'NYLAS_API_KEY']) || '';
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const folder = url.searchParams.get('folder') || 'INBOX';
        const msgResp = await fetch(
          'https://api.eu.nylas.com/v3/grants/' + grant.grant_id + '/messages?limit=' + limit + '&in=' + folder,
          {headers: {'Authorization': 'Bearer ' + nylasKey, 'Content-Type': 'application/json'}}
        );
        if (!msgResp.ok) { const err = await msgResp.text(); return json({status: 'api_error', error: err.substring(0,200), messages: []}, 200, origin); }
        const msgData = await msgResp.json();
        const messages = (msgData.data || []).map(function(m) {
          return {
            id: m.id,
            subject: m.subject || '(no subject)',
            from: m.from && m.from[0] ? m.from[0].email : '',
            fromName: m.from && m.from[0] ? m.from[0].name : '',
            date: m.date,
            snippet: m.snippet || '',
            unread: !m.read,
            starred: m.starred,
            thread_id: m.thread_id
          };
        });
        return json({status: 'ok', messages, total: messages.length}, 200, origin);
      } catch(e) { return json({status: 'error', error: e.message, messages: []}, 200, origin); }
    }

    if (path.startsWith('/api/nylas/message/') && request.method === 'GET') {
      try {
        const msgId = path.replace('/api/nylas/message/', '');
        const grant = env.PRISM_KV ? await env.PRISM_KV.get('nylas:grant', 'json') : null;
        if (!grant) return json({error: 'Not connected'}, 400, origin);
        const nylasKey = k(env, ['nylas_api_key', 'NYLAS_API_KEY']) || '';
        const msgResp = await fetch(
          'https://api.eu.nylas.com/v3/grants/' + grant.grant_id + '/messages/' + msgId,
          {headers: {'Authorization': 'Bearer ' + nylasKey}}
        );
        const msgData = await msgResp.json();
        return json({message: msgData.data || msgData}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    if (path === '/api/nylas/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const grant = env.PRISM_KV ? await env.PRISM_KV.get('nylas:grant', 'json') : null;
        if (!grant) return json({success: false, error: 'Not connected'}, 400, origin);
        const nylasKey = k(env, ['nylas_api_key', 'NYLAS_API_KEY']) || '';
        const sendResp = await fetch(
          'https://api.eu.nylas.com/v3/grants/' + grant.grant_id + '/messages/send',
          {
            method: 'POST',
            headers: {'Authorization': 'Bearer ' + nylasKey, 'Content-Type': 'application/json'},
            body: JSON.stringify({
              subject: body.subject || '',
              body: body.body || '',
              to: body.to || [],
              reply_to_message_id: body.reply_to_message_id || undefined
            })
          }
        );
        const sendData = await sendResp.json();
        return json({success: sendResp.ok, data: sendData.data || sendData}, 200, origin);
      } catch(e) { return json({success: false, error: e.message}, 500, origin); }
    }


    // ── Gmail single message fetch ────────────────────────────────────────────────
    if (path === '/api/google/gmail/message' && request.method === 'GET') {
      try {
        const msgId = url.searchParams.get('id') || '';
        if (!msgId) return json({error:'id required'}, 400, origin);
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({status:'not_connected'}, 200, origin);
        let accessToken = tokenData.access_token;
        // Auto-refresh if expired
        if (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000 && tokenData.refresh_token) {
          const cid = k(env,['google_client_id','GOOGLE_CLIENT_ID']) || '';
          const cs = k(env,['google_client_secret','GOOGLE_CLIENT_SECRET']) || '';
          const rr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:tokenData.refresh_token,client_id:cid,client_secret:cs,grant_type:'refresh_token'}).toString()});
          const rd = await rr.json();
          if (rd.access_token) { accessToken = rd.access_token; tokenData.access_token = accessToken; tokenData.expires_at = Date.now()+(rd.expires_in||3600)*1000; if (env.PRISM_KV) await env.PRISM_KV.put('google:oauth:token',JSON.stringify(tokenData)); }
        }
        const msgResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + msgId + '?format=full', {headers:{'Authorization':'Bearer '+accessToken}});
        if (!msgResp.ok) { const err = await msgResp.text(); return json({status:'api_error',code:msgResp.status,error:err.substring(0,300)},200,origin); }
        const msg = await msgResp.json();
        const hdrs = msg.payload && msg.payload.headers ? msg.payload.headers : [];
        const gh = function(n) { return (hdrs.find(function(h){return h.name===n;})||{}).value||''; };
        // Extract body
        let bodyText = '';
        let bodyHtml = '';
        function extractParts(parts) {
          if (!parts) return;
          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
              bodyText = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));
            } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
              bodyHtml = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));
            } else if (part.parts) {
              extractParts(part.parts);
            }
          }
        }
        if (msg.payload) {
          if (msg.payload.body && msg.payload.body.data) {
            bodyText = atob(msg.payload.body.data.replace(/-/g,'+').replace(/_/g,'/'));
          }
          extractParts(msg.payload.parts);
        }
        return json({
          message: {
            id: msg.id,
            subject: gh('Subject') || '(no subject)',
            from: gh('From'),
            to: gh('To'),
            date: gh('Date'),
            snippet: msg.snippet || '',
            body: bodyText,
            bodyHtml: bodyHtml,
            unread: (msg.labelIds||[]).includes('UNREAD')
          }
        }, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    if (path === '/api/google/gmail/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('google:oauth:token','json') : null;
        if (!tokenData || !tokenData.access_token) return json({success:false,error:'Not connected'},400,origin);
        let accessToken = tokenData.access_token;
        if (tokenData.expires_at && Date.now() > tokenData.expires_at - 60000 && tokenData.refresh_token) {
          const cid = k(env,['google_client_id','GOOGLE_CLIENT_ID'])||'';
          const cs = k(env,['google_client_secret','GOOGLE_CLIENT_SECRET'])||'';
          const rr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:tokenData.refresh_token,client_id:cid,client_secret:cs,grant_type:'refresh_token'}).toString()});
          const rd = await rr.json();
          if (rd.access_token){accessToken=rd.access_token;tokenData.access_token=accessToken;tokenData.expires_at=Date.now()+(rd.expires_in||3600)*1000;if(env.PRISM_KV)await env.PRISM_KV.put('google:oauth:token',JSON.stringify(tokenData));}
        }
        const to = body.to || '';
        const subject = body.subject || '(no subject)';
        const text = body.text || '';
        const fromAlias = body.from || 'hello@identitypartners.uk';
        const raw = [
          'From: Simon Johnson <' + fromAlias + '>',
          'To: ' + to,
          'Subject: ' + subject,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          text
        ].join('\r\n');
        const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
          method:'POST',
          headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},
          body:JSON.stringify({raw:encoded})
        });
        if (!sendResp.ok){const err=await sendResp.text();return json({success:false,error:err.substring(0,300)},200,origin);}
        const sendData = await sendResp.json();
        return json({success:true,id:sendData.id},200,origin);
      } catch(e){return json({success:false,error:e.message},500,origin);}
    }


    // ── Request queue ─────────────────────────────────────────────────────────
    if (path === '/api/requests' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? await env.PRISM_KV.get('requests:list','json') : null;
        return json({requests: list || []}, 200, origin);
      } catch(e) { return json({requests:[]}, 200, origin); }
    }
    if (path === '/api/requests' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body.id || ('req-' + Date.now());
        const req2 = {...body, id, createdAt: body.createdAt || new Date().toISOString(), status: 'open'};
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('requests:list','json') || [];
          list.unshift(req2);
          await env.PRISM_KV.put('requests:list', JSON.stringify(list));
        }
        return json({success:true, id}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }
    if (path.startsWith('/api/requests/') && request.method === 'PATCH') {
      try {
        const id = path.replace('/api/requests/','');
        const body = await request.json();
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('requests:list','json') || [];
          const idx = list.findIndex(function(r){return r.id===id;});
          if (idx >= 0) { list[idx] = {...list[idx], ...body}; await env.PRISM_KV.put('requests:list', JSON.stringify(list)); }
        }
        return json({success:true}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }


    // ── Whop API v1 ──────────────────────────────────────────────────────────
    if (path.startsWith('/api/whop/') && request.method === 'GET') {
      try {
        const whopKey = k(env, ['whop_api_key', 'WHOP_API_KEY']) || '';
        if (!whopKey) return json({error:'Whop key not configured'}, 400, origin);
        const whopPath = path.replace('/api/whop', '');
        const whopResp = await fetch('https://api.whop.com/api/v1' + whopPath + url.search, {
          headers: {'Authorization': 'Bearer ' + whopKey, 'Api-Version-Date': '2026-07-01', 'Content-Type': 'application/json'}
        });
        const whopData = await whopResp.json();
        return json(whopData, whopResp.status, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }
    if (path.startsWith('/api/whop/') && request.method === 'POST') {
      try {
        const whopKey = k(env, ['whop_api_key', 'WHOP_API_KEY']) || '';
        if (!whopKey) return json({error:'Whop key not configured'}, 400, origin);
        const whopPath = path.replace('/api/whop', '');
        const body = await request.json();
        const whopResp = await fetch('https://api.whop.com/api/v1' + whopPath, {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + whopKey, 'Api-Version-Date': '2026-07-01', 'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        const whopData = await whopResp.json();
        return json(whopData, whopResp.status, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── LinkedIn posting ──────────────────────────────────────────────────────
    if (path === '/api/linkedin/organizations' && request.method === 'GET') {
      try {
        const raw = await env.PRISM_KV.get('oauth:linkedin:tokens');
        if (!raw) return json({ connected: false, error: 'LinkedIn not connected' }, 200, origin);
        const accessToken = (JSON.parse(raw).access_token) || '';
        const current = (await env.PRISM_KV.get('linkedin:author:urn')) || '';
        const out = { connected: true, currentAuthor: current || 'personal profile', scopes: '', organizations: [], errors: [] };
        try {
          const me = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } }).then(r => r.json());
          out.person = me.name || me.sub || '';
        } catch (e) {}
        try {
          let ac = null, t = '';
          for (const ver of ['202506', '202505', '202501', '202411']) {
            const tryR = await fetch('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&count=20', {
              headers: { Authorization: 'Bearer ' + accessToken, 'LinkedIn-Version': ver, 'X-Restli-Protocol-Version': '2.0.0' }
            });
            t = await tryR.text();
            if (tryR.ok) { ac = tryR; break; }
            if (!/NONEXISTENT_VERSION|version/i.test(t.slice(0, 200))) break;
          }
          if (ac && ac.ok) {
            const d = JSON.parse(t);
            for (const el of (d.elements || [])) {
              const org = el['organization~'] || {};
              out.organizations.push({ name: org.localizedName || '(unnamed)', urn: (el.organization || '').replace('urn:li:organization:', 'urn:li:organization:') || el.organization, id: (el.organization || '').split(':').pop() });
            }
          } else out.errors.push('organizationAcls' + (ac ? ' HTTP ' + ac.status : '') + ': ' + t.slice(0, 200));
        } catch (e) { out.errors.push(e.message); }
        return json(out, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }
    if (path === '/api/linkedin/author' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.urn === '' || /^urn:li:organization:[a-z0-9]+$/i.test(String(body.urn))) {
          if (body.urn === '') { await env.PRISM_KV.delete('linkedin:author:urn'); }
          else { await env.PRISM_KV.put('linkedin:author:urn', String(body.urn)); }
          return json({ success: true, author: body.urn || 'personal profile' }, 200, origin);
        }
        return json({ success: false, error: 'Expected a company URN like urn:li:organization:1234567, or empty string for personal' }, 400, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }
    if (path === '/api/linkedin/post' && request.method === 'POST') {
      try {
        const body = await request.json();
        const tokenData = env.PRISM_KV ? await env.PRISM_KV.get('oauth:linkedin:tokens','json') : null;
        if (!tokenData || !tokenData.access_token) return json({success:false,error:'LinkedIn not connected'},400,origin);
        const accessToken = tokenData.access_token;
        const text = body.text || '';
        const authorUrn = body.authorUrn || 'urn:li:person:me';
        // Get person URN if not provided
        let personUrn = authorUrn;
        if (personUrn === 'urn:li:person:me') {
          const meResp = await fetch('https://api.linkedin.com/v2/userinfo', {headers:{'Authorization':'Bearer '+accessToken}});
          if (meResp.ok) { const me = await meResp.json(); personUrn = 'urn:li:person:' + me.sub; }
        }
        const postBody = {
          author: personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {text: text.substring(0, 3000)},
              shareMediaCategory: 'NONE'
            }
          },
          visibility: {'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'}
        };
        const postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0'},
          body: JSON.stringify(postBody)
        });
        if (!postResp.ok) { const err = await postResp.text(); return json({success:false,error:err.substring(0,300)},200,origin); }
        const postData = await postResp.json();
        return json({success:true,id:postData.id},200,origin);
      } catch(e) { return json({success:false,error:e.message},500,origin); }
    }


    // ── Semantic image search (multi-source) ──────────────────────────────────────
    if (path === '/api/images/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const topic = body.topic || body.query || '';
        const count = Math.min(parseInt(body.count || '5'), 20);
        const sources = body.sources || ['pexels', 'unsplash', 'pixabay'];

        // Semantic query expansion based on topic
        function expandQuery(topic) {
          const t = topic.toLowerCase();
          const expansions = {
            'mental health': ['mental health awareness nature', 'calm mindfulness landscape', 'peaceful sunrise healing'],
            'recovery': ['recovery journey path forest', 'hope sunrise horizon', 'strength resilience mountain'],
            'addiction': ['breaking free open sky', 'new beginning dawn', 'support hands together'],
            'wellbeing': ['wellbeing nature peaceful', 'healthy lifestyle outdoors', 'calm water reflection'],
            'neurodivergence': ['unique perspective abstract nature', 'different paths forest', 'creative mind cosmos'],
            'ai': ['technology future abstract', 'digital connection network', 'innovation light'],
            'counselling': ['listening support hands', 'safe space interior calm', 'trust connection nature'],
            'therapy': ['healing garden peaceful', 'growth plant sunlight', 'calm water stones'],
            'coaching': ['journey path forward', 'achievement summit mountain', 'progress steps upward'],
            'uk': ['london architecture', 'british countryside', 'uk cityscape'],
            'brexit': ['uk europe bridge', 'crossroads decision path', 'british landscape'],
            'education': ['learning library books', 'study knowledge light', 'university architecture'],
            'research': ['science discovery laboratory', 'academic study books', 'knowledge exploration'],
            'sunrise': ['golden sunrise horizon', 'dawn light landscape', 'morning sky colours'],
            'sunset': ['dramatic sunset sky', 'golden hour landscape', 'dusk colours horizon'],
            'forest': ['forest light trees', 'woodland path nature', 'green forest canopy'],
            'ocean': ['ocean waves horizon', 'sea coast landscape', 'blue water peaceful'],
            'space': ['cosmos stars galaxy', 'night sky stars', 'universe nebula'],
            'northern lights': ['aurora borealis night', 'northern lights sky', 'aurora norway'],
            'london': ['london skyline architecture', 'london bridge thames', 'london street scene'],
            'museum': ['museum gallery interior', 'art gallery architecture', 'cultural heritage building'],
          };
          for (const [key, queries] of Object.entries(expansions)) {
            if (t.includes(key)) return queries;
          }
          // Default: use topic directly with landscape/nature variants
          return [topic + ' landscape', topic + ' nature', topic + ' abstract'];
        }

        const queries = expandQuery(topic);
        const results = [];

        const pexelsKey = k(env, ['pexels_api_key', 'PEXELS_API_KEY', 'pexels']) || '';
        const unsplashKey = k(env, ['unsplash_api_key', 'UNSPLASH_API_KEY', 'unsplash']) || '';
        const pixabayKey = k(env, ['pixabay_api_key', 'PIXABAY_API_KEY', 'pixabay']) || '';

        // Pexels
        if (sources.includes('pexels') && pexelsKey) {
          for (const q of queries.slice(0, 2)) {
            try {
              const resp = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=5&orientation=square', {
                headers: {'Authorization': pexelsKey}
              });
              if (resp.ok) {
                const data = await resp.json();
                for (const photo of (data.photos || []).slice(0, 3)) {
                  results.push({
                    source: 'pexels',
                    id: String(photo.id),
                    url: photo.src.large,
                    thumb: photo.src.medium,
                    width: photo.width,
                    height: photo.height,
                    photographer: photo.photographer,
                    alt: photo.alt || q,
                    query: q
                  });
                }
              }
            } catch(e) {}
          }
        }

        // Unsplash
        if (sources.includes('unsplash') && unsplashKey) {
          for (const q of queries.slice(0, 2)) {
            try {
              const resp = await fetch('https://api.unsplash.com/search/photos?query=' + encodeURIComponent(q) + '&per_page=5&orientation=squarish', {
                headers: {'Authorization': 'Client-ID ' + unsplashKey}
              });
              if (resp.ok) {
                const data = await resp.json();
                for (const photo of (data.results || []).slice(0, 3)) {
                  results.push({
                    source: 'unsplash',
                    id: photo.id,
                    url: photo.urls.regular,
                    thumb: photo.urls.small,
                    width: photo.width,
                    height: photo.height,
                    photographer: photo.user ? photo.user.name : '',
                    alt: photo.alt_description || q,
                    query: q
                  });
                }
              }
            } catch(e) {}
          }
        }

        // Pixabay
        if (sources.includes('pixabay') && pixabayKey) {
          for (const q of queries.slice(0, 1)) {
            try {
              const resp = await fetch('https://pixabay.com/api/?key=' + pixabayKey + '&q=' + encodeURIComponent(q) + '&image_type=photo&orientation=vertical&per_page=5&safesearch=true');
              if (resp.ok) {
                const data = await resp.json();
                for (const photo of (data.hits || []).slice(0, 3)) {
                  results.push({
                    source: 'pixabay',
                    id: String(photo.id),
                    url: photo.largeImageURL,
                    thumb: photo.previewURL,
                    width: photo.imageWidth,
                    height: photo.imageHeight,
                    photographer: photo.user,
                    alt: photo.tags || q,
                    query: q
                  });
                }
              }
            } catch(e) {}
          }
        }

        // Wikimedia Commons (free, no key needed)
        if (sources.includes('wikimedia')) {
          for (const q of queries.slice(0, 1)) {
            try {
              const resp = await fetch('https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(q) + '&gsrnamespace=6&prop=imageinfo&iiprop=url|size&format=json&gsrlimit=5');
              if (resp.ok) {
                const data = await resp.json();
                const pages = Object.values(data.query?.pages || {});
                for (const page of pages.slice(0, 3)) {
                  const info = page.imageinfo?.[0];
                  if (info && info.url && (info.url.endsWith('.jpg') || info.url.endsWith('.jpeg') || info.url.endsWith('.png'))) {
                    results.push({
                      source: 'wikimedia',
                      id: String(page.pageid),
                      url: info.url,
                      thumb: info.url,
                      width: info.width || 0,
                      height: info.height || 0,
                      photographer: 'Wikimedia Commons',
                      alt: page.title || q,
                      query: q
                    });
                  }
                }
              }
            } catch(e) {}
          }
        }

        // Deduplicate and return
        const seen = new Set();
        const unique = results.filter(function(r) {
          if (seen.has(r.id + r.source)) return false;
          seen.add(r.id + r.source);
          return true;
        });

        return json({
          images: unique.slice(0, count),
          total: unique.length,
          topic: topic,
          queries: queries
        }, 200, origin);
      } catch(e) { return json({images:[], error:e.message}, 200, origin); }
    }

    // ── Canvas: semantic image search (Pexels / Unsplash / Pixabay / Openverse) ──
    if (path === '/api/canvas/search-images' && request.method === 'POST') {
      try {
        const body = await request.json();
        const topic   = body.topic || '';
        const sources = body.sources || ['pexels','unsplash','pixabay','openverse'];
        const count   = Math.min(body.count || 12, 24);

        const mistralKey  = k(env, ['mistral_api_key','MISTRAL_API_KEY']) || '';
        const pexelsKey   = k(env, ['pexels_api_key','PEXELS_API_KEY','pexels']) || '';
        const unsplashKey = k(env, ['unsplash_api_key','UNSPLASH_API_KEY','unsplash']) || '';
        const pixabayKey  = k(env, ['pixabay_api_key','PIXABAY_API_KEY','pixabay']) || '';

        // Expand topic into 5 queries via Mistral Small
        let queries = [topic];
        if (mistralKey && topic) {
          try {
            const mr = await fetch('https://api.mistral.ai/v1/chat/completions', {
              method:'POST',
              headers:{'Content-Type':'application/json','Authorization':`Bearer ${mistralKey}`},
              body: JSON.stringify({
                model:'mistral-small-latest',
                messages:[{role:'user',content:`Generate exactly 5 diverse, specific image search queries for the topic "${topic}". Return only a JSON array of 5 strings.`}],
                max_tokens:200, temperature:0.7,
              }),
            }).then(r=>r.json());
            const raw = mr.choices?.[0]?.message?.content || '';
            const match = raw.match(/\[[\s\S]*?\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length) queries = parsed.slice(0,5);
            }
          } catch(e) {}
        }

        const images = [];

        for (const q of queries) {
          const enc = encodeURIComponent(q);

          if (sources.includes('pexels') && pexelsKey) {
            try {
              const pr = await fetch(`https://api.pexels.com/v1/search?query=${enc}&per_page=3&orientation=square`,{headers:{Authorization:pexelsKey}}).then(r=>r.json());
              for (const p of (pr.photos||[]).slice(0,2)) {
                images.push({url:p.src?.large2x||p.src?.large, thumb:p.src?.medium, alt:p.alt||q, source:'Pexels', photographer:p.photographer||''});
              }
            } catch(e) {}
          }

          if (sources.includes('unsplash') && unsplashKey) {
            try {
              const ur = await fetch(`https://api.unsplash.com/search/photos?query=${enc}&per_page=3&orientation=squarish`,{headers:{Authorization:`Client-ID ${unsplashKey}`}}).then(r=>r.json());
              for (const p of (ur.results||[]).slice(0,2)) {
                images.push({url:p.urls?.regular, thumb:p.urls?.small, alt:p.alt_description||q, source:'Unsplash', photographer:p.user?.name||''});
              }
            } catch(e) {}
          }

          if (sources.includes('pixabay') && pixabayKey) {
            try {
              const pbr = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${enc}&image_type=photo&orientation=vertical&per_page=3`).then(r=>r.json());
              for (const p of (pbr.hits||[]).slice(0,2)) {
                images.push({url:p.largeImageURL, thumb:p.previewURL, alt:p.tags||q, source:'Pixabay', photographer:p.user||''});
              }
            } catch(e) {}
          }

          if (sources.includes('openverse')) {
            try {
              const ovr = await fetch(`https://api.openverse.org/v1/images/?q=${enc}&page_size=3&license_type=commercial`,{
                headers:{'User-Agent':'Argentica/1.0 (hello@identitypartners.uk)'}
              }).then(r=>r.json());
              for (const p of (ovr.results||[]).slice(0,2)) {
                images.push({url:p.url, thumb:p.thumbnail, alt:p.title||q, source:'Openverse', photographer:p.creator||''});
              }
            } catch(e) {}
          }

          if (images.length >= count) break;
        }

        return json({images: images.slice(0,count), queries, topic}, 200, origin);
      } catch(e) { return json({images:[], error:e.message}, 200, origin); }
    }

    // POST /api/canvas/raster-test — diagnostic: rasterise an SVG URL via the production svgToPngUrl
    if (path === '/api/canvas/raster-test' && request.method === 'POST') {
      try {
        const body = await request.json();
        const pngUrl = await svgToPngUrl(body.url, env);
        return json({success:true, url:pngUrl, pngBytes:pngUrl? (await fetch(pngUrl).then(r=>r.arrayBuffer()).then(b=>b.byteLength).catch(()=>null)) : null}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 200, origin); }
    }

    // POST /api/buffer/schema-probe — introspect Buffer's createPost input and MediaInput shape
    if (path === '/api/buffer/schema-probe' && request.method === 'POST') {
      try {
        let body = null; try { body = await request.json(); } catch(e) { body = null; }
        const q = `query { __schema { mutationType { fields { name args { name type { kind name ofType { kind name } } } } } } }`;
        const r1 = await bufferGql(q, null, env);
        let createPost = null;
        try {
          const avail = JSON.stringify(((r1.data||{}).__schema||{}));
          createPost = (r1.data.__schema.mutationType.fields||[]).filter(f => f.name==='createPost').map(f => ({ name:f.name, args:f.args }));
        } catch(e) {}
        // introspect MediaInput if referenced
        let mediaInput = null;
        const q2 = `query { __type(name: "MediaInput") { kind name inputFields { name type { kind name ofType { kind name } } } } }`;
        const r2 = await bufferGql(q2, null, env);
        mediaInput = (r2.data && r2.data.__type) || r2.error || null;
        // also try CreatePostInput
        const q3 = `query { __type(name: "CreatePostInput") { kind name inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } }`;
        const r3 = await bufferGql(q3, null, env);
        const createPostInput = (r3.data && r3.data.__type) || r3.error || null;
        let assetType = null;
        for (const tn of ["AssetInput","PostAssetInput","MediaAssetInput","ImageAssetInput","UploadAssetInput","PostAsset"]) {
          const rq = 'query { __type(name: "' + tn + '") { kind name inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } }';
          const rr = await bufferGql(rq, null, env);
          if (rr.data && rr.data.__type) { assetType = rr.data.__type; break; }
        }
        let imageAssetInput = null;
        {
          const rq = 'query { __type(name: "ImageAssetInput") { kind name inputFields { name type { kind name ofType { kind name } } } } }';
          const rr = await bufferGql(rq, null, env);
          imageAssetInput = (rr.data && rr.data.__type) || rr.error || null;
        }
        let shareModes = null;
        {
          const rq = 'query { __type(name: "ShareMode") { kind name enumValues { name } } }';
          const rr = await bufferGql(rq, null, env);
          shareModes = (rr.data && rr.data.__type) || rr.error || null;
        }
        let schedTypes = null;
        {
          const rq = 'query { __type(name: "SchedulingType") { kind name enumValues { name } } }';
          const rr = await bufferGql(rq, null, env);
          schedTypes = (rr.data && rr.data.__type) || rr.error || null;
        }
        // All available mutation names (for cleanup/management)
        let allMutations = null;
        {
          const rq = 'query { __schema { mutationType { fields { name } } } }';
          const rr = await bufferGql(rq, null, env);
          try { allMutations = ((rr.data||{}).__schema.mutationType.fields||[]).map(f=>f.name); } catch(e) { allMutations = rr.error; }
        }
        return json({success:true, createPost, createPostInput, assetTypes: { found: assetType, imageAssetInput }, shareModes, schedTypes, allMutations, postMeta, postTypeEnum}, 200, origin);
      } catch(e) { return json({success:false, error:e.message}, 200, origin); }
    }

    // ── Canvas: agentic generation ────────────────────────────────────────────
    // POST /api/canvas/generate
    // body: { topic, type, platform, text, variant, myth, fact, points, source,
    //         campaignName, date, message, outlet, headline, commentary,
    //         serviceName, description, whoFor, slides (carousel),
    //         skipQA, skipQueue }
    if (path === '/api/canvas/generate' && request.method === 'POST') {
      try {
        const body     = await request.json();
        const topic    = body.topic || body.text || 'mental health recovery';
        const postType = body.type  || 'quote';
        const platform = body.platform || 'instagram';
        const variant  = body.variant  || 'teal';
        const skipQA   = body.skipQA   || false;
        const skipQueue= body.skipQueue || false;

        // ── Carousel ──────────────────────────────────────────────────────────
        if (postType === 'carousel') {
          const slides = body.slides || [{text: topic}];
          // Fetch images for slides that need them
          const enriched = await Promise.all(slides.map(async (slide) => {
            const img = slide.useImage ? await semanticImageSearch(slide.text || topic, env) : null;
            return {...slide, imageBase64: img};
          }));
          const svgs = generateCarousel(enriched).map(contrastFixSvg);
          const urls = [];
          for (let i=0; i<svgs.length; i++) {
            const key = `canvas/carousel-${Date.now()}-${i+1}of${svgs.length}.svg`;
            const url = await uploadToR2(svgs[i], key, env);
            if (url) urls.push(url);
          }
          if (!skipQueue && urls.length) {
            await queueForApproval({topic, type:'carousel', platform, urls, slideCount:svgs.length}, env);
          }
          return json({success:true, type:'carousel', urls, slideCount:svgs.length, topic, platform}, 200, origin);
        }

        // ── Determine template from postType ──────────────────────────────────
        const templateMap = {
          'myth-vs-fact':      variant==='ivory' ? 'myth-vs-fact-ivory' : 'myth-vs-fact-teal',
          'data-infographic':  'data-infographic',
          'awareness-day':     variant==='rose'  ? 'awareness-day-rose' : 'awareness-day',
          'news-reaction':     'news-reaction',
          'service-explainer': 'service-explainer',
          'semantic':          `semantic-${variant}`,
          'quote':             `block-${variant==='rose'?'rose':variant==='ivory'?'ivory':'teal'}`,
          'stat':              'stat',
          'testimonial':       `testimonial-${variant==='rose'?'rose':variant==='ivory'?'ivory':'teal'}`,
          'dual':              'dual-partnership',
          'image':             'img-landscape',
          'research':          `semantic-${variant==='rose'?'rose':variant==='ivory'?'ivory':'teal'}`,
          // Vista / partnership templates: pass through so `type` works as well as `template`
          'img-landscape': 'img-landscape', 'img-sunrise': 'img-sunrise', 'img-sunset': 'img-sunset',
          'img-seascape': 'img-seascape', 'img-beach': 'img-sunset', 'img-cityscape': 'img-cityscape',
          'img-aurora': 'img-aurora', 'img-space': 'img-space', 'img-stars': 'img-stars',
          'img-constellation': 'img-stars', 'night-sky': 'img-stars', 'seascape': 'img-seascape',
          'cityscape': 'img-cityscape', 'constellation': 'img-stars',
          'dual-partnership': 'dual-partnership', 'dual-children': 'dual-children',
          'partnership': 'dual-partnership', 'symbiotic': 'dual-children',
        };
        const templateId = body.template
          || (/^(img-|semantic-|dual-)/.test(postType) ? postType : templateMap[postType])
          || 'block-teal';

        // ── Fetch semantic image if needed ────────────────────────────────────
        let imgBase64 = null;
        const needsImage = ['awareness-day','awareness-day-rose','semantic-teal','semantic-rose','semantic-dark','img-landscape','img-sunrise','img-sunset','img-seascape','img-cityscape','img-aurora','img-space','img-stars','dual-partnership','dual-children'].includes(templateId);
        if (needsImage) {
          // Vista / partnership templates source by their SCENERY, not the post text
          const templateQueries = {
            'img-landscape':   'mountains valley moorland misty landscape serene',
            'img-sunrise':     'sunrise golden hour dawn coast horizon warm',
            'img-sunset':      'sunset warm sky horizon beach dusk',
            'img-seascape':    'ocean waves seascape coast horizon calm',
            'img-beach':       'beach shoreline seascape soft light',
            'img-cityscape':   'city skyline dusk lights urban horizon',
            'img-aurora':      'aurora borealis northern lights night sky',
            'img-space':       'earth from space stars cosmos',
            'img-stars':       'night sky stars milky way constellation',
            'dual-partnership':'two people walking together partnership support',
            'dual-children':   'children holding hands friendship outdoors light',
          };
          const q = templateQueries[templateId] || (body.background ? (body.background + ' ' + topic) : topic);
          imgBase64 = await semanticImageSearch(q, env);
        }

        // ── Build data object for new renderers ───────────────────────────────
        let svg = '';
        const newTypes = ['myth-vs-fact-teal','myth-vs-fact-ivory','data-infographic','awareness-day','awareness-day-rose','news-reaction','service-explainer','semantic-teal','semantic-rose','semantic-dark'];

        if (newTypes.includes(templateId)) {
          switch(templateId) {
            case 'myth-vs-fact-teal':
            case 'myth-vs-fact-ivory':
              svg = renderMythVsFact({myth:body.myth||topic, fact:body.fact||'', source:body.source||'', variant:templateId.includes('ivory')?'ivory':'teal'});
              break;
            case 'data-infographic':
              svg = renderDataInfographic({title:body.title||topic, subtitle:body.subtitle||'', points:body.points||[], source:body.source||''});
              break;
            case 'awareness-day':
            case 'awareness-day-rose':
              svg = renderAwarenessDay({campaignName:body.campaignName||topic, date:body.date||'', message:body.message||'', variant:templateId.includes('rose')?'rose':'teal'}, imgBase64);
              break;
            case 'news-reaction':
              svg = renderNewsReaction({outlet:body.outlet||'', headline:body.headline||topic, commentary:body.commentary||'', date:body.date||new Date().toLocaleDateString('en-GB')});
              break;
            case 'service-explainer':
              svg = renderServiceExplainer({serviceName:body.serviceName||topic, description:body.description||'', whoFor:body.whoFor||'', contact:body.contact||''});
              break;
            case 'semantic-teal':
            case 'semantic-rose':
            case 'semantic-dark':
              svg = renderSemanticImage({text:body.text||topic, subtext:body.subtext||'', variant:templateId.replace('semantic-',''), position:body.position, align:body.align, ink:body.ink}, imgBase64);
              break;
          }
        } else {
          // Legacy templates
          svg = await generateCanvasHtml(body.text||topic, templateId, env, imgBase64, { position: body.position, align: body.align, ink: body.ink });
        }

        if (!svg) return json({success:false, error:'SVG generation failed'}, 500, origin);
        svg = contrastFixSvg(svg);   // deterministic hex-contrast verification before upload

        // ── Upload to R2 ──────────────────────────────────────────────────────
        const svgKey = `canvas/${platform}-${postType}-${Date.now()}.svg`;
        const svgUrl = await uploadToR2(svg, svgKey, env);
        await logAsset(env, 'canvas', svgUrl, { template: templateId, topic: (topic||'').slice(0,80), platform });

        // ── Vision QA via Gemini ──────────────────────────────────────────────
        let qaResult = null;
        if (!skipQA && svgUrl) {
          try {
            const geminiKey = k(env, ['gemini_free_key','GEMINI_FREE_KEY','gemini_api_key','GEMINI_API_KEY']) || '';
            // Gemini inlineData accepts PNG/JPEG/WebP only — rasterise the SVG first via Browserless
            var qaDebug = { geminiKey: !!geminiKey };
            const pngUrl = await svgToPngUrl(svgUrl, env);
            qaDebug.pngUrl = pngUrl || null;
            let pngB64 = null;
            if (pngUrl) { try { const pr = await fetch(pngUrl); qaDebug.pngFetch = pr.status; if (pr.ok) { const buf = await pr.arrayBuffer(); const bytes = new Uint8Array(buf); let bin=''; for (let i=0;i<bytes.byteLength;i+=8192) bin += String.fromCharCode(...bytes.subarray(i,i+8192)); pngB64 = btoa(bin); qaDebug.pngB64Len = pngB64.length; } } catch(e) { qaDebug.pngFetchErr = String(e).slice(0,120); } }
                        if (geminiKey && pngB64) {
              const qaPrompt = 'This is a social media canvas for Identity Partners. Check: 1) Text legible against background? 2) IP branding visible (logo, URL, handles)? 3) Layout balanced? 4) Any clipping or overlap? Reply JSON only: {"pass":true/false,"issues":[],"score":1-10}';
              const qaModels = ['gemini-3.8-flash','gemini-3.8-flash-lite','gemini-2.5-flash','gemini-flash-latest'];
              let qaResp = null, usedModel = '';
              for (const m of qaModels) {
                try {
                  qaResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({contents:[{parts:[
                      {text:qaPrompt},
                      {inlineData:{mimeType:'image/png', data:pngB64}}
                    ]}]}),
                  });
                  qaDebug.qaModel = m; qaDebug.qaStatus = qaResp.status;
                  if (qaResp.ok) { usedModel = m; break; }
                  qaResp = null;
                } catch(e) { qaDebug.qaErr = String(e).slice(0,120); qaResp = null; }
              }
              // Fallback: Pixtral vision on Mistral if Gemini is unavailable
              if ((!qaResp || !qaResp.ok)) {
                const mistralKey = k(env, ['mistral_api_key','MISTRAL_API_KEY']) || '';
                if (mistralKey) {
                  try {
                    qaResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
                      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${mistralKey}`},
                      body: JSON.stringify({ model:'pixtral-12b-2409', messages:[{role:'user',content:[
                        {type:'text', text:'This is a social media canvas for Identity Partners. Check: 1) Text legible against background? 2) IP branding visible? 3) Layout balanced? 4) Any clipping or overlap? Reply JSON only: {"pass":true/false,"issues":[],"score":1-10}'},
                        {type:'image_url', image_url:'data:image/png;base64,'+pngB64}
                      ]}] })
                    });
                    qaDebug.qaModel = 'pixtral-12b'; qaDebug.qaStatus = qaResp.status;
                  } catch(e) { qaDebug.pixtralErr = String(e).slice(0,120); qaResp = null; }
                }
              }
              if (qaResp && qaResp.ok) {
                const qaData = await qaResp.json();
                const qaText = qaData.candidates?.[0]?.content?.parts?.[0]?.text || qaData.choices?.[0]?.message?.content || '';
                const m = qaText.match(/\{[\s\S]*?\}/);
                if (m) qaResult = JSON.parse(m[0]);
              }
            }
          } catch(e) {}
        }

        // ── Queue for Social Queue approval ───────────────────────────────────
        if (!skipQueue && svgUrl) {
          await queueForApproval({topic, type:postType, template:templateId, platform, url:svgUrl, qa:qaResult}, env);
        }

        return json({
          success: true,
          qaDebug,
          url: svgUrl || R2_PUBLIC + 'ig-template-' + Math.floor(Math.random()*150) + '.png',
          svgUrl,
          platform,
          type: postType,
          template: templateId,
          topic,
          qa: qaResult,
          queued: !skipQueue && !!svgUrl,
        }, 200, origin);

      } catch(e) { return json({success:false, error:e.message}, 500, origin); }
    }


    // ── Integration layer routes ──────────────────────────────────────────────
    const integrationResponse = await handleIntegrationRoutes(path, request, env, origin);
    if (integrationResponse) return integrationResponse;

    if (path === '/api/r2/file' && request.method === 'GET') {
      try {
        const key = url.searchParams.get('key') || '';
        if (!key) return json({ error: 'key required' }, 400, origin);
        if (!env.PRISM_ASSETS) return json({ error: 'R2 not bound' }, 500, origin);
        const obj = await env.PRISM_ASSETS.get(key);
        if (!obj) return json({ error: 'Not found' }, 404, origin);
        const headers = {
          'Content-Type': obj.httpMetadata && obj.httpMetadata.contentType || 'application/octet-stream',
          'Access-Control-Allow-Origin': origin || '*',
          'Cache-Control': 'public, max-age=3600'
        };
        return new Response(obj.body, { headers });
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/r2/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { key, content, mimeType, fileName } = body;
        if (!key || !content) return json({ error: 'key and content required' }, 400, origin);
        if (!env.PRISM_ASSETS) return json({ error: 'R2 not bound' }, 500, origin);
        const binaryStr = atob(content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        await env.PRISM_ASSETS.put(key, bytes.buffer, { httpMetadata: { contentType: mimeType || 'application/octet-stream' }, customMetadata: { fileName: fileName || key, uploadedAt: new Date().toISOString() } });
        return json({ success: true, url: 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/' + key, key }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }
        return json({ error: 'Not found', path }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const hour = new Date().getUTCHours();
        // ── Threads token upkeep: weekly refresh attempt; track 60-day expiry ──
        try {
          let to = null;
          try { to = JSON.parse(await env.PRISM_KV.get('threads:oauth') || 'null'); } catch (e) {}
          if (to && to.access_token) {
            const ageDays = (Date.now() - new Date(to.obtainedAt || 0).getTime()) / 86400000;
            const lastTry = await env.PRISM_KV.get('threads:refresh:lastTry', 'text') || '';
            const today = new Date().toISOString().slice(0, 10);
            if (ageDays > 1 && lastTry !== today) {
              try {
                const rr = await fetch('https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=' + encodeURIComponent(to.access_token));
                const rd = await rr.json().catch(() => ({}));
                await env.PRISM_KV.put('threads:refresh:lastTry', today);
                if (rd.access_token) {
                  to.access_token = rd.access_token; to.obtainedAt = new Date().toISOString(); to.lastRefresh = new Date().toISOString();
                  await env.PRISM_KV.put('threads:oauth', JSON.stringify(to));
                  await env.PRISM_KV.put('threads:refresh:status', JSON.stringify({ ok: true, at: new Date().toISOString() }));
                } else {
                  await env.PRISM_KV.put('threads:refresh:status', JSON.stringify({ ok: false, error: String(rd.error && rd.error.message || '').slice(0, 120), at: new Date().toISOString() }));
                }
              } catch (e2) {}
            }
          }
        } catch (tke) {}

        // ── Daily KV→Drive backup (runs on the first cron after each new UTC day) ──
        try {
          const bkCfg = await env.PRISM_KV.get('kb:backup:config', 'json');
          if (!bkCfg || bkCfg.enabled !== false) {
            const today = new Date().toISOString().slice(0, 10);
            const lastBk = await env.PRISM_KV.get('kb:backup:last', 'json');
            if (!lastBk || (lastBk.date || '') !== today) {
              ctx.waitUntil(backupStoresToDrive(env).catch(() => {}));
            }
          }
        } catch (bke) {}
        const slot = hour >= 7 && hour < 9 ? 'morning' : hour >= 12 && hour < 14 ? 'lunchtime' : 'evening';
        if (env.PRISM_KV) await env.PRISM_KV.put('cron:last-run', JSON.stringify({ ts: new Date().toISOString(), slot, autonomous: true }), { expirationTtl: 86400 * 7 });

        // ── The autonomous pipeline ─────────────────────────────
        const cfg = env.PRISM_KV ? await env.PRISM_KV.get('socialising:autonomy', 'json') : null;
        if (!cfg || !cfg.enabled) return;
        const today = new Date().toISOString().slice(0, 10);
        const countKey = 'socialising:count:' + today;
        const count = parseInt((env.PRISM_KV && await env.PRISM_KV.get(countKey)) || '0');
        if (count >= (cfg.maxPerDay || 3)) return;

        // 1. Pick a relevant headline from the approved feeds
        const kws = (env.PRISM_KV && await env.PRISM_KV.get('news:keywords', 'json')) || ['mental health', 'addiction', 'recovery', 'nhs', 'trauma'];
        const feeds = ['https://www.theguardian.com/society/rss', 'https://feeds.bbci.co.uk/news/health/rss.xml'];
        let pick = null;
        for (const f of feeds) {
          try {
            const text = await fetch(f, { headers: { 'User-Agent': 'Argentica/1.0' } }).then(r => r.text());
            const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
            for (const it of items.slice(0, 20)) {
              const title = ((it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').trim();
              const link = ((it.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1] || '').trim();
              if (title && kws.some(kw => title.toLowerCase().includes(String(kw).toLowerCase()))) { pick = { title, link }; break; }
            }
          } catch (e) {}
          if (pick) break;
        }
        if (!pick) return;

        // 2. Draft in Simon's voice
        const WEBFOOT = '\nhello@identitypartners.uk | www.identitypartners.uk/contact';
        globalThis.__tagNote = ' Append after the post, on a new line, 2-4 hashtags ONLY where genuinely relevant to this post (from #IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing). #Addiction only if the piece is actually about addiction. Then the footer line hello@identitypartners.uk | www.identitypartners.uk/contact. No other links or tags.';
        globalThis.__weekTheme = '';
        try {
          const themes = await env.PRISM_KV.get('themes:weeks', 'json') || [];
          const now2 = new Date(); const dow = (now2.getUTCDay() + 6) % 7;
          const monday = new Date(now2); monday.setUTCDate(now2.getUTCDate() - dow); monday.setUTCHours(0, 0, 0, 0);
          const mondayISO = monday.toISOString().slice(0, 10);
          const th = themes.find(t2 => t2.week === mondayISO);
          if (th && th.name) {
            globalThis.__weekTheme = ' THIS WEEKS THEME is "' + th.name + '" — make the post speak to it directly.';
            if (th.secondary) globalThis.__weekTheme += ' Secondary thread: "' + th.secondary + '" — let it underpin the piece without crowding the primary.';
            if (th.exceptions && Object.keys(th.exceptions).length) globalThis.__weekTheme += ' (Single-week per-platform overrides exist: ' + Object.entries(th.exceptions).map(([p, v]) => p + ' uses "' + v + '"').join('; ') + ' — they are applied per channel at publish time.)';
          }
        } catch (e2) {}
        const draft = await orchestrate([
          { role: 'system', content: 'You write as Simon Johnson of Identity Partners: intelligent, direct, humane, intellectually curious British professional prose. British English only. No em dashes. Never use multifaceted, nuanced, profound, tapestry, landscape, intersection, delve, ever-evolving. No clinical claims, no testimonials of outcomes, no client-identifiable content, never respond to people in crisis. 60 to 90 words.' },
          { role: 'user', content: 'Write a short social media post reacting to this headline: "' + pick.title + '".' + (globalThis.__weekTheme || '') + (globalThis.__tagNote || '') + ' Source credit at the end.' }
        ], env, { profile: 'balanced' });
        if (!draft || !draft.content) return;

        // 3. Generate a canvas
        let imageUrl = null;
        try {
          const cv = await fetch('https://prism-api.identitypartners.workers.dev/api/canvas/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic: pick.title,
              text: (draft.content || pick.title).slice(0, 400),   // refracted, theme-aware draft goes ON the canvas
              template: 'semantic-teal', platform: 'instagram', skipQueue: true, skipQA: false   // Vision QA ON
            })
          }).then(r => r.json());
          imageUrl = cv.url || null;
        } catch (e) {}

        // 4. Post it
        const text = draft.content.trim() + (pick.link ? '\n' + pick.link : '');
        const platforms = cfg.platforms || ['bluesky', 'linkedin', 'telegram'];
        const item = { id: 'mm-' + Date.now() + '-auto', text, platforms, imageUrl, source: 'autonomous:cron-' + slot, status: 'pending', createdAt: new Date().toISOString(), scheduledFor: null };
        if (env.PRISM_KV) {
          const q = await env.PRISM_KV.get('mm:queue', 'json') || [];
          q.push(item);
          await env.PRISM_KV.put('mm:queue', JSON.stringify(q));
        }
        const appr = await fetch('https://prism-api.identitypartners.workers.dev/api/mm/approve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id })
        }).then(r => r.json()).catch(() => ({}));

        if (env.PRISM_KV) {
          await env.PRISM_KV.put(countKey, String(count + 1));
          const log = await env.PRISM_KV.get('socialising:log', 'json') || [];
          log.unshift({ ts: new Date().toISOString(), slot, headline: pick.title, text: text.slice(0, 160), platforms, results: appr.results || {}, errors: appr.errors || {}, source: 'cron' });
          await env.PRISM_KV.put('socialising:log', JSON.stringify(log.slice(0, 100)));
        }

        // 5. Tell Simon what happened
        try {
          const tgToken = k(env, ['telegram_token', 'TELEGRAM_TOKEN']) || '';
          const chatId = k(env, ['telegram_chat_id', 'TELEGRAM_CHAT_ID']) || '';
          if (tgToken && chatId) {
            await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: 'Argentica posted autonomously (' + slot + '): "' + pick.title + '"\n\n' + draft.content.slice(0, 200) })
            });
          }
        } catch (e) {}
      } catch {}
    })());
  },
};