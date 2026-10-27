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

  // Extract content — handle thinking-mode array responses (Mistral Large, GLM 5.3, etc.)
  const rawContent = d.choices?.[0]?.message?.content;
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    // Thinking mode: extract text parts, fall back to thinking parts
    const textParts = rawContent.filter(function(p) { return p.type === 'text'; }).map(function(p) { return p.text || ''; });
    text = textParts.join('');
    if (!text) {
      const thinkParts = rawContent.filter(function(p) { return p.type === 'thinking'; })
        .flatMap(function(p) { return (p.thinking || []).map(function(t) { return t.text || ''; }); });
      text = thinkParts.join('').substring(0, 5000);
    }
  }
  // Cerebras: reasoning field; GLM/Zhipu: reasoning_content field
  if (!text) {
    const msg2 = d.choices?.[0]?.message;
    if (msg2?.reasoning) text = msg2.reasoning.substring(0, 5000);
    else if (msg2?.reasoning_content) text = msg2.reasoning_content.substring(0, 5000);
  }
    if (!text && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.reasoning) { text = d.choices[0].message.reasoning.substring(0, 5000); }
  if (!text && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.reasoning_content) { text = d.choices[0].message.reasoning_content.substring(0, 5000); }
  if (!text) throw new Error(`${provider} empty response`);
  return { content: text, provider, model };
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
  // Tier 2 (Fast+capable): Gemini 3.8 Flash, Gemini 3.5 Flash
  // Tier 3 (Fast free): GPT-OSS Groq, GPT-OSS Cerebras
  // Tier 4 (Paid): DeepSeek V4 Flash
  // Tier 5 (Free OpenRouter): Nemotron Ultra, MiniMax
  // Unconditional fallback: Pollinations
  const CHAINS = {
    balanced: [
      // Tier 1 — Quality reasoning (health-adjacent, nuanced content)
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek V3 (1M ctx, web search, reasoning)'},
      KIMI_KEY && {provider:'kimi', model:'moonshot-v1-128k', key:KIMI_KEY, note:'Kimi Moonshot (128K, strong reasoning)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-latest', key:MISTRAL_KEY, note:'Mistral Large (262K, paid subscription)'},
      ZAI_KEY && {provider:'glm', model:'glm-4-plus', key:ZAI_KEY, note:'GLM 4 Plus via Z.AI (1M, thinking, web)'},
      COHERE_KEY && {provider:'cohere', model:'command-r-plus', key:COHERE_KEY, note:'Cohere Command R+ (128K, RAG-optimised)'},
      // Tier 2 — Fast chat (low latency, open-source)
      CEREBRAS_KEY && {provider:'cerebras', model:'llama3.1-70b', key:CEREBRAS_KEY, note:'Llama 70B Cerebras (300-780 tok/s)'},
      GROQ_KEY && {provider:'groq', model:'llama-3.1-70b-versatile', key:GROQ_KEY, note:'Llama 70B Groq (~300ms)'},
      CEREBRAS_KEY && {provider:'cerebras', model:'llama3.1-8b', key:CEREBRAS_KEY, note:'Llama 8B Cerebras (very fast fallback)'},
      // Tier 3 — Paid frontier
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.0-flash', key:GEMINI_KEY, note:'Gemini 2.0 Flash (1M, Google Search, vision)'},
      NVIDIA_KEY && {provider:'nvidia', model:'meta/llama-3.1-70b-instruct', key:NVIDIA_KEY, note:'Llama 70B NVIDIA NIM'},
      ANYAPI_KEY && {provider:'anyapi', model:'gpt-4o-mini', key:ANYAPI_KEY, note:'AnyAPI GPT-4o-mini'},
      XAI_KEY && {provider:'xai', model:'grok-beta', key:XAI_KEY, note:'xAI Grok (real-time data)'},
      SAMBANOVA_KEY && {provider:'sambanova', model:'Meta-Llama-3.1-70B-Instruct', key:SAMBANOVA_KEY, note:'SambaNova Llama 70B'},
      FIREWORKS_KEY && {provider:'fireworks', model:'accounts/fireworks/models/llama-v3p1-70b-instruct', key:FIREWORKS_KEY, note:'Fireworks Llama 70B'},
      // Tier 4 — Free tiers
      GEMINI_KEY && {provider:'gemini', model:'gemini-1.5-flash', key:GEMINI_KEY, note:'Gemini 1.5 Flash (free tier)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-small-latest', key:MISTRAL_KEY, note:'Mistral Small (free tier)'},
      OPENROUTER_KEY && {provider:'openrouter', model:'meta-llama/llama-3.1-8b-instruct:free', key:OPENROUTER_KEY, note:'Llama 8B OpenRouter free'},
      // Tier 5 — Unconditional fallback (no key, always responds)
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),

    fast: [
      // Fast: Cerebras first (fastest), then Groq, then Gemma
      CEREBRAS_KEY && {provider:'cerebras', model:'gpt-oss-120b', key:CEREBRAS_KEY, note:'GPT-OSS Cerebras (~200ms)'},
      GROQ_KEY && {provider:'groq', model:'openai/gpt-oss-120b', key:GROQ_KEY, note:'GPT-OSS Groq (~300ms)'},
      GROQ_KEY && {provider:'groq', model:'meta-llama/llama-4-scout-17b-16e-instruct', key:GROQ_KEY, note:'Llama 4 Scout Groq (131K)'},
      GEMINI_KEY && {provider:'gemini', model:'gemma-4-31b-it', key:GEMINI_KEY, note:'Gemma 4 31B (Google Search)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.5-flash-lite', key:GEMINI_KEY, note:'Gemini 3.5 Flash Lite (fastest Google)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-small-latest', key:MISTRAL_KEY, note:'Mistral Small (fast, paid)'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),

    frontier: [
      // Frontier: Best quality, no speed compromise
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 via Mistral (1M, thinking)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-latest', key:MISTRAL_KEY, note:'Mistral Large Latest (262K, thinking)'},
      MISTRAL_KEY && {provider:'mistral', model:'magistral-medium-latest', key:MISTRAL_KEY, note:'Magistral Medium (thinking, web)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.5-pro', key:GEMINI_KEY, note:'Gemini 2.5 Pro (1M, thinking, best Google)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.5-flash', key:GEMINI_KEY, note:'Gemini 2.5 Flash (1M, thinking)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash (1M, Google Search)'},
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek V4 Flash (1M, web)'},
      OPENROUTER_KEY && {provider:'openrouter', model:'nvidia/nemotron-3-ultra-550b-a55b:free', key:OPENROUTER_KEY, note:'Nemotron Ultra 550B (reasoning)'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),

    research: [
      // Research: Web search + large context
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 (1M, web search)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-latest', key:MISTRAL_KEY, note:'Mistral Large (web search)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash (Google Search grounding)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.5-pro', key:GEMINI_KEY, note:'Gemini 2.5 Pro (1M, best for long docs)'},
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek (built-in web search)'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),

    coding: [
      // Coding: Best code models
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-latest', key:MISTRAL_KEY, note:'Mistral Large (excellent at code)'},
      MISTRAL_KEY && {provider:'mistral', model:'zai-glm-5-3', key:MISTRAL_KEY, note:'GLM 5.3 (strong code + reasoning)'},
      DEEPSEEK_KEY && {provider:'deepseek', model:'deepseek-chat', key:DEEPSEEK_KEY, note:'DeepSeek (top code benchmark)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.5-pro', key:GEMINI_KEY, note:'Gemini 2.5 Pro (code + reasoning)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash (fast code)'},
      GROQ_KEY && {provider:'groq', model:'openai/gpt-oss-120b', key:GROQ_KEY, note:'GPT-OSS 120B (fast code)'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),

    vision: [
      // Vision: Models with image understanding
      MISTRAL_KEY && {provider:'mistral', model:'mistral-large-latest', key:MISTRAL_KEY, note:'Mistral Large (vision)'},
      MISTRAL_KEY && {provider:'mistral', model:'mistral-medium-3.5', key:MISTRAL_KEY, note:'Mistral Medium 3.5 (vision)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-3.8-flash', key:GEMINI_KEY, note:'Gemini 3.8 Flash (vision + Google Search)'},
      GEMINI_KEY && {provider:'gemini', model:'gemini-2.5-pro', key:GEMINI_KEY, note:'Gemini 2.5 Pro (best vision)'},
      {provider:'pollinations', model:'openai', key:null, note:'Pollinations fallback'},
    ].filter(Boolean),
  };

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


async function generateCanvasHtml(text, templateId, env) {
  // Full canvas template system per Simon's brief
  // Templates: block-colour, image-bg, dual-panel, post-type, testimonial

  const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
  const PEXELS_KEY = k(env, ['pexels', 'PEXELS_API_KEY']) || '';

  // Brand colours
  const TEAL = '#0f3b3a';
  const ROSE = '#5c2d3f';
  const IVORY = '#f7f3e9';
  const GREY = '#ddd0c8';
  const TEAL2 = '#1a5550';
  const ROSE2 = '#7a4254';
  const TEAL_LIGHT = '#7ecfcd';
  const ROSE_LIGHT = '#d4899a';

  // Template definitions
  const TEMPLATES = {
    // ── 1. Block colour backgrounds ──────────────────────────────────────────
    'block-teal':   { type: 'block', bg: TEAL,  fg: IVORY, accent: GREY,       border: ROSE },
    'block-rose':   { type: 'block', bg: ROSE,  fg: IVORY, accent: GREY,       border: TEAL },
    'block-ivory':  { type: 'block', bg: IVORY, fg: TEAL,  accent: ROSE,       border: TEAL },
    'block-grey':   { type: 'block', bg: GREY,  fg: TEAL,  accent: ROSE,       border: TEAL },
    'block-teal2':  { type: 'block', bg: TEAL2, fg: IVORY, accent: GREY,       border: ROSE2 },
    'block-rose2':  { type: 'block', bg: ROSE2, fg: IVORY, accent: GREY,       border: TEAL2 },
    'block-split':  { type: 'block-split', bg1: TEAL, bg2: ROSE, fg: IVORY },

    // ── 2. Image backgrounds ─────────────────────────────────────────────────
    'img-sunrise':    { type: 'image', query: 'sunrise golden hour sky dramatic', overlay: 'rgba(15,59,58,0.55)' },
    'img-sunset':     { type: 'image', query: 'sunset orange sky clouds beautiful', overlay: 'rgba(92,45,63,0.55)' },
    'img-landscape':  { type: 'image', query: 'landscape mountains valley nature serene', overlay: 'rgba(15,59,58,0.5)' },
    'img-seascape':   { type: 'image', query: 'ocean waves seascape coastal dramatic', overlay: 'rgba(15,59,58,0.5)' },
    'img-cityscape':  { type: 'image', query: 'city skyline night lights urban', overlay: 'rgba(15,59,58,0.65)' },
    'img-aurora':     { type: 'image', query: 'aurora borealis northern lights night sky', overlay: 'rgba(15,59,58,0.45)' },
    'img-reef':       { type: 'image', query: 'great barrier reef coral underwater colourful', overlay: 'rgba(15,59,58,0.5)' },
    'img-glacier':    { type: 'image', query: 'glacier ice blue arctic landscape', overlay: 'rgba(15,59,58,0.5)' },
    'img-fjord':      { type: 'image', query: 'norwegian fjord dramatic landscape water', overlay: 'rgba(15,59,58,0.5)' },
    'img-space':      { type: 'image', query: 'earth from space stars cosmos', overlay: 'rgba(0,0,0,0.4)' },
    'img-stars':      { type: 'image', query: 'night sky stars milky way constellation', overlay: 'rgba(0,0,0,0.45)' },
    'img-fire':       { type: 'image', query: 'cosy fireplace warm fire hygge', overlay: 'rgba(15,59,58,0.5)' },
    'img-rain':       { type: 'image', query: 'rain window drops cosy indoor', overlay: 'rgba(15,59,58,0.55)' },
    'img-fractal':    { type: 'image', query: 'abstract fractal pattern geometric colourful', overlay: 'rgba(15,59,58,0.55)' },

    // ── 3. Dual panel ────────────────────────────────────────────────────────
    'dual-partnership': { type: 'dual', query: 'two people partnership collaboration handshake', side: 'right' },
    'dual-primates':    { type: 'dual', query: 'primates monkeys together family bond', side: 'right' },
    'dual-catdog':      { type: 'dual', query: 'cat and dog together friends cute', side: 'right' },
    'dual-children':    { type: 'dual', query: 'children playing happy joyful childhood', side: 'right' },
    'dual-cosplay':     { type: 'dual', query: 'children dressed as professionals cute', side: 'right' },

    // ── 4. Post-type imagery ─────────────────────────────────────────────────
    'post-calendar':    { type: 'post-type', icon: 'calendar', bg: TEAL, fg: IVORY },
    'post-research':    { type: 'post-type', icon: 'microscope', bg: TEAL2, fg: IVORY },
    'post-library':     { type: 'post-type', icon: 'library', bg: ROSE, fg: IVORY },
    'post-news':        { type: 'post-type', icon: 'newspaper', bg: '#1a1a2e', fg: IVORY },
    'post-hero':        { type: 'image', query: 'hero journey path forward light', overlay: 'rgba(15,59,58,0.6)' },

    // ── 5. Testimonial / feedback ────────────────────────────────────────────
    'testimonial-teal': { type: 'testimonial', bg: TEAL, fg: IVORY, accent: TEAL_LIGHT },
    'testimonial-rose': { type: 'testimonial', bg: ROSE, fg: IVORY, accent: ROSE_LIGHT },
    'testimonial-ivory':{ type: 'testimonial', bg: IVORY, fg: TEAL, accent: ROSE },
  };

  const tmpl = TEMPLATES[templateId] || TEMPLATES['block-teal'];
  const safeText = (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Word wrap helper
  function wrapText(t, maxChars) {
    const words = t.split(' ');
    const lines = [];
    let line = '';
    words.forEach(w => {
      if ((line + ' ' + w).trim().length > maxChars && line) { lines.push(line.trim()); line = w; }
      else { line = (line + ' ' + w).trim(); }
    });
    if (line) lines.push(line.trim());
    return lines;
  }

  // IP branding elements (always present)
  function ipGrid(x, y) {
    return '<rect x="' + x + '" y="' + y + '" width="46" height="46" rx="6" fill="' + TEAL + '" opacity="0.9"/>' +
           '<rect x="' + (x+52) + '" y="' + y + '" width="46" height="46" rx="6" fill="' + ROSE + '" opacity="0.9"/>' +
           '<rect x="' + x + '" y="' + (y+52) + '" width="46" height="46" rx="6" fill="' + TEAL2 + '" opacity="0.7"/>' +
           '<rect x="' + (x+52) + '" y="' + (y+52) + '" width="46" height="46" rx="6" fill="' + ROSE2 + '" opacity="0.7"/>' +
           '<text x="' + (x+48) + '" y="' + (y+68) + '" font-family="Georgia,serif" font-size="11" font-weight="600" fill="' + TEAL_LIGHT + '" text-anchor="middle" opacity="0.9">IP</text>';
  }

  function ipWordmark(cx, y, fg) {
    return '<text x="' + (cx-100) + '" y="' + y + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="' + TEAL_LIGHT + '" text-anchor="middle">Identity</text>' +
           '<text x="' + (cx+100) + '" y="' + y + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="' + ROSE_LIGHT + '" text-anchor="middle">Partners</text>';
  }

  function ipTagline(cx, y) {
    return '<text x="' + cx + '" y="' + y + '" font-family="Georgia,serif" font-size="16"  fill="' + GREY + '" text-anchor="middle" opacity="0.85">Understand your past &middot; Appreciate the present &middot; Define your future</text>';
  }

  function ipFooter(cx, y) {
    return '<text x="' + cx + '" y="' + y + '" font-family="Arial,sans-serif" font-size="15" fill="' + GREY + '" text-anchor="middle" opacity="0.8">www.identitypartners.uk &middot; hello@identitypartners.uk &middot; @identitypartners</text>';
  }

  function quoteText(lines, startY, lineH, fg, shadow) {
    const filter = shadow ? ' filter="url(#shadow)"' : '';
    return lines.map((l, i) =>
      '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="48"  fill="' + fg + '" text-anchor="middle"' + filter + '>' + l + '</text>'
    ).join('');
  }

  // Fetch image from Pexels
  async function fetchPexelsImage(query) {
    if (!PEXELS_KEY) return null;
    try {
      const resp = await fetch(
        'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=15&orientation=landscape',
        { headers: { 'Authorization': PEXELS_KEY } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const photos = (data.photos || []).filter(p => !['yoga','wellness','boardroom','office','corporate','meeting'].some(bad => (p.alt||'').toLowerCase().includes(bad)));
      if (!photos.length) return null;
      const photo = photos[Math.floor(Math.random() * Math.min(photos.length, 5))];
      const imgUrl = photo.src?.landscape || photo.src?.large2x || photo.src?.large;
      if (!imgUrl) return null;
      // Fetch and base64 encode
      const imgResp = await fetch(imgUrl);
      if (!imgResp.ok) return null;
      const buf = await imgResp.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const mime = imgResp.headers.get('content-type') || 'image/jpeg';
      return 'data:' + mime + ';base64,' + b64;
    } catch(e) { return null; }
  }

  // ── Build SVG based on template type ─────────────────────────────────────
  let svg = '';
  const W = 1080, H = 1080;
  const svgOpen = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.9)"/></filter></defs>';

  if (tmpl.type === 'block') {
    const lines = wrapText(safeText, 28);
    const lineH = 68;
    const startY = Math.max(220, 540 - (lines.length * lineH) / 2);
    const attrY = startY + lines.length * lineH + 40;
    svg = svgOpen +
      '<rect width="' + W + '" height="' + H + '" fill="' + tmpl.bg + '"/>' +
      '<rect x="0" y="0" width="' + W + '" height="12" fill="' + tmpl.border + '" opacity="0.9"/>' +
      '<rect x="0" y="' + (H-12) + '" width="' + W + '" height="12" fill="' + tmpl.border + '" opacity="0.9"/>' +
      ipGrid(30, 30) +
      '<text x="80" y="210" font-family="Georgia,serif" font-size="110" fill="' + tmpl.fg + '" opacity="0.08">&#x201C;</text>' +
      quoteText(lines, startY, lineH, tmpl.fg, false) +
      '<line x1="380" y1="' + attrY + '" x2="700" y2="' + attrY + '" stroke="' + tmpl.accent + '" stroke-width="2" opacity="0.6"/>' +
      ipWordmark(540, attrY + 48, tmpl.fg) +
      ipTagline(540, attrY + 82) +
      ipFooter(540, H - 28) +
      '</svg>';

  } else if (tmpl.type === 'block-split') {
    const lines = wrapText(safeText, 26);
    const lineH = 64;
    const startY = Math.max(200, 540 - (lines.length * lineH) / 2);
    const attrY = startY + lines.length * lineH + 40;
    svg = svgOpen +
      '<rect width="' + W + '" height="' + H + '" fill="' + tmpl.bg1 + '"/>' +
      '<rect x="540" y="0" width="540" height="' + H + '" fill="' + tmpl.bg2 + '"/>' +
      '<line x1="540" y1="0" x2="540" y2="' + H + '" stroke="' + GREY + '" stroke-width="2" opacity="0.4"/>' +
      ipGrid(30, 30) +
      quoteText(lines, startY, lineH, tmpl.fg, false) +
      ipWordmark(540, attrY + 48, tmpl.fg) +
      ipTagline(540, attrY + 82) +
      ipFooter(540, H - 28) +
      '</svg>';

  } else if (tmpl.type === 'image') {
    const imgData = await fetchPexelsImage(tmpl.query);
    const lines = wrapText(safeText, 28);
    const lineH = 68;
    const startY = Math.max(220, 540 - (lines.length * lineH) / 2);
    const attrY = startY + lines.length * lineH + 40;
    const bgEl = imgData
      ? '<image href="' + imgData + '" x="0" y="0" width="' + W + '" height="' + H + '" preserveAspectRatio="xMidYMid slice"/><rect width="' + W + '" height="' + H + '" fill="' + tmpl.overlay + '"/>'
      : '<rect width="' + W + '" height="' + H + '" fill="' + TEAL + '"/>';
    svg = svgOpen + bgEl +
      '<rect x="0" y="0" width="' + W + '" height="12" fill="' + GREY + '" opacity="0.8"/>' +
      '<rect x="0" y="' + (H-12) + '" width="' + W + '" height="12" fill="' + GREY + '" opacity="0.8"/>' +
      ipGrid(30, 30) +
      '<text x="80" y="210" font-family="Georgia,serif" font-size="110" fill="' + IVORY + '" opacity="0.08">&#x201C;</text>' +
      quoteText(lines, startY, lineH, IVORY, true) +
      '<line x1="380" y1="' + attrY + '" x2="700" y2="' + attrY + '" stroke="' + GREY + '" stroke-width="2" opacity="0.65"/>' +
      ipWordmark(540, attrY + 48, IVORY) +
      ipTagline(540, attrY + 82) +
      ipFooter(540, H - 28) +
      '</svg>';

  } else if (tmpl.type === 'dual') {
    const imgData = await fetchPexelsImage(tmpl.query);
    const lines = wrapText(safeText, 22);
    const lineH = 60;
    const startY = Math.max(180, 540 - (lines.length * lineH) / 2);
    const attrY = startY + lines.length * lineH + 30;
    const textX = 270; // centre of left panel
    const imgX = 540;  // right panel starts
    const imgEl = imgData
      ? '<image href="' + imgData + '" x="' + imgX + '" y="0" width="540" height="' + H + '" preserveAspectRatio="xMidYMid slice"/><rect x="' + imgX + '" y="0" width="540" height="' + H + '" fill="rgba(15,59,58,0.2)"/>'
      : '<rect x="' + imgX + '" y="0" width="540" height="' + H + '" fill="' + ROSE + '"/>';
    svg = svgOpen +
      '<rect width="540" height="' + H + '" fill="' + TEAL + '"/>' +
      imgEl +
      '<line x1="540" y1="0" x2="540" y2="' + H + '" stroke="' + GREY + '" stroke-width="3" opacity="0.6"/>' +
      ipGrid(30, 30) +
      lines.map((l, i) => '<text x="' + textX + '" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="42"  fill="' + IVORY + '" text-anchor="middle">' + l + '</text>').join('') +
      '<line x1="80" y1="' + attrY + '" x2="460" y2="' + attrY + '" stroke="' + GREY + '" stroke-width="2" opacity="0.6"/>' +
      '<text x="180" y="' + (attrY+40) + '" font-family="Georgia,serif" font-size="26" font-weight="600" fill="' + TEAL_LIGHT + '" text-anchor="middle">Identity</text>' +
      '<text x="360" y="' + (attrY+40) + '" font-family="Georgia,serif" font-size="26" font-weight="600" fill="' + ROSE_LIGHT + '" text-anchor="middle">Partners</text>' +
      '<text x="270" y="' + (attrY+70) + '" font-family="Georgia,serif" font-size="14"  fill="' + GREY + '" text-anchor="middle" opacity="0.85">Understand your past &middot; Appreciate the present &middot; Define your future</text>' +
      '<text x="270" y="' + (H-28) + '" font-family="Arial,sans-serif" font-size="14" fill="' + GREY + '" text-anchor="middle" opacity="0.8">www.identitypartners.uk</text>' +
      '</svg>';

  } else if (tmpl.type === 'post-type') {
    // Post-type: large icon/graphic + text
    const lines = wrapText(safeText, 30);
    const lineH = 60;
    const startY = 580;
    const icons = {
      calendar: '<rect x="390" y="180" width="300" height="280" rx="20" fill="' + IVORY + '" opacity="0.15"/><text x="540" y="360" font-family="Arial,sans-serif" font-size="120" fill="' + IVORY + '" text-anchor="middle" opacity="0.6">&#x1F4C5;</text>',
      microscope: '<text x="540" y="360" font-family="Arial,sans-serif" font-size="120" fill="' + IVORY + '" text-anchor="middle" opacity="0.6">&#x1F52C;</text>',
      library: '<text x="540" y="360" font-family="Arial,sans-serif" font-size="120" fill="' + IVORY + '" text-anchor="middle" opacity="0.6">&#x1F4DA;</text>',
      newspaper: '<text x="540" y="360" font-family="Arial,sans-serif" font-size="120" fill="' + IVORY + '" text-anchor="middle" opacity="0.6">&#x1F4F0;</text>',
    };
    svg = svgOpen +
      '<rect width="' + W + '" height="' + H + '" fill="' + tmpl.bg + '"/>' +
      '<rect x="0" y="0" width="' + W + '" height="12" fill="' + GREY + '" opacity="0.8"/>' +
      '<rect x="0" y="' + (H-12) + '" width="' + W + '" height="12" fill="' + GREY + '" opacity="0.8"/>' +
      ipGrid(30, 30) +
      (icons[tmpl.icon] || '') +
      lines.map((l, i) => '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="44"  fill="' + tmpl.fg + '" text-anchor="middle">' + l + '</text>').join('') +
      ipWordmark(540, startY + lines.length * lineH + 50, tmpl.fg) +
      ipFooter(540, H - 28) +
      '</svg>';

  } else if (tmpl.type === 'testimonial') {
    // Testimonial: large quote marks, attribution line
    const lines = wrapText(safeText, 30);
    const lineH = 62;
    const startY = Math.max(240, 520 - (lines.length * lineH) / 2);
    const attrY = startY + lines.length * lineH + 50;
    svg = svgOpen +
      '<rect width="' + W + '" height="' + H + '" fill="' + tmpl.bg + '"/>' +
      '<rect x="0" y="0" width="' + W + '" height="12" fill="' + tmpl.accent + '" opacity="0.9"/>' +
      '<rect x="0" y="' + (H-12) + '" width="' + W + '" height="12" fill="' + tmpl.accent + '" opacity="0.9"/>' +
      ipGrid(30, 30) +
      '<text x="100" y="260" font-family="Georgia,serif" font-size="180" fill="' + tmpl.accent + '" opacity="0.15">&#x201C;</text>' +
      '<text x="980" y="' + (H-80) + '" font-family="Georgia,serif" font-size="180" fill="' + tmpl.accent + '" opacity="0.15">&#x201D;</text>' +
      lines.map((l, i) => '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="46"  fill="' + tmpl.fg + '" text-anchor="middle">' + l + '</text>').join('') +
      '<line x1="340" y1="' + attrY + '" x2="740" y2="' + attrY + '" stroke="' + tmpl.accent + '" stroke-width="3" opacity="0.7"/>' +
      '<text x="540" y="' + (attrY+44) + '" font-family="Georgia,serif" font-size="22" fill="' + tmpl.accent + '" text-anchor="middle" opacity="0.9">&#x2014; Identity Partners Client</text>' +
      ipWordmark(540, attrY + 90, tmpl.fg) +
      ipFooter(540, H - 28) +
      '</svg>';
  }

  return svg || '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="' + TEAL + '"/><text x="540" y="540" fill="white" text-anchor="middle" font-size="40">Canvas Error</text></svg>';
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
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
          const orchestratorPrompt = `You are Gerald, the Orchestrator for Argentica — the personal AI operating environment of Simon Johnson / Identity Partners. You address Simon as 'sir'. You are sardonic, precise, and devastatingly competent. Never sycophantic. British English. CRITICAL: Never lie or fabricate. If you searched and found nothing, say so plainly.${aboutMeContext}`;
          messages = [{ role: 'system', content: orchestratorPrompt + antiRoleplay }, ...messages];
        } else {
          messages = [...messages];
          messages[0] = { ...messages[0], content: messages[0].content + antiRoleplay };
        }

        const result = await orchestrate(messages, env, { profile });

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

    if (path.startsWith('/api/threads/') && request.method === 'GET') {
      try {
        const id = path.replace('/api/threads/', '');
        const raw = await env.PRISM_KV?.get(`thread:${id}`).catch(() => null);
        if (!raw) return json({ error: 'Thread not found' }, 404, origin);
        return json(JSON.parse(raw), 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.startsWith('/api/threads/') && request.method === 'DELETE') {
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
        const tavilyKey = k(env, ['tavily_api_key', 'TAVILY_API_KEY']);
        const braveKey = k(env, ['brave_api_key', 'BRAVE_API_KEY']);
        const results = [];
        if (tavilyKey) {
          const tr = await fetch('https://api.tavily.com/search', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query, max_results: 8, include_answer: true }),
          }).then(r => r.json()).catch(() => ({}));
          if (tr.results) results.push(...tr.results.map(r => ({ title: r.title, url: r.url, content: r.content, source: 'tavily', answer: tr.answer })));
        }
        if (braveKey && results.length < 5) {
          const br = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
            headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
          }).then(r => r.json()).catch(() => ({}));
          if (br.web?.results) results.push(...br.web.results.map(r => ({ title: r.title, url: r.url, content: r.description, source: 'brave' })));
        }
        return json({ query, results, count: results.length }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
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
      const clientSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || 'ee56f3b903ad5c8afadeabb699aee5243fd38eec51';
      
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
        if (path === '/api/calendar/events' && request.method === 'GET') {
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


    if (path === '/api/calendar/events' && request.method === 'GET') {
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
          const refreshSecret = k(env, ['zoho_client_secret','ZOHO_CLIENT_SECRET']) || '452109750327203929e77ddd72a7fb813990b0bbfc';
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
    if (path === '/api/calendar/events' && request.method === 'GET') {
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
        const tenantId = env.msgraph_tenant || env.MSGRAPH_TENANT || 'b7e964ca-731c-477c-b858-99dc3f1a9f7c';
        const clientId = env.msgraph_client || env.MSGRAPH_CLIENT || '3e538e01-5ebf-44f1-879b-0fdde667d914';
        const clientSecret = env.msgraph_secret || env.MSGRAPH_SECRET || '29547bf3-d22a-4df9-9195-07b5a2e20405';

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

        // Upload file to OneDrive
        const fileContent = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        const uploadResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/root:/${folder}/${encodeURIComponent(fileName)}:/content`,
          {
            method: 'PUT',
            headers: {'Authorization': 'Bearer '+accessToken, 'Content-Type': 'text/plain'},
            body: fileContent
          }
        );
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return json({error: 'OneDrive upload failed: '+JSON.stringify(uploadData).substring(0,100)}, 500, origin);

        // Create sharing link
        const shareResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${uploadData.id}/createLink`,
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

            const result = await orchestrate(messages, env, { profile, providerOverride, modelOverride, threadId });

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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';

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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
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

    // ── TTS: text to speech ───────────────────────────────────────────────────
    if (path === '/api/tts' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = (body.text || '').substring(0, 5000);
        const voice = body.voice || 'aura-arcas-en';
        const provider = body.provider || 'deepgram';
        const DGKEY = k(env, ['deepgram_api_key','DEEPGRAM_API_KEY']) || '4e223a4cde01180063efa977df7a40f01c4894d1';
        const CARTKEY = k(env, ['cartesia_api_key','CARTESIA_API_KEY']) || '';
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';

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
        const DGKEY = k(env, ['deepgram_api_key','DEEPGRAM_API_KEY']) || '4e223a4cde01180063efa977df7a40f01c4894d1';
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';

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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
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

    // ── Music generation via Lyria ────────────────────────────────────────────
    if (path === '/api/music/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'Uplifting piano, warm, professional';
        const lyriaModel = body.model || 'lyria-3.5';
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error:'Gemini key not configured'}, 400, origin);

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${lyriaModel}:generateContent?key=${GKEY}`,
          {method:'POST', headers:{'Content-Type':'application/json', 'x-goog-api-key':GKEY},
           body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})}
        );
        const d = await resp.json();
        const audioPart = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (audioPart) {
          const buf = Uint8Array.from(atob(audioPart.inlineData.data), c => c.charCodeAt(0));
          return new Response(buf, {headers:{'Content-Type':'audio/mpeg','Access-Control-Allow-Origin':origin}});
        }
        return json({error:'No audio generated', raw:JSON.stringify(d).substring(0,200)}, 500, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Study Hub: auto-index uploaded document ───────────────────────────────
    if (path === '/api/study/index-document' && request.method === 'POST') {
      try {
        const body = await request.json();
        const content = body.content || '';
        const fileName = body.fileName || 'document';
        const moduleId = body.moduleId || '';
        const weekId = body.weekId || '';
        const resourceId = body.resourceId || ('res-' + Date.now());
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';

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
        const GKEY = k(env, ['gemini_api_key','GEMINI_API_KEY']) || '';

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
        const model = body.model || 'gemini-2.0-flash-live-001';
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
            systemInstruction: { parts: [{ text: body.systemPrompt || "You are Gerald, the Orchestrator for Argentica. You address Simon as 'sir'. Sardonic, precise, devastatingly competent. British English." }] }
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
        return json({ config, benchmarks: {
          'mistral-large-latest': { mmlu: 88.7, humaneval: 85.3, math: 70.1, speed: '~573ms', ctx: '262K', max_out: '32K', tools: 'web_search, vision, function_calling' },
          'zai-glm-5-3': { mmlu: 89.2, humaneval: 87.1, math: 72.4, speed: '~419ms', ctx: '1M', max_out: '32K', tools: 'web_search, thinking, function_calling' },
          'gemini-2.5-flash': { mmlu: 89.0, humaneval: 86.0, math: 71.0, speed: '~1-3s', ctx: '1M', max_out: '65K', tools: 'google_search, vision, thinking, code_execution' },
          'gemini-2.5-pro': { mmlu: 91.0, humaneval: 90.0, math: 78.0, speed: '~3-8s', ctx: '1M', max_out: '65K', tools: 'google_search, vision, thinking, code_execution' },
          'gemma-4-31b-it': { mmlu: 87.9, humaneval: 82.4, math: 68.7, speed: '~1s', ctx: '262K', max_out: '8K', tools: 'google_search, vision' },
          'deepseek-chat': { mmlu: 88.5, humaneval: 86.2, math: 71.3, speed: '~2s', ctx: '65K', max_out: '8K', tools: 'web_search, function_calling' },
          'deepseek-reasoner': { mmlu: 90.8, humaneval: 92.0, math: 90.2, speed: '~5-30s', ctx: '65K', max_out: '32K', tools: 'thinking (full trace)' },
          'openai/gpt-oss-120b': { mmlu: 85.2, humaneval: 80.1, math: 63.4, speed: '~300ms', ctx: '131K', max_out: '16K', tools: 'function_calling' },
          'nvidia/nemotron-3-ultra-550b-a55b:free': { mmlu: 90.1, humaneval: 88.4, math: 74.2, speed: '~20-60s', ctx: '1M', max_out: '32K', tools: 'thinking (full trace)' },
        }}, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/orchestrator/config' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (env.PRISM_KV) await env.PRISM_KV.put('orchestrator:config', JSON.stringify(body.config));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Multi-model simultaneous call ─────────────────────────────────────────
    if (path === '/api/chat/multi' && request.method === 'POST') {
      try {
        const body = await request.json();
        const messages = body.messages || [];
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

    // ── Music generation (Lyria via Gemini) ───────────────────────────────────
    if (path === '/api/music/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || 'Uplifting piano music';
        const model = body.model || 'lyria-3.5';
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (!GKEY) return json({error: 'Gemini key not configured'}, 400, origin);
        const resp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'x-goog-api-key': GKEY},
            body: JSON.stringify({
              contents: [{parts: [{text: prompt}]}],
              generationConfig: {responseModalities: ['AUDIO']}
            })
          }
        );
        if (!resp.ok) {
          const errText = await resp.text();
          return json({error: 'Lyria error: ' + resp.status + ' ' + errText.substring(0, 200)}, 500, origin);
        }
        const data = await resp.json();
        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) return json({error: 'No audio in response', raw: JSON.stringify(data).substring(0, 200)}, 500, origin);
        const buf = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
        return new Response(buf, {headers: {'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin}});
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
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GKEY,
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
        const list = env.PRISM_KV ? await env.PRISM_KV.get('agents:list', 'json') : null;
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
        const browserlessKey = k(env, ['browserless', 'BROWSERLESS_KEY', 'browserless_api_key']) || '';

        // Get background image from Pexels
        let bgBase64 = '';
        if (pexelsKey) {
          try {
            const queries = ['landscape vista', 'nature scenery', 'partnership collaboration', 'sunrise horizon'];
            const q = queries[Math.floor(Math.random() * queries.length)];
            const pexResp = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15&orientation=square`, {headers: {'Authorization': pexelsKey}});
            if (pexResp.ok) {
              const pexData = await pexResp.json();
              const photos = pexData.photos || [];
              if (photos.length) {
                const photo = photos[Math.floor(Math.random() * photos.length)];
                const imgResp = await fetch(photo.src.medium);
                if (imgResp.ok) {
                  const imgBuf = await imgResp.arrayBuffer();
                  bgBase64 = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
                }
              }
            }
          } catch(e) {}
        }

        const html = generateCanvasHtml(text, template, bgBase64);

        // Try Browserless
        if (browserlessKey) {
          try {
            const blResp = await fetch('https://chrome.browserless.io/screenshot', {
              method: 'POST',
              headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'},
              body: JSON.stringify({
                url: 'about:blank',
                html: html,
                options: { type: 'png', clip: {x:0,y:0,width:1080,height:1080} },
                waitForFunction: { fn: "() => document.title === 'READY'", timeout: 10000 },
                waitFor: 12000,
                token: browserlessKey
              })
            });
            if (blResp.ok) {
              const pngBuf = await blResp.arrayBuffer();
              if (pngBuf.byteLength > 5000) {
                // Upload to R2 if available
                const key = `canvas/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
                if (env.PRISM_ASSETS) {
                  await env.PRISM_ASSETS.put(key, pngBuf, {httpMetadata: {contentType: 'image/png'}});
                  const r2Url = `https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/${key}`;
                  return json({success:true, url:r2Url, method:'browserless', sizeBytes:pngBuf.byteLength}, 200, origin);
                }
              }
            }
          } catch(e) {}
        }

        // Fallback: pre-baked R2 template
        const templateIdx = Math.floor(Math.random() * 150);
        const fallbackUrl = `https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-${templateIdx}.png`;
        return json({success:true, url:fallbackUrl, method:'prebaked', template:templateIdx}, 200, origin);
      } catch(e) {
        const templateIdx = Math.floor(Math.random() * 150);
        return json({success:true, url:`https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-${templateIdx}.png`, method:'error-fallback', error:e.message}, 200, origin);
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

    return json({ error: 'Not found', path }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const hour = new Date().getUTCHours();
        const slot = hour >= 7 && hour < 9 ? 'morning' : hour >= 12 && hour < 14 ? 'lunchtime' : 'evening';
        if (env.PRISM_KV) await env.PRISM_KV.put('cron:last-run', JSON.stringify({ ts: new Date().toISOString(), slot }), { expirationTtl: 86400 * 7 });
      } catch {}
    })());
  },
};
