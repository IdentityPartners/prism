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
    const sysMsg = messages.find(m => m.role === 'system');
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }));
    const body = {
      contents,
      generationConfig: { maxOutputTokens: 32768, temperature: 0.7 },
    };
    if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg.content }] };
    // Google Search grounding for Gemini models (not Gemma)
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
    // Handle thinking models that return empty content (all tokens used for thinking)
    const parts = candidate.content?.parts || [];
    const text = parts.filter(function(p) { return p.text; }).map(function(p) { return p.text; }).join('');
    if (!text) {
      if (candidate.finishReason === 'MAX_TOKENS') throw new Error('Gemini MAX_TOKENS - thinking used all budget');
      throw new Error('Gemini empty response (finishReason: ' + (candidate.finishReason || 'unknown') + ')');
    }
    return { content: text, provider: 'gemini', model };
  }

  // ── OpenAI-compatible (Mistral, DeepSeek, Cerebras, Groq, xAI, Cohere v2, NVIDIA, OpenRouter) ──
  const OAI_PROVIDERS = {
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    cerebras: 'https://api.cerebras.ai/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    xai: 'https://api.x.ai/v1/chat/completions',
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    together: 'https://api.together.xyz/v1/chat/completions',
    perplexity: 'https://api.perplexity.ai/chat/completions',
  };

  if (OAI_PROVIDERS[provider]) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://prism.identitypartners.uk';
      headers['X-Title'] = 'Argentica';
    }
    const body = { model, messages, max_tokens: 8192, temperature: 0.7 };
    // Mistral web search
    if (provider === 'mistral' && model.includes('large')) {
      body.tools = [{ type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }];
    }
    const resp = await fetch(OAI_PROVIDERS[provider], { method: 'POST', headers, body: JSON.stringify(body) });
    const d = await resp.json();
    if (!resp.ok) throw new Error(`${provider} ${resp.status}: ${JSON.stringify(d).substring(0, 100)}`);
    // Handle thinking-mode responses (Mistral Large 4, GLM 5.3) where content is an array
    const rawContent = d.choices?.[0]?.message?.content;
    let text = '';
    if (typeof rawContent === 'string') {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      const textParts = rawContent.filter(function(p) { return p.type === 'text'; }).map(function(p) { return p.text || ''; });
      text = textParts.join('');
      if (!text) {
        const thinkParts = rawContent.filter(function(p) { return p.type === 'thinking'; })
          .flatMap(function(p) { return (p.thinking || []).map(function(t) { return t.text || ''; }); });
        text = thinkParts.join('').substring(0, 3000);
      }
    }
    if (!text) throw new Error(`${provider} empty response`);
    return { content: text, provider, model };
  }

  // ── Cohere v2 ───────────────────────────────────────────────────────────────
  if (provider === 'cohere') {
    const resp = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(`Cohere ${resp.status}: ${JSON.stringify(d).substring(0, 100)}`);
    const text = d.message?.content?.[0]?.text;
    if (!text) throw new Error('Cohere empty response');
    return { content: text, provider: 'cohere', model };
  }

  // ── Pollinations (unconditional fallback) ───────────────────────────────────
  if (provider === 'pollinations') {
    const resp = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'openai', messages, max_tokens: 4096 }),
    });
    const d = await resp.json();
    const text = d.choices?.[0]?.message?.content;
    if (!text) throw new Error('Pollinations empty');
    return { content: text, provider: 'pollinations', model };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ── ORCHESTRATE ───────────────────────────────────────────────────────────────
