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
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
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
  const GEMINI_FREE_KEY = k(env, ['gemini_free_key', 'GEMINI_FREE_KEY']) || GEMINI_KEY; // free tier key, falls back to paid
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
      const result = await callModel(provider, model, key, messages, env);
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

  return {content: null, error: 'All providers unavailable. Log: ' + log.join(' | '), routingLog: log};
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

const LOGO_URL = 'https://prism.identitypartners.uk/shared/assets/logo-square.png';
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
function ipLogo(x=32, y=0) {
  return `<image href="${LOGO_URL}" x="${x}" y="${y}" width="72" height="72" preserveAspectRatio="xMidYMid meet"/>`;
}

// Footer strip — logo + URL + email + handles
function ipFooter(W, H, bg=C.teal, fg=C.ivory) {
  const y = H - 80;
  return `
  <rect x="0" y="${y}" width="${W}" height="80" fill="${bg}"/>
  ${ipLogo(32, y+4)}
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
  const textLines    = wrapWords(data.text||'', 24);
  const subtextLines = data.subtext ? wrapWords(data.subtext, 38) : [];
  const textY    = 620;
  const subtextY = textY + textLines.length*72 + 20;
  return svgOpen(W,H,footerBg) +
    (imgBase64 ? `<image href="${imgBase64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : '') +
    `<defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${footerBg}" stop-opacity="0.12"/><stop offset="45%" stop-color="${footerBg}" stop-opacity="0.52"/><stop offset="100%" stop-color="${footerBg}" stop-opacity="0.94"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#ovg)"/>` +
    `<rect x="60" y="50" width="${W-120}" height="4" fill="${accent}" rx="2" opacity="0.7"/>` +
    `<text x="${W/2}" y="${textY}" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-size="62" font-weight="900" fill="${C.ivory}" letter-spacing="-1">` +
      tspanBlock(textLines, W/2, textY, 74, 'text-anchor="middle"') +
    `</text>` +
    (subtextLines.length ? `<text x="${W/2}" y="${subtextY}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="500" fill="${accent}">` +
      tspanBlock(subtextLines, W/2, subtextY, 34, 'text-anchor="middle"') +
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
async function generateCanvasHtml(text, templateId, env) {
  const PEXELS_KEY = k(env, ['pexels_api_key', 'PEXELS_API_KEY', 'pexels']) || '';

  const TEMPLATES = {
    'block-teal':   { type:'block',  bg:C.teal,  fg:C.ivory, accent:C.grey,  border:C.rose },
    'block-rose':   { type:'block',  bg:C.rose,  fg:C.ivory, accent:C.grey,  border:C.teal },
    'block-ivory':  { type:'block',  bg:C.ivory, fg:C.teal,  accent:C.rose,  border:C.teal },
    'block-grey':   { type:'block',  bg:C.grey,  fg:C.teal,  accent:C.rose,  border:C.teal },
    'block-teal2':  { type:'block',  bg:C.teal2, fg:C.ivory, accent:C.grey,  border:C.rose2 },
    'block-rose2':  { type:'block',  bg:C.rose2, fg:C.ivory, accent:C.grey,  border:C.teal2 },
    'block-split':  { type:'block-split', bg1:C.teal, bg2:C.rose, fg:C.ivory },
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

  function ipLogoLegacy(x,y) { return `<image href="${LOGO_URL}" x="${x}" y="${y}" width="72" height="72" preserveAspectRatio="xMidYMid meet"/>`; }
  function ipWordmark(cx,y) { return `<text x="${cx-100}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${C.tealLight}" text-anchor="middle">Identity</text><text x="${cx+100}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="30" font-weight="600" fill="${C.roseLight}" text-anchor="middle">Partners</text>`; }
  function ipTagline(cx,y) { return `<text x="${cx}" y="${y}" font-family="'Playfair Display',Georgia,serif" font-size="16" fill="${C.grey}" text-anchor="middle" opacity="0.85">Understand your past · Appreciate the present · Define your future</text>`; }
  function ipFooterLegacy(cx,y) { return `<text x="${cx}" y="${y}" font-family="Arial,sans-serif" font-size="15" fill="${C.grey}" text-anchor="middle" opacity="0.8">www.identitypartners.uk · hello@identitypartners.uk · @identitypartners</text>`; }
  function quoteText(lines,startY,lineH,fg) { return lines.map((l,i)=>`<text x="540" y="${startY+i*lineH}" font-family="'Playfair Display',Georgia,serif" font-size="48" fill="${fg}" text-anchor="middle">${l}</text>`).join(''); }

  let svg = '';

  if (tmpl.type==='block') {
    const lines=wrapText(safeText,28), lineH=68, startY=Math.max(220,540-(lines.length*lineH)/2), attrY=startY+lines.length*lineH+40;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg}"/><rect x="0" y="0" width="${W}" height="12" fill="${tmpl.border}" opacity="0.9"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${tmpl.border}" opacity="0.9"/>`+ipLogoLegacy(30,30)+`<text x="80" y="210" font-family="'Playfair Display',Georgia,serif" font-size="110" fill="${tmpl.fg}" opacity="0.08">&#x201C;</text>`+quoteText(lines,startY,lineH,tmpl.fg)+`<line x1="380" y1="${attrY}" x2="700" y2="${attrY}" stroke="${tmpl.accent}" stroke-width="2" opacity="0.6"/>`+ipWordmark(540,attrY+48)+ipTagline(540,attrY+82)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='block-split') {
    const lines=wrapText(safeText,26), lineH=64, startY=Math.max(200,540-(lines.length*lineH)/2), attrY=startY+lines.length*lineH+40;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg1}"/><rect x="540" y="0" width="540" height="${H}" fill="${tmpl.bg2}"/><line x1="540" y1="0" x2="540" y2="${H}" stroke="${C.grey}" stroke-width="2" opacity="0.4"/>`+ipLogoLegacy(30,30)+quoteText(lines,startY,lineH,tmpl.fg)+ipWordmark(540,attrY+48)+ipTagline(540,attrY+82)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='image') {
    const imgData=await fetchPexelsImage(tmpl.query), lines=wrapText(safeText,28), lineH=68, startY=Math.max(220,540-(lines.length*lineH)/2), attrY=startY+lines.length*lineH+40;
    const bgEl=imgData?`<image href="${imgData}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${tmpl.overlay}"/>`:`<rect width="${W}" height="${H}" fill="${C.teal}"/>`;
    svg=svgO+bgEl+`<rect x="0" y="0" width="${W}" height="12" fill="${C.grey}" opacity="0.8"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${C.grey}" opacity="0.8"/>`+ipLogoLegacy(30,30)+`<text x="80" y="210" font-family="'Playfair Display',Georgia,serif" font-size="110" fill="${C.ivory}" opacity="0.08">&#x201C;</text>`+quoteText(lines,startY,lineH,C.ivory)+`<line x1="380" y1="${attrY}" x2="700" y2="${attrY}" stroke="${C.grey}" stroke-width="2" opacity="0.65"/>`+ipWordmark(540,attrY+48)+ipTagline(540,attrY+82)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else if (tmpl.type==='testimonial') {
    const lines=wrapText(safeText,30), lineH=62, startY=Math.max(240,520-(lines.length*lineH)/2), attrY=startY+lines.length*lineH+50;
    svg=svgO+`<rect width="${W}" height="${H}" fill="${tmpl.bg}"/><rect x="0" y="0" width="${W}" height="12" fill="${tmpl.accent}" opacity="0.9"/><rect x="0" y="${H-12}" width="${W}" height="12" fill="${tmpl.accent}" opacity="0.9"/>`+ipLogoLegacy(30,30)+`<text x="100" y="260" font-family="'Playfair Display',Georgia,serif" font-size="180" fill="${tmpl.accent}" opacity="0.15">&#x201C;</text><text x="980" y="${H-80}" font-family="'Playfair Display',Georgia,serif" font-size="180" fill="${tmpl.accent}" opacity="0.15">&#x201D;</text>`+quoteText(lines,startY,lineH,tmpl.fg)+`<line x1="340" y1="${attrY}" x2="740" y2="${attrY}" stroke="${tmpl.accent}" stroke-width="3" opacity="0.7"/><text x="540" y="${attrY+44}" font-family="'Playfair Display',Georgia,serif" font-size="22" fill="${tmpl.accent}" text-anchor="middle" opacity="0.9">&#x2014; Identity Partners</text>`+ipWordmark(540,attrY+90)+ipFooterLegacy(540,H-28)+`</svg>`;
  } else {
    svg=svgO+`<rect width="${W}" height="${H}" fill="${C.teal}"/>`+ipLogoLegacy(30,30)+quoteText(wrapText(safeText,28),300,68,C.ivory)+ipFooterLegacy(540,H-28)+`</svg>`;
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
    if (from) filtered = filtered.filter(e => e.scheduledFor >= from);
    if (to)   filtered = filtered.filter(e => e.scheduledFor <= to);
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

async function fetchBufferChannels(env) {
  const bufferKey = k(env, ['buffer_api_key','BUFFER_API_KEY']) || '';
  if (!bufferKey) return { error: 'No Buffer API key' };
  try {
    const resp = await fetch('https://api.bufferapp.com/1/profiles.json', {
      headers: { Authorization: `Bearer ${bufferKey}` }
    });
    if (!resp.ok) return { error: `Buffer API ${resp.status}` };
    const profiles = await resp.json();
    const channels = {};
    for (const p of profiles) {
      const platform = p.service || p.formatted_service || 'unknown';
      channels[platform.toLowerCase()] = {
        id:       p.id,
        name:     p.formatted_username || p.username || '',
        service:  platform,
        avatar:   p.avatar_https || p.avatar || '',
        updated:  new Date().toISOString(),
      };
      // Auto-store
      await storePlatformChannel(platform.toLowerCase(), p.id, env);
    }
    return { channels, count: Object.keys(channels).length };
  } catch(e) { return { error: e.message }; }
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




export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
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
    // ── OCR: extract text from image ─────────────────────────────────────────
    if (path === '/api/ocr' && request.method === 'POST') {
      try {
        const body = await request.json();
        const imageB64 = body.image || '';
        const mimeType = body.mime_type || 'image/png';
        const provider = body.provider || 'gemini';
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
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
    // ── Macro list docs ───────────────────────────────────────────────────────
    if (path === '/api/macro/list' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? await env.PRISM_KV.get('macros:list', 'json') : null;
        return json({ macros: list || [], docs: list || [], success: true }, 200, origin);
      } catch(e) { return json({ macros: [], docs: [], error: e.message }, 200, origin); }
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
    // ── GET /api/agents — list all agents from KV ──
    if (path === '/api/agents' && request.method === 'GET') {
      try {
        const list = env.PRISM_KV ? (await env.PRISM_KV.get('agents:list', 'json') || []) : [];
        return json({ success: true, agents: list, count: list.length }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message, agents: [] }, 500, origin); }
    }

    // ── DELETE /api/agents/:id ──
    if (path.startsWith('/api/agents/') && request.method === 'DELETE') {
      try {
        const agentId = path.replace('/api/agents/', '');
        if (env.PRISM_KV) {
          const list = await env.PRISM_KV.get('agents:list', 'json') || [];
          const updated = list.filter(a => a.id !== agentId);
          await env.PRISM_KV.put('agents:list', JSON.stringify(updated));
          await env.PRISM_KV.delete('agents:' + agentId).catch(() => {});
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ success: false, error: e.message }, 500, origin); }
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
    // 404 fallback
    return json({ error: 'Not found', path }, 404, origin);
  }
};