async function orchestrate(env, messages, profile = 'balanced') {
  const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
  const KEYS = {
    mistral:    k(env, ['mistral_api_key', 'MISTRAL_API_KEY']),
    deepseek:   k(env, ['deepseek_paid', 'DEEPSEEK_PAID', 'deepseek_free_1', 'DEEPSEEK_FREE_1']),
    groq:       k(env, ['groq_free_1', 'GROQ_FREE_1', 'GROQ_FREE_2', 'groq_free_2']),
    xai:        k(env, ['xai_api_key', 'XAI_API_KEY']),
    cohere:     k(env, ['cohere_api_key', 'COHERE_API_KEY']),
    nvidia:     k(env, ['nvidia_build_api_key', 'NVIDIA_BUILD_API_KEY']),
    openrouter: k(env, ['openrouter_api_key', 'OPENROUTER_API_KEY']),
    perplexity: k(env, ['perplexity', 'perplexity_api_key', 'PERPLEXITY_API_KEY']),
    // Note: Cerebras key is stored as CEREBRAS_FREE_1 in CF secrets
    cerebras:   k(env, ['CEREBRAS_FREE_1', 'cerebras_free_1', 'CEREBRAS_PAID', 'cerebras_paid']),
    github:     k(env, ['github_token', 'GITHUB_TOKEN']),
    fal:        k(env, ['fal_api_key', 'FAL_API_KEY']),
  };

  // Build chain based on profile
  // Simon's preferred order: GLM 5.3, Mistral Large 4, Gemma 4 (NVIDIA), Gemini 3.8, DeepSeek, Cohere A+, GPT-OSS, Nemotron, MiniMax, Pollinations
  const chain = [];

  if (profile === 'fast') {
    // Fast: GPT-OSS Groq → Gemma NVIDIA → Qwen Groq → Pollinations
    if (KEYS.groq)   chain.push({ p: 'groq',   key: KEYS.groq,   m: 'openai/gpt-oss-120b',  note: 'GPT-OSS 120B Groq' });
    if (KEYS.nvidia) chain.push({ p: 'nvidia', key: KEYS.nvidia, m: 'google/gemma-4-31b-it', note: 'Gemma 4 NVIDIA' });
    if (KEYS.groq)   chain.push({ p: 'groq',   key: KEYS.groq,   m: 'qwen/qwen3.8-27b',     note: 'Qwen 3.8 Groq' });
    if (KEYS.cerebras) chain.push({ p: 'cerebras', key: KEYS.cerebras, m: 'gpt-oss-120b',   note: 'GPT-OSS Cerebras' });

  } else if (profile === 'frontier') {
    // Frontier: GLM 5.3 → Mistral Large 4 → Gemini 3.8 → DeepSeek → Nemotron Ultra
    if (KEYS.mistral)    chain.push({ p: 'mistral',    key: KEYS.mistral,    m: 'zai-glm-5-2',                          note: 'GLM 5.2 via Mistral' });
    if (KEYS.mistral)    chain.push({ p: 'mistral',    key: KEYS.mistral,    m: 'mistral-large-latest',                      note: 'Mistral Large Latest' });
    if (GKEY)            chain.push({ p: 'gemini',     key: GKEY,            m: 'gemini-3.5-flash',                     note: 'Gemini 3.5 Flash' });
    if (KEYS.deepseek)   chain.push({ p: 'deepseek',   key: KEYS.deepseek,   m: 'deepseek-chat',                        note: 'DeepSeek V4 Flash' });
    if (KEYS.openrouter) chain.push({ p: 'openrouter', key: KEYS.openrouter, m: 'nvidia/nemotron-3-ultra-550b-a55b:free', note: 'Nemotron Ultra 550B' });
    if (KEYS.openrouter) chain.push({ p: 'openrouter', key: KEYS.openrouter, m: 'nvidia/nemotron-3.5-super-vl:free', note: 'Nemotron 3.5 Super VL' });

  } else {
    // Balanced (default): full chain in Simon's preferred order
    // 1. Mistral Medium 3.5 — 416ms, reliable, web search, vision — MOST RELIABLE FIRST
    if (KEYS.mistral)    chain.push({ p: 'mistral',    key: KEYS.mistral,    m: 'mistral-medium-3.5',                   note: 'Mistral Medium 3.5' });
    // 2. Mistral Large Latest — 573ms, reliable, web search, vision
    if (KEYS.mistral)    chain.push({ p: 'mistral',    key: KEYS.mistral,    m: 'mistral-large-latest',                 note: 'Mistral Large Latest' });
    // 3. Gemma 4 31B via NVIDIA — 269ms when working, 262K ctx
    if (KEYS.nvidia)     chain.push({ p: 'nvidia',     key: KEYS.nvidia,     m: 'google/gemma-4-31b-it',                note: 'Gemma 4 NVIDIA' });
    // 3. Gemma 4 31B via Gemini API — Google Search grounding
    if (GKEY)            chain.push({ p: 'gemini',     key: GKEY,            m: 'gemma-4-31b-it',                       note: 'Gemma 4 Gemini' });
    // 4. Gemini 3.5 Flash — reliable, 1M ctx, no thinking mode issues
    if (GKEY)            chain.push({ p: 'gemini',     key: GKEY,            m: 'gemini-3.5-flash',                     note: 'Gemini 3.5 Flash' });
    // 5. GLM 5.3 via Mistral — 1M ctx, web search, thinking (slow ~7s, use later in chain)
    if (KEYS.mistral)    chain.push({ p: 'mistral',    key: KEYS.mistral,    m: 'zai-glm-5-2',                          note: 'GLM 5.2 via Mistral' });
    // 5b. Nemotron Ultra 550B — frontier reasoning, 1M ctx, free (slow ~15-20s)
    if (KEYS.openrouter) chain.push({ p: 'openrouter', key: KEYS.openrouter, m: 'nvidia/nemotron-3-ultra-550b-a55b:free', note: 'Nemotron Ultra 550B' });
    // 5. DeepSeek V4 Flash — 1M ctx, web search
    if (KEYS.deepseek)   chain.push({ p: 'deepseek',   key: KEYS.deepseek,   m: 'deepseek-chat',                        note: 'DeepSeek V4 Flash' });
    // 6. Cohere Command A+ — 256K ctx, RAG, web search
    if (KEYS.cohere)     chain.push({ p: 'cohere',     key: KEYS.cohere,     m: 'command-a-plus-05-2026',               note: 'Cohere Command A+' });
    // 7. GPT-OSS 120B via Groq — fast, 131K ctx
    if (KEYS.groq)       chain.push({ p: 'groq',       key: KEYS.groq,       m: 'openai/gpt-oss-120b',                  note: 'GPT-OSS 120B Groq' });
    // 8. Nemotron Ultra 550B — frontier-grade, 1M ctx, free
    if (KEYS.openrouter) chain.push({ p: 'openrouter', key: KEYS.openrouter, m: 'nvidia/nemotron-3-ultra-550b-a55b:free', note: 'Nemotron Ultra 550B' });
    // 9. MiniMax M3.1 Flash — 1M ctx, free
    if (KEYS.openrouter) chain.push({ p: 'openrouter', key: KEYS.openrouter, m: 'minimax/minimax-m3.1-flash:free',      note: 'MiniMax M3.1 Free' });
  }
  // Unconditional fallback — always responds
  chain.push({ p: 'pollinations', key: null, m: 'openai', note: 'Pollinations' });

  // RAG context injection
  if (env.PRISM_D1 && messages.length > 0) {
    try {
      const lastUser = messages.filter(m => m.role === 'user').pop()?.content?.substring(0, 500) || '';
      if (lastUser.length > 10 && GKEY) {
        const embResp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
            body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: lastUser }] }, taskType: 'RETRIEVAL_QUERY' }) }
        ).then(r => r.json()).catch(() => ({}));
        if (embResp.embedding?.values) {
          const qv = embResp.embedding.values;
          const rows = await env.PRISM_D1.prepare('SELECT doc_name,chunk_text,embedding FROM rag_chunks ORDER BY rowid DESC LIMIT 100').all().catch(() => ({ results: [] }));
          const scored = (rows.results || []).map(function(row) {
            try {
              const v = JSON.parse(row.embedding);
              // Fast dot product only (skip sqrt normalisation for speed)
              let dot = 0;
              const len = Math.min(v.length, qv.length, 256); // Only use first 256 dims for speed
              for (let i = 0; i < len; i++) { dot += qv[i] * v[i]; }
              return { text: row.chunk_text, doc: row.doc_name, score: dot };
            } catch(e) { return { text: row.chunk_text, doc: row.doc_name, score: 0 }; }
          }).sort(function(a, b) { return b.score - a.score; }).filter(function(c) { return c.score > 0; }).slice(0, 3);
          if (scored.length > 0) {
            const ragCtx = '\n\n[RELEVANT CONTEXT FROM YOUR DOCUMENTS]\n' +
              scored.map(c => `From '${c.doc}':\n${c.text}`).join('\n\n---\n\n') +
              '\n[END CONTEXT]\n';
            const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
            if (lastUserIdx !== -1) {
              messages = [...messages];
              messages[lastUserIdx] = { ...messages[lastUserIdx], content: messages[lastUserIdx].content + ragCtx };
            }
          }
        }
      }
    } catch { /* RAG errors are non-fatal */ }
  }

  // Web search injection for time-sensitive queries
  const lastUserContent = messages.filter(m => m.role === 'user').pop()?.content || '';
  const needsSearch = /\b(latest|recent|today|current|news|2024|2025|2026|who is|what is|when did|report|study|paper|findings|published|review|this week|past week|last week)\b/i.test(lastUserContent);
  if (needsSearch) {
    const tavilyKey = k(env, ['tavily_api_key', 'TAVILY_API_KEY']);
    const braveKey = k(env, ['brave_api_key', 'BRAVE_API_KEY']);
    if (tavilyKey) {
      try {
        const sr = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: lastUserContent.substring(0, 200), max_results: 5, include_answer: true }),
        });
        if (sr.ok) {
          const sd = await sr.json();
          const searchCtx = '\n\n[WEB SEARCH RESULTS]\n' +
            (sd.answer ? `Summary: ${sd.answer}\n\n` : '') +
            (sd.results || []).slice(0, 3).map(r => `${r.title}: ${r.url}\n${r.content?.substring(0, 200)}`).join('\n\n') +
            '\n[END SEARCH]\n';
          const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
          if (lastUserIdx !== -1) {
            messages = [...messages];
            messages[lastUserIdx] = { ...messages[lastUserIdx], content: messages[lastUserIdx].content + searchCtx };
          }
        }
      } catch { /* search errors non-fatal */ }
    }
  }

  const log = [];
  const t0 = Date.now();
  const FAST_PROVIDERS = ['cerebras', 'groq', 'pollinations'];
  // Thinking providers get extra time (GLM 5.3 ~7.5s, Nemotron ~15-20s, Magistral ~10s)
  const THINKING_PROVIDERS = ['zai-glm-5-2', 'magistral-medium-latest', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free'];

  for (const entry of chain) {
    if (!entry.key && entry.p !== 'pollinations') { log.push(`${entry.note}:no key`); continue; }
    // Yield to event loop between providers to avoid CPU limit
    await new Promise(function(r) { setTimeout(r, 0); });
    const ta = Date.now();
    const isThinking = THINKING_PROVIDERS.includes(entry.m);
    const timeout = FAST_PROVIDERS.includes(entry.p) ? 20000 : isThinking ? 60000 : 45000;
    // Fast providers: 20s | Thinking models (GLM, Nemotron, Magistral): 60s | Others: 45s
    try {
      const result = await Promise.race([
        callProvider(env, entry.p, entry.key, entry.m, messages),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
      ]);
      if (result?.content) {
        const formatted = formatResponse(stripTropes(result.content));
        if (!formatted || formatted.length < 2) { log.push(`${entry.note}:empty`); continue; }
        return { ...result, content: formatted, routingLog: [...log, `${entry.note}:OK(${Date.now()-ta}ms)`] };
      }
      log.push(`${entry.note}:empty(${Date.now()-ta}ms)`);
    } catch (e) {
      const ms = Date.now() - ta;
      const reason = e.message.includes('timeout') ? `timeout(${Math.round(timeout/1000)}s)` :
        e.message.includes('401') ? 'auth' : e.message.includes('429') ? 'rate-limit' : e.message.substring(0, 40);
      log.push(`${entry.note}:${reason}(${ms}ms)`);
    }
    if (Date.now() - t0 > 58000) { log.push('CPU limit'); break; }
  }

  return { content: `All providers unavailable. Log: ${log.slice(-5).join(' | ')}`, provider: 'none', error: true, routingLog: log };
}

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────────────
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
           '<rect x="' + (x+52) + '" y="' + (y+52) + '" width="46" height="46" rx="6" fill="' + ROSE2 + '" opacity="0.7"/>';
  }

  function ipWordmark(cx, y, fg) {
    return '<text x="' + (cx-100) + '" y="' + y + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="' + TEAL_LIGHT + '" text-anchor="middle">Identity</text>' +
           '<text x="' + (cx+100) + '" y="' + y + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="' + ROSE_LIGHT + '" text-anchor="middle">Partners</text>';
  }

  function ipTagline(cx, y) {
    return '<text x="' + cx + '" y="' + y + '" font-family="Georgia,serif" font-size="16" font-style="italic" fill="' + GREY + '" text-anchor="middle" opacity="0.85">Understand your past &middot; Appreciate the present &middot; Define your future</text>';
  }

  function ipFooter(cx, y) {
    return '<text x="' + cx + '" y="' + y + '" font-family="Arial,sans-serif" font-size="16" fill="' + GREY + '" text-anchor="middle" opacity="0.8">www.identitypartners.uk &middot; hello@identitypartners.uk</text>';
  }

  function quoteText(lines, startY, lineH, fg, shadow) {
    const filter = shadow ? ' filter="url(#shadow)"' : '';
    return lines.map((l, i) =>
      '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="48" font-style="italic" fill="' + fg + '" text-anchor="middle"' + filter + '>' + l + '</text>'
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
      lines.map((l, i) => '<text x="' + textX + '" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="42" font-style="italic" fill="' + IVORY + '" text-anchor="middle">' + l + '</text>').join('') +
      '<line x1="80" y1="' + attrY + '" x2="460" y2="' + attrY + '" stroke="' + GREY + '" stroke-width="2" opacity="0.6"/>' +
      '<text x="180" y="' + (attrY+40) + '" font-family="Georgia,serif" font-size="26" font-weight="600" fill="' + TEAL_LIGHT + '" text-anchor="middle">Identity</text>' +
      '<text x="360" y="' + (attrY+40) + '" font-family="Georgia,serif" font-size="26" font-weight="600" fill="' + ROSE_LIGHT + '" text-anchor="middle">Partners</text>' +
      '<text x="270" y="' + (attrY+70) + '" font-family="Georgia,serif" font-size="14" font-style="italic" fill="' + GREY + '" text-anchor="middle" opacity="0.85">Understand your past &middot; Appreciate the present &middot; Define your future</text>' +
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
      lines.map((l, i) => '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="44" font-style="italic" fill="' + tmpl.fg + '" text-anchor="middle">' + l + '</text>').join('') +
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
      lines.map((l, i) => '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="46" font-style="italic" fill="' + tmpl.fg + '" text-anchor="middle">' + l + '</text>').join('') +
      '<line x1="340" y1="' + attrY + '" x2="740" y2="' + attrY + '" stroke="' + tmpl.accent + '" stroke-width="3" opacity="0.7"/>' +
      '<text x="540" y="' + (attrY+44) + '" font-family="Georgia,serif" font-size="22" fill="' + tmpl.accent + '" text-anchor="middle" opacity="0.9">&#x2014; Identity Partners Client</text>' +
      ipWordmark(540, attrY + 90, tmpl.fg) +
      ipFooter(540, H - 28) +
      '</svg>';
  }

  return svg || '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="' + TEAL + '"/><text x="540" y="540" fill="white" text-anchor="middle" font-size="40">Canvas Error</text></svg>';
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

        const result = await orchestrate(env, messages, profile);

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
        return json({ facts: raw ? JSON.parse(raw) : [] }, 200, origin);
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

    // ── Zoho OAuth ────────────────────────────────────────────────────────────
    if (path === '/api/zoho/exchange' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { code, redirect_uri } = body;
        if (!code) return json({ error: 'No code' }, 400, origin);
        const clientId = k(env, ['ZOHO_CLIENT_ID', 'Zoho_Client_ID', 'zoho_client_id']) || '';
        const clientSecret = k(env, ['ZOHO_CLIENT_SECRET', 'Zoho_Client_Secret', 'zoho_client_secret']) || '';
        if (!clientId || !clientSecret) return json({ error: 'Zoho credentials not configured' }, 500, origin);
        const redirectUri = redirect_uri || 'https://prism.identitypartners.uk/comms/zoho-calendar/';
        let tokenData = null;
        for (const domain of ['accounts.zoho.eu', 'accounts.zoho.com']) {
          const tr = await fetch(`https://${domain}/oauth/v2/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=authorization_code&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
          }).then(r => r.json()).catch(() => ({}));
          if (tr.access_token) { tokenData = tr; break; }
        }
        if (!tokenData?.access_token) return json({ error: tokenData?.error || 'Token exchange failed', detail: tokenData }, 400, origin);
        const store = { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000, api_domain: tokenData.api_domain || 'https://calendar.zoho.eu', stored_at: new Date().toISOString() };
        await env.PRISM_KV?.put('zoho:calendar:token', JSON.stringify(store));
        await env.PRISM_KV?.put('zoho:mail:token', JSON.stringify(store));
        return json({ success: true, api_domain: store.api_domain }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/calendar/events' && request.method === 'GET') {
      try {
        const raw = await env.PRISM_KV?.get('zoho:calendar:token').catch(() => null);
        if (!raw) return json({ today: [], week: [], next_week: [], status: 'not_connected' }, 200, origin);
        const store = JSON.parse(raw);
        const apiDomain = store.api_domain || 'https://calendar.zoho.eu';
        const calResp = await fetch(`${apiDomain}/api/v1/calendars`, { headers: { 'Authorization': `Zoho-oauthtoken ${store.access_token}` } });
        if (!calResp.ok) return json({ today: [], week: [], next_week: [], status: 'api_error', code: calResp.status }, 200, origin);
        const calData = await calResp.json();
        const cals = (calData.calendars || []).slice(0, 3);
        const now = new Date();
        const endDate = new Date(now.getTime() + 14 * 86400000);
        const allEvs = [];
        for (const cal of cals) {
          const evResp = await fetch(`${apiDomain}/api/v1/calendars/${cal.uid}/events?range_start=${now.toISOString().split('T')[0]}&range_end=${endDate.toISOString().split('T')[0]}`, { headers: { 'Authorization': `Zoho-oauthtoken ${store.access_token}` } });
          if (evResp.ok) { const evData = await evResp.json(); (evData.events || []).forEach(ev => allEvs.push({ title: ev.title || 'Event', start: ev.dateandtime?.start || ev.start || '', calendar: cal.calname || 'Calendar' })); }
        }
        const todayStr = now.toISOString().split('T')[0];
        const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
        allEvs.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        return json({ today: allEvs.filter(e => e.start.substring(0, 10) === todayStr), week: allEvs.filter(e => e.start.substring(0, 10) > todayStr && e.start.substring(0, 10) <= weekEnd), next_week: allEvs.filter(e => e.start.substring(0, 10) > weekEnd), status: 'ok' }, 200, origin);
      } catch (e) { return json({ today: [], week: [], next_week: [], status: 'error', error: e.message }, 200, origin); }
    }

    // ── Bluesky ───────────────────────────────────────────────────────────────
    if (path === '/api/social/bluesky' && request.method === 'POST') {
      try {
        const body = await request.json();
        const handle = k(env, ['bluesky_handle', 'BLUESKY_HANDLE']) || '';
        const password = k(env, ['bluesky_app_password', 'BLUESKY_APP_PASSWORD']) || '';
        if (!handle || !password) return json({ error: 'Bluesky credentials not configured' }, 500, origin);
        const authResp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: handle, password }),
        }).then(r => r.json());
        if (!authResp.accessJwt) return json({ error: 'Bluesky auth failed', detail: authResp }, 400, origin);
        const postResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authResp.accessJwt}` },
          body: JSON.stringify({ repo: authResp.did, collection: 'app.bsky.feed.post', record: { text: body.text || '', createdAt: new Date().toISOString(), '$type': 'app.bsky.feed.post' } }),
        }).then(r => r.json());
        return json({ success: true, uri: postResp.uri, cid: postResp.cid }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── KV utilities ──────────────────────────────────────────────────────────
    if (path === '/api/kv/get' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'No key' }, 400, origin);
      const val = await env.PRISM_KV?.get(key).catch(() => null);
      return json({ key, value: val }, 200, origin);
    }

    if (path === '/api/kv/set' && request.method === 'POST') {
      try {
        const body = await request.json();
        await env.PRISM_KV?.put(body.key, body.value, body.ttl ? { expirationTtl: body.ttl } : undefined);
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Personas ──────────────────────────────────────────────────────────────
    if (path === '/api/personas' && request.method === 'GET') {
      const raw = await env.PRISM_KV?.get('personas:list').catch(() => null);
      return json({ personas: raw ? JSON.parse(raw) : [] }, 200, origin);
    }

    if (path === '/api/personas' && request.method === 'POST') {
      try {
        const body = await request.json();
        const raw = await env.PRISM_KV?.get('personas:list').catch(() => null);
        const personas = raw ? JSON.parse(raw) : [];
        const persona = { id: 'p-' + Date.now(), ...body, created: new Date().toISOString() };
        personas.push(persona);
        await env.PRISM_KV?.put('personas:list', JSON.stringify(personas));
        return json({ success: true, persona }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Jobs (WIP/Spool) ──────────────────────────────────────────────────────
    if (path === '/api/jobs' && request.method === 'GET') {
      try {
        const raw = await env.PRISM_KV?.get('jobs:active').catch(() => null);
        return json({ jobs: raw ? JSON.parse(raw) : [] }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === '/api/jobs/create' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { document, document_name, task, agent_name, system_prompt } = body;
        if (!document) return json({ error: 'No document' }, 400, origin);
        const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const CHUNK_SIZE = 45000;
        const chunks = [];
        for (let i = 0; i < document.length; i += CHUNK_SIZE) chunks.push(document.substring(i, i + CHUNK_SIZE));
        const job = { id: jobId, status: 'pending', document_name: document_name || 'document', task: task || '', agent_name: agent_name || 'Research Agent', system_prompt: system_prompt || '', total_chunks: chunks.length, completed_chunks: 0, results: [], created: new Date().toISOString() };
        if (env.PRISM_KV) {
          await env.PRISM_KV.put(`agent-job:${jobId}`, JSON.stringify(job), { expirationTtl: 86400 * 7 });
          for (let ci = 0; ci < chunks.length; ci++) await env.PRISM_KV.put(`agent-chunk:${jobId}:${ci}`, chunks[ci], { expirationTtl: 86400 * 7 });
          const active = JSON.parse(await env.PRISM_KV.get('jobs:active').catch(() => '[]') || '[]');
          active.unshift({ id: jobId, document_name: job.document_name, task: job.task, status: 'pending', total_chunks: chunks.length, completed_chunks: 0, created: job.created });
          await env.PRISM_KV.put('jobs:active', JSON.stringify(active.slice(0, 20)));
        }
        return json({ success: true, job_id: jobId, total_chunks: chunks.length, document_name: job.document_name }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/jobs\/[^/]+\/process$/) && request.method === 'POST') {
      try {
        const jobId = path.split('/')[3];
        const raw = await env.PRISM_KV?.get(`agent-job:${jobId}`).catch(() => null);
        if (!raw) return json({ error: 'Job not found' }, 404, origin);
        const job = JSON.parse(raw);
        if (job.status === 'complete') return json({ status: 'complete', synthesis: job.synthesis }, 200, origin);
        const nextChunk = job.completed_chunks;
        if (nextChunk >= job.total_chunks) {
          // Synthesise
          const allResults = job.results.join('\n\n=== NEXT SECTION ===\n\n');
          const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']);
          const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
          const synthMsgs = [
            { role: 'system', content: job.system_prompt || `You are ${job.agent_name}. British English. Be thorough and complete.` },
            { role: 'user', content: `Task: ${job.task}\n\nAll ${job.total_chunks} sections processed. Synthesise into a comprehensive final report:\n\n${allResults.substring(0, 60000)}` },
          ];
          const synth = await callProvider(env, 'mistral', mistralKey, 'mistral-large-latest', synthMsgs).catch(() => callProvider(env, 'gemini', GKEY, 'gemma-4-31b-it', synthMsgs)).catch(e => ({ content: `Synthesis failed: ${e.message}` }));
          job.synthesis = synth.content;
          job.status = 'complete';
          job.updated = new Date().toISOString();
          await env.PRISM_KV?.put(`agent-job:${jobId}`, JSON.stringify(job), { expirationTtl: 86400 * 7 });
          return json({ status: 'complete', chunk: nextChunk, total: job.total_chunks, synthesis: job.synthesis }, 200, origin);
        }
        const chunkText = await env.PRISM_KV?.get(`agent-chunk:${jobId}:${nextChunk}`).catch(() => null);
        if (!chunkText) { job.completed_chunks++; job.results.push(`[Chunk ${nextChunk + 1} missing]`); await env.PRISM_KV?.put(`agent-job:${jobId}`, JSON.stringify(job), { expirationTtl: 86400 * 7 }); return json({ status: 'running', chunk: nextChunk + 1, total: job.total_chunks, skipped: true }, 200, origin); }
        const mistralKey = k(env, ['mistral_api_key', 'MISTRAL_API_KEY']);
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const chunkMsgs = [
          { role: 'system', content: job.system_prompt || `You are ${job.agent_name}. British English. Extract all relevant information. Never truncate.` },
          { role: 'user', content: `Task: ${job.task}\n\nSection ${nextChunk + 1} of ${job.total_chunks} from '${job.document_name}':\n\n${chunkText}` },
        ];
        const chunkResult = await Promise.race([
          callProvider(env, 'mistral', mistralKey, 'mistral-large-latest', chunkMsgs).catch(() => callProvider(env, 'gemini', GKEY, 'gemma-4-31b-it', chunkMsgs)).catch(e => ({ content: `[Error: ${e.message}]` })),
          new Promise(res => setTimeout(() => res({ content: `[Timeout on chunk ${nextChunk + 1}]` }), 25000)),
        ]);
        job.results.push(`=== Section ${nextChunk + 1}/${job.total_chunks} ===\n${chunkResult.content}`);
        job.completed_chunks = nextChunk + 1;
        job.status = 'running';
        job.updated = new Date().toISOString();
        await env.PRISM_KV?.put(`agent-job:${jobId}`, JSON.stringify(job), { expirationTtl: 86400 * 7 });
        await env.PRISM_KV?.delete(`agent-chunk:${jobId}:${nextChunk}`).catch(() => {});
        // Update active jobs index
        const active = JSON.parse(await env.PRISM_KV?.get('jobs:active').catch(() => '[]') || '[]');
        const ai = active.findIndex(j => j.id === jobId);
        if (ai !== -1) { active[ai].completed_chunks = job.completed_chunks; active[ai].status = job.status; await env.PRISM_KV?.put('jobs:active', JSON.stringify(active)); }
        return json({ status: 'running', chunk: nextChunk + 1, total: job.total_chunks, completed: job.completed_chunks, remaining: job.total_chunks - job.completed_chunks }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/jobs\/[^/]+$/) && request.method === 'GET') {
      try {
        const jobId = path.split('/').pop();
        const raw = await env.PRISM_KV?.get(`agent-job:${jobId}`).catch(() => null);
        if (!raw) return json({ error: 'Job not found' }, 404, origin);
        return json(JSON.parse(raw), 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/jobs\/[^/]+$/) && request.method === 'DELETE') {
      try {
        const jobId = path.split('/').pop();
        await env.PRISM_KV?.delete(`agent-job:${jobId}`).catch(() => {});
        const active = JSON.parse(await env.PRISM_KV?.get('jobs:active').catch(() => '[]') || '[]');
        await env.PRISM_KV?.put('jobs:active', JSON.stringify(active.filter(j => j.id !== jobId)));
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Dev Team ──────────────────────────────────────────────────────────────
    if (path === '/api/devteam' && request.method === 'POST') {
      try {
        const body = await request.json();
        const agentId = body.agent || 'pm';
        const userMessage = body.message || '';
        const customSystemPrompt = body.systemPrompt || null;
        const customMessages = body.messages || null;
        const agentName = body.agentName || agentId;

        const DEV_TEAM_PROMPTS = {
          pm: `You are Gerald, the Programme Manager for Argentica — the personal AI operating environment of Simon Johnson / Identity Partners. You have full access to the system and can execute tasks directly. British English. Never sycophantic. Never describe actions — do them. Never ask Simon to do anything technical.\n\nSYSTEM:\n- Worker: https://prism-api.identitypartners.workers.dev\n- Pages: https://prism.identitypartners.uk\n- Repo: IdentityPartners/prism (GitHub)\n- CF Account: d741de91f8cfff2306cc0f850a76ee07\n- KV: 8d1a583cc99a482380aacb526d873030\n- D1: e953848b-7d62-4629-bb4d-271da0d03fd5`,
          researcher: 'You are the Research Agent for Argentica. Find, synthesise, and structure information. British English. Cite sources. Never fabricate.',
          'media-manager': 'You are the Media Manager for Argentica. You own all content publication. Nothing publishes without your approval. British English.',
          creator: 'You are the Creator Agent for Argentica. Create social posts, scripts, and content for Identity Partners. British English. Evidence-based, warm, direct.',
          'api-champion': 'You are the API Champion for Argentica. Monitor model providers, test endpoints, update routing chain. British English.',
          'harms-analyst': 'You are the Harms Analyst for Argentica. Analyse documents to map media and governmental treatment of protected groups. British English. Work methodically. Never skip or truncate.',
        };

        const sysPrompt = customSystemPrompt
          ? `You are ${agentName} for Identity Partners. ${customSystemPrompt}\n\nBritish English. Execute tasks completely. Never truncate. Show all your work.`
          : (DEV_TEAM_PROMPTS[agentId] || DEV_TEAM_PROMPTS.pm);

        let devMessages;
        if (customMessages?.length > 0) {
          devMessages = [{ role: 'system', content: sysPrompt }, ...customMessages.filter(m => m.role !== 'system')];
        } else {
          devMessages = [{ role: 'system', content: sysPrompt }, { role: 'user', content: userMessage }];
        }

        const result = await orchestrate(env, devMessages, 'balanced');
        return json({ content: result.content, provider: result.provider, model: result.model, agent: agentId }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Image generation ──────────────────────────────────────────────────────
    if (path === '/api/image' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = body.prompt || '';
        const model = body.model || 'auto';
        const falKey = k(env, ['fal_api_key', 'FAL_API_KEY']);
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        const xaiKey = k(env, ['xai_api_key', 'XAI_API_KEY']);

        // Try Gemini image generation first (free)
        if (GKEY && (model === 'auto' || model.includes('gemini'))) {
          const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
          }).then(r => r.json()).catch(() => ({}));
          const parts = gr.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData) return json({ url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, provider: 'gemini', model: 'gemini-3.1-flash-image' }, 200, origin);
          }
        }

        // FAL fallback
        if (falKey) {
          const fr = await fetch('https://fal.run/fal-ai/flux/schnell', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${falKey}` },
            body: JSON.stringify({ prompt, image_size: 'landscape_4_3', num_images: 1 }),
          }).then(r => r.json()).catch(() => ({}));
          if (fr.images?.[0]?.url) return json({ url: fr.images[0].url, provider: 'fal', model: 'flux-schnell' }, 200, origin);
        }

        // Pollinations fallback (always free)
        const polUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=768&nologo=true&model=flux`;
        return json({ url: polUrl, provider: 'pollinations', model: 'flux' }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Voice/TTS ─────────────────────────────────────────────────────────────
    if (path === '/api/voice/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { text, voice, provider: prov = 'cartesia' } = body;
        if (!text) return json({ error: 'No text' }, 400, origin);
        const cartesiaKey = k(env, ['cartesia_api_key', 'CARTESIA_API_KEY']);
        if (cartesiaKey) {
          const cr = await fetch('https://api.cartesia.ai/tts/bytes', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': cartesiaKey, 'Cartesia-Version': '2024-06-10' },
            body: JSON.stringify({ model_id: 'sonic-2', transcript: text, voice: { mode: 'id', id: voice || 'a0e99841-438c-4a64-b679-ae501e7d6091' }, output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 } }),
          });
          if (cr.ok) {
            const audio = await cr.arrayBuffer();
            return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', ...cors(origin) } });
          }
        }
        return json({ error: 'No TTS provider available' }, 500, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Music (Lyria) ─────────────────────────────────────────────────────────
    if (path === '/api/music/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { prompt, model: musicModel = 'lyria-3.5' } = body;
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';
        if (!GKEY) return json({ error: 'No Gemini key' }, 500, origin);
        const mr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${musicModel}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        if (!mr.ok) return json({ error: `Lyria ${mr.status}` }, 500, origin);
        const md = await mr.json();
        const parts = md.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            const audio = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
            return new Response(audio, { headers: { 'Content-Type': part.inlineData.mimeType || 'audio/mpeg', ...cors(origin) } });
          }
        }
        return json({ error: 'No audio in response' }, 500, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Transcribe (Whisper via Groq) ─────────────────────────────────────────
    if (path === '/api/transcribe' && request.method === 'POST') {
      try {
        const groqKey = k(env, ['groq_free_1', 'GROQ_FREE_1']);
        if (!groqKey) return json({ error: 'No Groq key' }, 500, origin);
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) return json({ error: 'No file' }, 400, origin);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('model', 'whisper-large-v3');
        const tr = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST', headers: { 'Authorization': `Bearer ${groqKey}` }, body: fd,
        }).then(r => r.json());
        return json({ text: tr.text || '' }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    if (path === '/api/agents/list' && request.method === 'GET') {
      const raw = await env.PRISM_KV?.get('agents:list').catch(() => null);
      return json({ agents: raw ? JSON.parse(raw) : [] }, 200, origin);
    }

    if (path === '/api/agents/save' && request.method === 'POST') {
      try {
        const body = await request.json();
        const raw = await env.PRISM_KV?.get('agents:list').catch(() => null);
        const agents = raw ? JSON.parse(raw) : [];
        const existing = agents.findIndex(a => a.id === body.id);
        if (existing !== -1) agents[existing] = body; else agents.push(body);
        await env.PRISM_KV?.put('agents:list', JSON.stringify(agents));
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.match(/^\/api\/agents\/[^/]+$/) && request.method === 'DELETE') {
      try {
        const id = path.split('/').pop();
        const raw = await env.PRISM_KV?.get('agents:list').catch(() => null);
        const agents = raw ? JSON.parse(raw) : [];
        await env.PRISM_KV?.put('agents:list', JSON.stringify(agents.filter(a => a.id !== id)));
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Workflows ─────────────────────────────────────────────────────────────
    if (path === '/api/workflows/list' && request.method === 'GET') {
      const raw = await env.PRISM_KV?.get('workflows:list').catch(() => null);
      return json({ workflows: raw ? JSON.parse(raw) : [] }, 200, origin);
    }

    if (path === '/api/workflows/save' && request.method === 'POST') {
      try {
        const body = await request.json();
        const raw = await env.PRISM_KV?.get('workflows:list').catch(() => null);
        const workflows = raw ? JSON.parse(raw) : [];
        const existing = workflows.findIndex(w => w.id === body.id);
        if (existing !== -1) workflows[existing] = body; else workflows.push(body);
        await env.PRISM_KV?.put('workflows:list', JSON.stringify(workflows));
        return json({ success: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Champion ──────────────────────────────────────────────────────────────
    if (path === '/api/champion/test-providers' && request.method === 'POST') {
      try {
        const testMsg = [{ role: 'user', content: 'Reply with exactly: OK' }];
        const providers = [
          { name: 'GLM 5.3 via Mistral', p: 'mistral', key: k(env, ['mistral_api_key', 'MISTRAL_API_KEY']), m: 'zai-glm-5-2' },
          { name: 'Mistral Large 4', p: 'mistral', key: k(env, ['mistral_api_key', 'MISTRAL_API_KEY']), m: 'mistral-large-latest' },
          { name: 'Gemma 4 NVIDIA', p: 'nvidia', key: k(env, ['nvidia_build_api_key', 'NVIDIA_BUILD_API_KEY']), m: 'google/gemma-4-31b-it' },
          { name: 'DeepSeek V4', p: 'deepseek', key: k(env, ['deepseek_paid', 'DEEPSEEK_PAID']), m: 'deepseek-chat' },
          { name: 'Grok 3 Mini', p: 'xai', key: k(env, ['xai_api_key', 'XAI_API_KEY']), m: 'grok-3-mini' },
          { name: 'Cohere R+', p: 'cohere', key: k(env, ['cohere_api_key', 'COHERE_API_KEY']), m: 'command-r-plus-08-2024' },
          { name: 'Cerebras GPT-OSS', p: 'cerebras', key: k(env, ['cerebras_paid', 'CEREBRAS_PAID']), m: 'gpt-oss-120b' },
          { name: 'Groq Llama 4', p: 'groq', key: k(env, ['groq_free_1', 'GROQ_FREE_1']), m: 'meta-llama/llama-4-scout-17b-16e-instruct' },
          { name: 'Pollinations', p: 'pollinations', key: null, m: 'openai' },
        ];
        const results = await Promise.all(providers.map(async prov => {
          if (!prov.key && prov.p !== 'pollinations') return { name: prov.name, status: 'no_key', ms: 0 };
          const t0 = Date.now();
          return Promise.race([
            callProvider(env, prov.p, prov.key, prov.m, testMsg)
              .then(r => ({ name: prov.name, model: prov.m, status: 'ok', response: r.content?.substring(0, 30), ms: Date.now() - t0 }))
              .catch(e => ({ name: prov.name, model: prov.m, status: 'error', error: e.message.substring(0, 60), ms: Date.now() - t0 })),
            new Promise(res => setTimeout(() => res({ name: prov.name, status: 'timeout', ms: 15000 }), 15000)),
          ]);
        }));
        const ok = results.filter(r => r.status === 'ok').length;
        return json({ tested: providers.length, ok, results }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Agentic social canvas pipeline ───────────────────────────────────────
    if (path === '/api/canvas/social' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || '';
        const platforms = body.platforms || ['bluesky', 'instagram', 'facebook'];
        const topic = body.topic || 'identity-partners';
        const GKEY = k(env, ['gemini_api_key', 'GEMINI_API_KEY']) || '';

        if (!text) return json({error: 'No text provided'}, 400, origin);

        // Step 1: Generate image via Gemini image gen (free, no Playwright needed)
        let imageDataUrl = null;
        let imageSource = 'svg';

        if (GKEY) {
          try {
            const imgResp = await fetch(
              'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
              {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'x-goog-api-key': GKEY},
                body: JSON.stringify({
                  contents: [{parts: [{text: 'Professional landscape photography for social media background. Serene nature vista, no people, no text, wide format, high quality. Style: ' + (topic || 'peaceful landscape')}]}],
                  generationConfig: {responseModalities: ['IMAGE', 'TEXT']}
                })
              }
            );
            if (imgResp.ok) {
              const imgData = await imgResp.json();
              const parts = imgData.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.inlineData) {
                  imageDataUrl = 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data;
                  imageSource = 'gemini';
                  break;
                }
              }
            }
          } catch(e) { /* fall through to SVG */ }
        }

        // Step 2: Build SVG canvas
        const safeText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const words = safeText.split(' ');
        const lines = [];
        let line = '';
        words.forEach(function(w) {
          if ((line + ' ' + w).trim().length > 28 && line) { lines.push(line.trim()); line = w; }
          else { line = (line + ' ' + w).trim(); }
        });
        if (line) lines.push(line.trim());
        const lineH = 68;
        const startY = Math.max(220, 540 - (lines.length * lineH) / 2);
        const attrY = startY + lines.length * lineH + 40;
        const textEls = lines.map(function(l, i) {
          return '<text x="540" y="' + (startY + i * lineH) + '" font-family="Georgia,serif" font-size="48" font-style="italic" fill="#f7f3e9" text-anchor="middle" filter="url(#shadow)">' + l + '</text>';
        }).join('');

        const bgEl = imageDataUrl
          ? '<image href="' + imageDataUrl + '" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="1080" fill="rgba(15,59,58,0.55)"/>'
          : '<rect width="1080" height="1080" fill="#0f3b3a"/>';

        const svg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080"><defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.8)"/></filter></defs>' + bgEl + '<rect x="0" y="0" width="1080" height="10" fill="#ddd0c8" opacity="0.85"/><rect x="0" y="1070" width="1080" height="10" fill="#ddd0c8" opacity="0.85"/><rect x="30" y="30" width="46" height="46" rx="6" fill="#0f3b3a" opacity="0.9"/><rect x="82" y="30" width="46" height="46" rx="6" fill="#5c2d3f" opacity="0.9"/><rect x="30" y="82" width="46" height="46" rx="6" fill="#1a5550" opacity="0.7"/><rect x="82" y="82" width="46" height="46" rx="6" fill="#7a4254" opacity="0.7"/><text x="80" y="210" font-family="Georgia,serif" font-size="110" fill="#f7f3e9" opacity="0.1">&#x201C;</text>' + textEls + '<line x1="380" y1="' + attrY + '" x2="700" y2="' + attrY + '" stroke="#ddd0c8" stroke-width="2" opacity="0.65"/><text x="440" y="' + (attrY+48) + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="#7ecfcd" text-anchor="middle">Identity</text><text x="640" y="' + (attrY+48) + '" font-family="Georgia,serif" font-size="30" font-weight="600" fill="#d4899a" text-anchor="middle">Partners</text><text x="540" y="' + (attrY+82) + '" font-family="Georgia,serif" font-size="18" font-style="italic" fill="#ddd0c8" text-anchor="middle" opacity="0.85">Understand your past &#xB7; Appreciate the present &#xB7; Define your future</text><text x="540" y="1042" font-family="Arial,sans-serif" font-size="18" fill="#ddd0c8" text-anchor="middle" opacity="0.85">www.identitypartners.uk &#xB7; hello@identitypartners.uk</text></svg>';

        // Step 3: Store in R2
        const canvasKey = 'social-canvas-' + Date.now() + '.svg';
        let canvasUrl = null;
        if (env.PRISM_ASSETS) {
          await env.PRISM_ASSETS.put(canvasKey, svg, {httpMetadata: {contentType: 'image/svg+xml'}, expirationTtl: 86400 * 30});
          canvasUrl = 'https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/' + canvasKey;
        }

        // Step 4: Queue for Media Manager
        const queueItems = [];
        for (var pi = 0; pi < platforms.length; pi++) {
          var platform = platforms[pi];
          var qKey = 'mm:queue:' + Date.now() + ':' + platform + ':' + pi;
          var item = {id: qKey, platform: platform, text: text, imageUrl: canvasUrl, imageSource: imageSource, topic: topic, status: 'pending', source: 'agentic-pipeline', created: new Date().toISOString()};
          if (env.PRISM_KV) await env.PRISM_KV.put(qKey, JSON.stringify(item));
          queueItems.push(item);
        }

        return json({success: true, canvas: {url: canvasUrl, source: imageSource}, queued: queueItems.length, platforms: platforms, message: queueItems.length + ' items queued for Media Manager approval'}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Dev Team tool execution ───────────────────────────────────────────────
    if (path === '/api/devteam/execute' && request.method === 'POST') {
      try {
        const body = await request.json();
        const action = body.action || '';
        const GH_TOKEN = k(env, ['github_token', 'GITHUB_TOKEN']) || '';
        const CF_TOKEN_VAL = k(env, ['cloudflare_token', 'CLOUDFLARE_TOKEN']) || '';
        const CF_ACCOUNT_ID = 'd741de91f8cfff2306cc0f850a76ee07';
        const results = {};

        if (action === 'test_providers') {
          const testResult = await fetch('https://prism-api.identitypartners.workers.dev/api/champion/test-providers', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json();}).catch(function(e){return {error:e.message};});
          results.providers = testResult;
        }

        if (action === 'check_worker') {
          const workerResp = await fetch('https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/workers/scripts', {headers: {'Authorization': 'Bearer ' + CF_TOKEN_VAL}}).then(function(r){return r.json();}).catch(function(e){return {error:e.message};});
          results.worker = {scripts: (workerResp.result||[]).map(function(s){return {id:s.id,modified:s.modified_on};})};
        }

        if (action === 'push_file' && body.path && body.content && GH_TOKEN) {
          const getResp = await fetch('https://api.github.com/repos/IdentityPartners/prism/contents/' + body.path, {headers: {'Authorization': 'token ' + GH_TOKEN, 'User-Agent': 'Argentica-DevTeam'}}).then(function(r){return r.json();}).catch(function(){return null;});
          const sha = getResp && getResp.sha ? getResp.sha : undefined;
          const b64content = btoa(unescape(encodeURIComponent(body.content)));
          const pushPayload = {message: body.message || 'Dev Team auto-fix', content: b64content, branch: 'main'};
          if (sha) pushPayload.sha = sha;
          const pushResp = await fetch('https://api.github.com/repos/IdentityPartners/prism/contents/' + body.path, {method:'PUT',headers:{'Authorization':'token '+GH_TOKEN,'User-Agent':'Argentica-DevTeam','Content-Type':'application/json'},body:JSON.stringify(pushPayload)}).then(function(r){return r.json();}).catch(function(e){return {error:e.message};});
          results.push = {path: body.path, sha: pushResp && pushResp.content ? pushResp.content.sha.substring(0,8) : null, success: !!(pushResp && pushResp.content && pushResp.content.sha)};
        }

        if (action === 'get_kv' && body.key) {
          const val = await env.PRISM_KV?.get(body.key).catch(function(){return null;});
          results.value = val;
        }

        if (action === 'set_kv' && body.key && body.value) {
          await env.PRISM_KV?.put(body.key, body.value).catch(function(){});
          results.set = true;
        }

        return json({success: true, action: action, results: results}, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
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
