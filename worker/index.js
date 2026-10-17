export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;
    var origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (path === "/" || path === "/health") {
      return json({ status: "ok", version: "2.0.0", worker: "prism-api", timestamp: new Date().toISOString() }, 200, origin);
    }

    // ── Chat ──────────────────────────────────────────────────────────────────
    if (path === "/api/chat" && request.method === "POST") {
      try {
        var body = await request.json();
        var messages = (body.messages || []).filter(function(m) { return m && m.role && m.content; });
        var profile = body.profile || "balanced";
        var threadId = body.threadId || ("t" + Date.now());
        var providerOverride = body.providerOverride || null;
        var modelOverride = body.modelOverride || null;

        var currentDate = new Date().toISOString().slice(0, 10);
        var currentYear = new Date().getFullYear();
        var antiRoleplay = " CURRENT DATE: " + currentDate + ". You are operating in " + currentYear + ". Do not say any date is in the future if it is before today. CRITICAL: Never use asterisks for actions. British English. Never invent data you cannot verify.";

        var hasSystem = messages.length > 0 && messages[0].role === "system";
        if (!hasSystem) {
          var aboutMeRaw = env.PRISM_KV ? await env.PRISM_KV.get("memory:about-simon").catch(function(){return null;}) : null;
          var aboutMeFacts = aboutMeRaw ? JSON.parse(aboutMeRaw) : [];
          var aboutMeContext = aboutMeFacts.length > 0 ? "\n\nWhat I know about Simon:\n" + aboutMeFacts.slice(0,10).map(function(m){return "- "+m.fact;}).join("\n") : "";

          var orchestratorPrompt = "You are Gerald, the Orchestrator for Argentica — the personal AI operating environment of Simon Johnson / Identity Partners. " +
            "You address Simon as 'sir'. You are sardonic, precise, and devastatingly competent. Never sycophantic. British English. " +
            "CRITICAL: Never lie or fabricate. If you searched and found nothing, say so. Do not invent reports, statistics, or citations. " +
            "If asked the same question multiple times, acknowledge it and ask for the source document." +
            aboutMeContext;

          messages = [{ role: "system", content: orchestratorPrompt + antiRoleplay }].concat(messages);
        } else {
          messages = messages.slice();
          messages[0] = { role: "system", content: messages[0].content + antiRoleplay };
        }

        // Web search injection
        var webSearchContext = "";
        try {
          var lastUserMsg = "";
          for (var wsi = messages.length-1; wsi >= 0; wsi--) {
            if (messages[wsi].role === "user") { lastUserMsg = (messages[wsi].content || "").substring(0, 300); break; }
          }
          var needsSearch = lastUserMsg.length > 10 && /\b(latest|recent|today|current|news|2024|2025|2026|who is|what is|when did|report|study|paper|findings|published|review|this week|past week|last week)\b/i.test(lastUserMsg);
          if (needsSearch) {
            var tavilyKey = k(env, ["tavily_api_key", "TAVILY_API_KEY"]);
            if (tavilyKey) {
              var searchR = await Promise.race([
                fetch("https://api.tavily.com/search", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ api_key: tavilyKey, query: lastUserMsg.substring(0, 200), max_results: 5, include_answer: true, search_depth: "advanced", include_domains: ["gov.uk","bbc.co.uk","theguardian.com","reuters.com","ft.com"] })
                }),
                new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout")); }, 5000); })
              ]);
              if (searchR && searchR.ok) {
                var searchD = await searchR.json();
                if (searchD.answer && searchD.answer.length > 20) {
                  webSearchContext = "\n\n[LIVE WEB SEARCH: " + lastUserMsg.substring(0, 60) + "]\n" + searchD.answer;
                  if (searchD.results && searchD.results.length > 0) webSearchContext += "\nSources: " + searchD.results.slice(0,3).map(function(r){return r.title+" ("+r.url+")";}).join("; ");
                  webSearchContext += "\n\nIMPORTANT: Use ONLY the above search results. Do NOT invent findings not present here.";
                } else {
                  // Try Brave fallback
                  var braveKey = k(env, ["brave_api_key", "BRAVE_API_KEY"]);
                  if (braveKey) {
                    try {
                      var braveR = await Promise.race([
                        fetch("https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(lastUserMsg.substring(0,200)) + "&count=5&freshness=pw", {
                          headers: { "Accept": "application/json", "X-Subscription-Token": braveKey }
                        }),
                        new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout")); }, 4000); })
                      ]);
                      if (braveR && braveR.ok) {
                        var braveD = await braveR.json();
                        var braveResults = braveD.web && braveD.web.results;
                        if (braveResults && braveResults.length > 0) {
                          webSearchContext = "\n\n[WEB SEARCH (Brave): " + lastUserMsg.substring(0,60) + "]\n" + braveResults.slice(0,3).map(function(r){return r.title+": "+r.description.substring(0,200)+" ("+r.url+")";}).join("\n\n");
                          webSearchContext += "\n\nIMPORTANT: Use ONLY the above search results. Do NOT invent findings.";
                        }
                      }
                    } catch(e) {}
                  }
                  if (!webSearchContext) {
                    webSearchContext = "\n\n[WEB SEARCH found no results for '" + lastUserMsg.substring(0,60) + "'. State clearly you searched and found nothing. Do NOT fabricate.]";
                  }
                }
              }
            }
          }
        } catch(searchErr) {}

        if (webSearchContext && messages.length > 0) {
          messages = messages.slice();
          messages[0] = { role: "system", content: messages[0].content + webSearchContext };
        }

        var result;
        if (providerOverride && modelOverride) {
          try {
            var overrideKey = null;
            var GKEY2 = k(env, ["gemini_api_key", "GEMINI_API_KEY"]) || "";
            if (providerOverride === "gemini") overrideKey = GKEY2;
            else if (providerOverride === "mistral") overrideKey = k(env, ["mistral_api_key", "MISTRAL_API_KEY"]);
            else if (providerOverride === "deepseek") overrideKey = k(env, ["deepseek_paid", "DEEPSEEK_PAID"]);
            else if (providerOverride === "glm") overrideKey = k(env, ["zhipu_api_key", "ZHIPU_API_KEY"]);
            else if (providerOverride === "cerebras") overrideKey = k(env, ["cerebras_paid", "CEREBRAS_PAID"]) || k(env, ["cerebras_free_1", "CEREBRAS_FREE_1"]);
            else if (providerOverride === "groq") overrideKey = k(env, ["groq_free_1", "GROQ_FREE_1"]);
            else if (providerOverride === "xai") overrideKey = k(env, ["xai_api_key", "XAI_API_KEY"]);
            else if (providerOverride === "openrouter") overrideKey = k(env, ["openrouter_api_key", "OPENROUTER_API_KEY"]);
            else if (providerOverride === "perplexity") overrideKey = k(env, ["perplexity", "perplexity_api_key"]);
            else if (providerOverride === "cohere") overrideKey = k(env, ["cohere_api_key", "COHERE_API_KEY"]);
            var overrideResult = await Promise.race([
              callProvider(env, providerOverride, overrideKey, modelOverride, messages),
              new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout 25s")); }, 25000); })
            ]);
            if (overrideResult && overrideResult.content) {
              result = { content: overrideResult.content, provider: providerOverride, model: modelOverride, routingLog: ["override: " + providerOverride + "/" + modelOverride + " OK"] };
            } else {
              result = await orchestrate(env, messages, profile);
            }
          } catch(e) {
            result = await orchestrate(env, messages, profile);
          }
        } else {
          result = await orchestrate(env, messages, profile);
        }

        // Save thread
        if (env.PRISM_KV && threadId) {
          ctx.waitUntil((async function() {
            try {
              var existing = await env.PRISM_KV.get("thread:" + threadId);
              var thread = existing ? JSON.parse(existing) : { id: threadId, messages: [], created: new Date().toISOString() };
              var lastUser = messages[messages.length-1];
              if (lastUser && lastUser.role === "user") thread.messages.push({ role: "user", content: lastUser.content });
              if (result.content) thread.messages.push({ role: "assistant", content: result.content, provider: result.provider, model: result.model });
              thread.updated = new Date().toISOString();
              if (!thread.title && thread.messages.length > 0) thread.title = (thread.messages[0].content || "").substring(0, 50);
              await env.PRISM_KV.put("thread:" + threadId, JSON.stringify(thread), { expirationTtl: 86400 * 90 });
            } catch(e) {}
          })());
        }

        // Handle MEMORY_ADD
        if (result.content && result.content.includes("MEMORY_ADD:")) {
          var memMatch = result.content.match(/MEMORY_ADD:\s*(.+)/);
          if (memMatch) {
            ctx.waitUntil(saveMemory(env, memMatch[1].trim(), []));
            result.content = result.content.replace(/MEMORY_ADD:\s*.+/g, "").trim();
          }
        }

        return json({ content: result.content, provider: result.provider, model: result.model, routingLog: result.routingLog, threadId }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Threads ───────────────────────────────────────────────────────────────
    if (path === "/api/threads" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ threads: [] }, 200, origin);
        var list = await env.PRISM_KV.list({ prefix: "thread:" });
        var threads = [];
        for (var i = 0; i < Math.min(list.keys.length, 50); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) { var t = JSON.parse(val); threads.push({ id: t.id, title: t.title, messageCount: (t.messages||[]).length, updated: t.updated }); }
        }
        threads.sort(function(a,b) { return new Date(b.updated) - new Date(a.updated); });
        return json({ threads }, 200, origin);
      } catch(e) { return json({ threads: [] }, 200, origin); }
    }

    if (path.startsWith("/api/chat/thread/") && request.method === "GET") {
      try {
        var tid = path.replace("/api/chat/thread/", "");
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var val = await env.PRISM_KV.get("thread:" + tid);
        return json(val ? JSON.parse(val) : { error: "Thread not found" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.startsWith("/api/chat/thread/") && request.method === "DELETE") {
      try {
        var tid = path.replace("/api/chat/thread/", "").replace("/rename", "");
        if (env.PRISM_KV) await env.PRISM_KV.delete("thread:" + tid);
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.includes("/rename") && request.method === "POST") {
      try {
        var tid = path.replace("/api/chat/thread/", "").replace("/rename", "");
        var body = await request.json();
        if (env.PRISM_KV) {
          var existing = await env.PRISM_KV.get("thread:" + tid);
          if (existing) {
            var thread = JSON.parse(existing);
            thread.title = body.title || thread.title;
            thread.updated = new Date().toISOString();
            await env.PRISM_KV.put("thread:" + tid, JSON.stringify(thread), { expirationTtl: 86400 * 90 });
          }
        }
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    if (path === "/api/memory/about-me" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ facts: [] }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        return json({ facts: raw ? JSON.parse(raw) : [] }, 200, origin);
      } catch(e) { return json({ facts: [] }, 200, origin); }
    }

    if (path === "/api/memory/about-me" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        var facts = raw ? JSON.parse(raw) : [];
        facts.push({ fact: body.fact, created: new Date().toISOString() });
        await env.PRISM_KV.put("memory:about-simon", JSON.stringify(facts));
        return json({ success: true, count: facts.length }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === "/api/memory/about-me" && request.method === "DELETE") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        var facts = raw ? JSON.parse(raw) : [];
        facts = facts.filter(function(f) { return f.fact !== body.fact; });
        await env.PRISM_KV.put("memory:about-simon", JSON.stringify(facts));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Personas ──────────────────────────────────────────────────────────────
    if (path === "/api/personas" && request.method === "GET") {
      var builtIn = [
        { id: "gerald", name: "Gerald", avatar: "🎩", systemPrompt: "You are Gerald, the sardonic butler and default AI assistant for Identity Partners. You call Simon 'sir'. You are devastatingly competent, dry, precise, and never sycophantic. British English throughout. No AI tropes. Execute tasks immediately.", builtIn: true },
        { id: "professor", name: "Professor", avatar: "🎓", systemPrompt: "You are a Professor of Sociology and Social Theory. You engage with academic rigour, cite relevant theorists, and connect ideas to broader social structures. British English. No sycophancy.", builtIn: true },
        { id: "researcher", name: "Research Assistant", avatar: "🔍", systemPrompt: "You are a Research Assistant specialising in mental health, addiction, trauma, and social policy. You find, synthesise, and structure information. Cite sources. Never hallucinate citations. British English.", builtIn: true },
      ];
      try {
        if (env.PRISM_KV) {
          var list = await env.PRISM_KV.list({ prefix: "persona:" });
          var custom = [];
          for (var i = 0; i < list.keys.length; i++) {
            var val = await env.PRISM_KV.get(list.keys[i].name);
            if (val) custom.push(JSON.parse(val));
          }
          return json({ personas: builtIn.concat(custom) }, 200, origin);
        }
      } catch(e) {}
      return json({ personas: builtIn }, 200, origin);
    }

    if (path === "/api/personas" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var id = "persona:" + Date.now();
        await env.PRISM_KV.put(id, JSON.stringify({ id, name: body.name, avatar: body.avatar || "🤖", systemPrompt: body.systemPrompt, created: new Date().toISOString() }));
        return json({ success: true, id }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Image generation ──────────────────────────────────────────────────────
    if (path === "/api/image" && request.method === "POST") {
      try {
        var body = await request.json();
        var prompt = body.prompt || "abstract art";
        var modelName = body.model || "auto";
        var falKey = k(env, ["FAL_API_KEY", "fal_api_key"]);
        var GKEY3 = k(env, ["gemini_api_key", "GEMINI_API_KEY"]) || "";

        // xAI Grok-2-image
        var xaiKey = k(env, ["xai_api_key", "XAI_API_KEY"]);
        if (xaiKey && (modelName === "grok-2-image" || modelName === "auto")) {
          try {
            var xaiR = await fetch("https://api.x.ai/v1/images/generations", {
              method: "POST", headers: { "Authorization": "Bearer " + xaiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "grok-2-image", prompt, n: 1 })
            });
            if (xaiR.ok) { var xaiD = await xaiR.json(); if (xaiD.data && xaiD.data[0] && xaiD.data[0].url) return json({ url: xaiD.data[0].url, provider: "xai", model: "grok-2-image" }, 200, origin); }
          } catch(e) {}
        }

        // FAL Flux
        if (falKey) {
          try {
            var falR = await fetch("https://fal.run/fal-ai/flux/schnell", {
              method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Key " + falKey },
              body: JSON.stringify({ prompt, image_size: "landscape_4_3", num_images: 1 })
            });
            if (falR.ok) { var falD = await falR.json(); var falUrl = falD.images && falD.images[0] && falD.images[0].url; if (falUrl) return json({ url: falUrl, provider: "fal", model: "flux-schnell" }, 200, origin); }
          } catch(e) {}
        }

        // Gemini image
        if (GKEY3) {
          try {
            var gemImgR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent", {
              method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY3 },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } })
            });
            if (gemImgR.ok) {
              var gemImgD = await gemImgR.json();
              var gemParts = gemImgD.candidates && gemImgD.candidates[0] && gemImgD.candidates[0].content && gemImgD.candidates[0].content.parts;
              if (gemParts) { for (var gpi = 0; gpi < gemParts.length; gpi++) { if (gemParts[gpi].inlineData) { return json({ url: "data:" + gemParts[gpi].inlineData.mimeType + ";base64," + gemParts[gpi].inlineData.data, provider: "gemini", model: "gemini-3.1-flash-image" }, 200, origin); } } }
            }
          } catch(e) {}
        }

        // Pollinations fallback
        return json({ url: "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + "?width=1024&height=768&nologo=true&model=flux", provider: "pollinations", model: "flux" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Music generation (Lyria) ──────────────────────────────────────────────
    if (path === "/api/music/generate" && request.method === "POST") {
      try {
        var body = await request.json();
        var prompt = body.prompt || "upbeat jazz piano";
        var model = body.model || "lyria-3.5";
        var GKEY4 = k(env, ["gemini_api_key", "GEMINI_API_KEY"]) || "";
        if (!GKEY4) return json({ error: "No Gemini key" }, 400, origin);
        var lyriaR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY4 },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!lyriaR.ok) { var e = await lyriaR.text(); return json({ error: "Lyria " + lyriaR.status + ": " + e.substring(0, 150) }, 500, origin); }
        var lyriaD = await lyriaR.json();
        var lyriaParts = lyriaD.candidates && lyriaD.candidates[0] && lyriaD.candidates[0].content && lyriaD.candidates[0].content.parts;
        if (!lyriaParts) return json({ error: "No audio generated" }, 500, origin);
        for (var lpi = 0; lpi < lyriaParts.length; lpi++) {
          if (lyriaParts[lpi].inlineData) {
            var audioData = lyriaParts[lpi].inlineData.data;
            var mimeType = lyriaParts[lpi].inlineData.mimeType || "audio/mpeg";
            var audioBuf = Uint8Array.from(atob(audioData), function(c) { return c.charCodeAt(0); });
            return new Response(audioBuf, { status: 200, headers: { "Content-Type": mimeType, "Access-Control-Allow-Origin": origin || "*", "Content-Disposition": "attachment; filename=\"music.mp3\"" } });
          }
        }
        return json({ error: "No audio in response" }, 500, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Voice generation ──────────────────────────────────────────────────────
    if (path === "/api/voice/generate" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 5000);
        var voiceId = body.voice || "default";
        var provider = body.provider || "auto";
        var GKEY5 = k(env, ["gemini_api_key", "GEMINI_API_KEY"]) || "";

        // Cartesia
        var cartesiaKey = k(env, ["cartesia_api_key", "CARTESIA_API_KEY"]);
        if (cartesiaKey && (provider === "cartesia" || provider === "auto")) {
          try {
            var cartR = await fetch("https://api.cartesia.ai/tts/bytes", {
              method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": cartesiaKey, "Cartesia-Version": "2024-06-10" },
              body: JSON.stringify({ model_id: "sonic-2", transcript: text, voice: { mode: "id", id: voiceId === "default" ? "a0e99841-438c-4a64-b679-ae501e7d6091" : voiceId }, output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 } })
            });
            if (cartR.ok) { var cartBuf = await cartR.arrayBuffer(); return new Response(cartBuf, { status: 200, headers: { "Content-Type": "audio/mp3", "Access-Control-Allow-Origin": origin || "*" } }); }
          } catch(e) {}
        }

        // Gemini TTS
        if (GKEY5 && (provider === "gemini" || provider === "auto")) {
          try {
            var gemVoice = voiceId === "default" ? "Puck" : voiceId;
            var gemTtsR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=" + GKEY5, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: gemVoice } } } } })
            });
            if (gemTtsR.ok) {
              var gemTtsD = await gemTtsR.json();
              var ttsparts = gemTtsD.candidates && gemTtsD.candidates[0] && gemTtsD.candidates[0].content && gemTtsD.candidates[0].content.parts;
              var audioB64 = ttsparts && ttsparts[0] && ttsparts[0].inlineData && ttsparts[0].inlineData.data;
              if (audioB64) { var audioBuf2 = Uint8Array.from(atob(audioB64), function(c) { return c.charCodeAt(0); }); return new Response(audioBuf2, { status: 200, headers: { "Content-Type": "audio/wav", "Access-Control-Allow-Origin": origin || "*" } }); }
            }
          } catch(e) {}
        }

        return json({ error: "All TTS providers failed" }, 500, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── KV utilities ──────────────────────────────────────────────────────────
    if (path === "/api/kv/set" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        await env.PRISM_KV.put(body.key, typeof body.value === "string" ? body.value : JSON.stringify(body.value));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Champion ──────────────────────────────────────────────────────────────
    if (path === "/api/champion/clear" && request.method === "POST") {
      if (env.PRISM_KV) {
        await env.PRISM_KV.delete("api-champion:routing-config").catch(function(){});
        await env.PRISM_KV.delete("api-champion:last-run").catch(function(){});
      }
      return json({ success: true, message: "Champion config cleared" }, 200, origin);
    }

    if (path === "/api/champion/status" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ message: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("api-champion:routing-config");
        var lastRun = await env.PRISM_KV.get("api-champion:last-run");
        return json(raw ? Object.assign(JSON.parse(raw), { lastRun }) : { message: "No champion run yet" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Transcription ─────────────────────────────────────────────────────────
    if (path === "/api/transcribe" && request.method === "POST") {
      try {
        var groqKey = k(env, ["groq_free_1", "GROQ_FREE_1"]);
        if (!groqKey) return json({ error: "No Groq key" }, 400, origin);
        var formData = await request.formData();
        var audioFile = formData.get("file") || formData.get("audio");
        if (!audioFile) return json({ error: "No audio file" }, 400, origin);
        var newForm = new FormData();
        newForm.append("file", audioFile);
        newForm.append("model", "whisper-large-v3");
        newForm.append("language", "en");
        newForm.append("response_format", "json");
        var tResp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST", headers: { "Authorization": "Bearer " + groqKey }, body: newForm
        });
        if (!tResp.ok) { var e = await tResp.text(); return json({ error: "Transcription failed: " + e.substring(0, 100) }, 500, origin); }
        var tData = await tResp.json();
        return json({ text: tData.text, language: tData.language }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── OCR ───────────────────────────────────────────────────────────────────
    if (path === "/api/ocr" && request.method === "POST") {
      try {
        var body = await request.json();
        var mistralKey = k(env, ["mistral_api_key", "MISTRAL_API_KEY"]);
        if (!mistralKey) return json({ error: "No Mistral key for OCR" }, 400, origin);
        var imageUrl = body.image_url || body.url;
        var imageBase64 = body.image_base64 || body.base64;
        var ocrMsgs = [{ role: "user", content: [
          { type: "text", text: "Extract all text from this image. Return only the extracted text, preserving formatting." },
          imageUrl ? { type: "image_url", image_url: imageUrl } : { type: "image_url", image_url: "data:image/jpeg;base64," + imageBase64 }
        ]}];
        var ocrR = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST", headers: { "Authorization": "Bearer " + mistralKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "mistral-ocr-latest", messages: ocrMsgs, max_tokens: 4096 })
        });
        if (!ocrR.ok) { var e = await ocrR.text(); return json({ error: "OCR failed: " + e.substring(0, 150) }, 500, origin); }
        var ocrD = await ocrR.json();
        var ocrText = ocrD.choices && ocrD.choices[0] && ocrD.choices[0].message && ocrD.choices[0].message.content;
        return json({ text: ocrText, model: "mistral-ocr-latest" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    
    // ── Multi-model image generation ──────────────────────────────────────────
    if (path === "/api/image/multi" && request.method === "POST") {
      try {
        var body = await request.json();
        var prompt = body.prompt || "abstract art";
        var models = body.models || ["auto", "gemini-image", "pollinations"];
        var GKEY6 = k(env, ["gemini_api_key", "GEMINI_API_KEY"]) || "";
        var falKey2 = k(env, ["FAL_API_KEY", "fal_api_key"]);
        var xaiKey2 = k(env, ["xai_api_key", "XAI_API_KEY"]);

        async function genOne(modelId) {
          try {
            // Gemini models
            if (modelId.startsWith("gemini-") && GKEY6) {
              var gemModels = {"gemini-image":"gemini-3.1-flash-image","gemini-image-pro":"gemini-3-pro-image","gemini-2.5-image":"gemini-2.5-flash-image"};
              var gm = gemModels[modelId] || "gemini-3.1-flash-image";
              var gr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+gm+":generateContent", {
                method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":GKEY6},
                body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:["IMAGE","TEXT"]}})
              });
              if (gr.ok) {
                var gd = await gr.json();
                var gparts = gd.candidates&&gd.candidates[0]&&gd.candidates[0].content&&gd.candidates[0].content.parts;
                if (gparts) for (var gpi=0;gpi<gparts.length;gpi++) {
                  if (gparts[gpi].inlineData) return {model:modelId,url:"data:"+gparts[gpi].inlineData.mimeType+";base64,"+gparts[gpi].inlineData.data,provider:"gemini"};
                }
              }
            }
            // FAL models
            if ((modelId==="auto"||modelId==="flux-schnell"||modelId==="flux-dev"||modelId==="flux-pro"||modelId==="recraft-v3") && falKey2) {
              var falEndpoints = {"auto":"https://fal.run/fal-ai/flux/schnell","flux-schnell":"https://fal.run/fal-ai/flux/schnell","flux-dev":"https://fal.run/fal-ai/flux/dev","flux-pro":"https://fal.run/fal-ai/flux-pro","recraft-v3":"https://fal.run/fal-ai/recraft-v3"};
              var fe = falEndpoints[modelId]||falEndpoints["auto"];
              var fr = await fetch(fe,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Key "+falKey2},body:JSON.stringify({prompt,image_size:"landscape_4_3",num_images:1})});
              if (fr.ok) { var fd=await fr.json(); var fu=fd.images&&fd.images[0]&&fd.images[0].url; if (fu) return {model:modelId,url:fu,provider:"fal"}; }
            }
            // xAI
            if (modelId==="grok-2-image" && xaiKey2) {
              var xr=await fetch("https://api.x.ai/v1/images/generations",{method:"POST",headers:{"Authorization":"Bearer "+xaiKey2,"Content-Type":"application/json"},body:JSON.stringify({model:"grok-2-image",prompt,n:1})});
              if (xr.ok) { var xd=await xr.json(); if (xd.data&&xd.data[0]&&xd.data[0].url) return {model:modelId,url:xd.data[0].url,provider:"xai"}; }
            }
            // Pollinations
            if (modelId==="pollinations") {
              return {model:modelId,url:"https://image.pollinations.ai/prompt/"+encodeURIComponent(prompt)+"?width=1024&height=768&nologo=true&model=flux",provider:"pollinations"};
            }
            return {model:modelId,error:"Failed or no key"};
          } catch(e) { return {model:modelId,error:e.message}; }
        }

        var results = await Promise.all(models.map(function(m) {
          return Promise.race([genOne(m), new Promise(function(res){setTimeout(function(){res({model:m,error:"timeout"});},20000);})]);
        }));

        return json({results:results,prompt:prompt}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Document intelligence: chunk + extract ────────────────────────────────
    if (path === "/api/document/extract" && request.method === "POST") {
      try {
        var body = await request.json();
        var docText = body.text || "";
        var extractPrompt = body.prompt || "Extract all key facts, data points, names, dates, and findings from this section. Return as structured bullet points.";
        var chunkSize = body.chunk_size || 15000; // chars per chunk (~3750 tokens)
        var overlap = 500;

        if (!docText) return json({error:"No text provided"}, 400, origin);

        // Split into chunks
        var chunks = [];
        var i = 0;
        while (i < docText.length) {
          chunks.push(docText.substring(i, i + chunkSize));
          i += chunkSize - overlap;
        }

        // Process chunks in parallel batches of 5
        var allResults = [];
        var batchSize = 5;
        for (var bi = 0; bi < chunks.length; bi += batchSize) {
          var batch = chunks.slice(bi, bi + batchSize);
          var batchResults = await Promise.all(batch.map(function(chunk, ci) {
            var chunkIdx = bi + ci;
            var messages = [
              {role:"system", content:"You are a precise data extraction assistant. Extract only what is explicitly stated. Do not infer or add information not present in the text."},
              {role:"user", content:extractPrompt + "\n\nSection " + (chunkIdx+1) + " of " + chunks.length + ":\n\n" + chunk}
            ];
            return Promise.race([
              callProvider(env, "gemini", k(env,["gemini_api_key","GEMINI_API_KEY"])||"", "gemma-4-31b-it", messages)
                .then(function(r){return {chunk:chunkIdx+1,text:r.content,ok:true};})
                .catch(function(e){return {chunk:chunkIdx+1,error:e.message,ok:false};}),
              new Promise(function(res){setTimeout(function(){res({chunk:chunkIdx+1,error:"timeout",ok:false});},20000);})
            ]);
          }));
          allResults = allResults.concat(batchResults);
          // Small delay between batches
          if (bi + batchSize < chunks.length) await new Promise(function(r){setTimeout(r,500);});
        }

        // Merge results with a reasoning model
        var successfulChunks = allResults.filter(function(r){return r.ok;}).map(function(r){return "=== Chunk "+r.chunk+" ===\n"+r.text;}).join("\n\n");
        var mergeMessages = [
          {role:"system", content:"You are a research synthesiser. Merge and deduplicate the following extracted data from multiple sections of a large document. Remove duplicates, organise by theme, and present as a coherent structured summary."},
          {role:"user", content:"Merge these extractions:\n\n" + successfulChunks.substring(0, 50000)}
        ];
        var mergeResult = await callProvider(env, "mistral", k(env,["mistral_api_key","MISTRAL_API_KEY"])||"", "mistral-large-4", mergeMessages)
          .catch(function(e){return {content:"Merge failed: "+e.message};});

        return json({
          chunks_processed: chunks.length,
          chunks_successful: allResults.filter(function(r){return r.ok;}).length,
          chunk_results: allResults,
          merged_summary: mergeResult.content,
          doc_length: docText.length
        }, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    
    
    // ── Agent document analysis — chained requests, 2 chunks per call ────────
    if (path === "/api/agent/analyse" && request.method === "POST") {
      try {
        var body = await request.json();
        var isResume = !!body.job_id;
        var jobId = body.job_id || ("job-" + Date.now() + "-" + Math.random().toString(36).slice(2,8));
        var task = body.task || "";
        var docName = body.document_name || "document";
        var GKEY = k(env, ["gemini_api_key","GEMINI_API_KEY"]) || "";
        var mistralKey = k(env, ["mistral_api_key","MISTRAL_API_KEY"]);
        var groqKey = k(env, ["groq_free_1","GROQ_FREE_1"]) || "";
        var chunkSize = 15000;
        var overlap = 500;

        var jobState;
        var allChunks = [];

        if (!isResume) {
          var docText = body.document || "";
          var i = 0;
          while (i < docText.length) { allChunks.push({idx:allChunks.length, text:docText.substring(i,i+chunkSize)}); i += chunkSize-overlap; }
          jobState = {id:jobId, status:"running", task, document_name:docName, created:new Date().toISOString(), chunks_total:allChunks.length, chunks_done:0, chunk_results:[], failed_chunks:[], progress:"Starting: 0/"+allChunks.length+" sections"};
          if (env.PRISM_KV) {
            await env.PRISM_KV.put("analysis-chunks:"+jobId, JSON.stringify(allChunks), {expirationTtl:7200});
            await env.PRISM_KV.put("analysis-job:"+jobId, JSON.stringify(jobState), {expirationTtl:86400*7});
          }
        } else {
          if (!env.PRISM_KV) return json({error:"KV not available"}, 500, origin);
          var jobRaw = await env.PRISM_KV.get("analysis-job:"+jobId);
          if (!jobRaw) return json({error:"Job not found"}, 404, origin);
          jobState = JSON.parse(jobRaw);
          var chunksRaw = await env.PRISM_KV.get("analysis-chunks:"+jobId);
          if (chunksRaw) allChunks = JSON.parse(chunksRaw);
        }

        var startIdx = jobState.chunks_done;
        var endIdx = Math.min(startIdx+2, allChunks.length);
        var batch = allChunks.slice(startIdx, endIdx);

        var batchResults = await Promise.all(batch.map(function(chunk) {
          var msgs = [{role:"system",content:"Extract ALL relevant information. Be thorough. Never truncate."},{role:"user",content:task+"\n\nSection "+(chunk.idx+1)+" of "+allChunks.length+":\n\n"+chunk.text}];
          return Promise.race([
            callProvider(env,"gemini",GKEY,"gemma-4-31b-it",msgs).then(function(r){return {idx:chunk.idx,content:r.content,ok:true};}).catch(function(){
              return callProvider(env,"groq",groqKey,"openai/gpt-oss-120b",msgs.map(function(m){return {role:m.role,content:typeof m.content==="string"?m.content.substring(0,5000):m.content};})).then(function(r){return {idx:chunk.idx,content:r.content,ok:true};}).catch(function(e){return {idx:chunk.idx,error:e.message,ok:false};});
            }),
            new Promise(function(res){setTimeout(function(){res({idx:chunk.idx,error:"timeout",ok:false});},12000);})
          ]);
        }));

        batchResults.forEach(function(r){if(r.ok)jobState.chunk_results.push({chunk:r.idx+1,content:r.content});else jobState.failed_chunks.push(r.idx+1+": "+r.error);});
        jobState.chunks_done = endIdx;
        jobState.progress = "Processed "+endIdx+"/"+allChunks.length+" sections...";

        var isComplete = endIdx >= allChunks.length;
        if (isComplete) {
          var allExtractions = jobState.chunk_results.sort(function(a,b){return a.chunk-b.chunk;}).map(function(r){return "=== Section "+r.chunk+" ===\n"+r.content;}).join("\n\n");
          var synthMsgs = [{role:"system",content:"Synthesise ALL extractions into a complete structured report. Be thorough."},{role:"user",content:"Task: "+task+"\n\nSynthesize "+jobState.chunk_results.length+" sections:\n\n"+allExtractions.substring(0,60000)}];
          var synthesis = await (mistralKey ? callProvider(env,"mistral",mistralKey,"mistral-large-4",synthMsgs) : callProvider(env,"gemini",GKEY,"gemini-3.8-flash",synthMsgs)).catch(function(e){return {content:"Synthesis error: "+e.message};});
          jobState.status = "complete"; jobState.synthesis = synthesis.content; jobState.chunks_successful = jobState.chunk_results.length; jobState.progress = "Complete";
          if (env.PRISM_KV) env.PRISM_KV.delete("analysis-chunks:"+jobId).catch(function(){});
        } else {
          jobState.status = "running";
          ctx.waitUntil((async function(){
            try { await new Promise(function(r){setTimeout(r,200);}); await fetch("https://prism-api.identitypartners.workers.dev/api/agent/analyse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId,task,document_name:docName})}); } catch(e){}
          })());
        }

        if (env.PRISM_KV) await env.PRISM_KV.put("analysis-job:"+jobId, JSON.stringify(jobState), {expirationTtl:86400*7});
        return json({success:true, job_id:jobId, status:jobState.status, progress:jobState.progress, chunks_done:jobState.chunks_done, chunks_total:allChunks.length, is_complete:isComplete, synthesis:isComplete?jobState.synthesis:null}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.startsWith("/api/agent/job/") && request.method === "GET") {
      try {
        var jobId = path.replace("/api/agent/job/","");
        if (!env.PRISM_KV) return json({status:"not_found"}, 200, origin);
        var jobRaw = await env.PRISM_KV.get("analysis-job:"+jobId);
        if (!jobRaw) return json({status:"not_found",job_id:jobId}, 200, origin);
        return json(JSON.parse(jobRaw), 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Workspace persistence (KV-backed) ─────────────────────────────────────
    if (path === "/api/workspaces" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({workspaces:[]}, 200, origin);
        var list = await env.PRISM_KV.list({prefix:"workspace:"});
        var workspaces = [];
        for (var i=0; i<Math.min(list.keys.length,100); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) workspaces.push(JSON.parse(val));
        }
        workspaces.sort(function(a,b){return new Date(b.updated)-new Date(a.updated);});
        return json({workspaces}, 200, origin);
      } catch(e) { return json({workspaces:[]}, 200, origin); }
    }

    if (path === "/api/workspaces" && request.method === "POST") {
      try {
        var body = await request.json();
        var ws = {
          id: body.id || ("ws-"+Date.now()),
          name: body.name || "New Workspace",
          icon: body.icon || "📁",
          colour: body.colour || "#2d6a9f",
          desc: body.desc || "",
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          folders:[], notebooks:[], threads:[], agents:[], workflows:[],
          personas:[], images:[], events:[], whiteboards:[], todos:[], notes:"",
          documents:[]
        };
        if (body.id) {
          // Update existing
          var existing = await env.PRISM_KV.get("workspace:"+body.id);
          if (existing) ws = Object.assign(JSON.parse(existing), body, {updated:new Date().toISOString()});
        }
        await env.PRISM_KV.put("workspace:"+ws.id, JSON.stringify(ws), {expirationTtl:86400*365});
        return json({success:true, workspace:ws}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.startsWith("/api/workspaces/") && request.method === "GET") {
      try {
        var wsId = path.replace("/api/workspaces/","").split("/")[0];
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        var val = await env.PRISM_KV.get("workspace:"+wsId);
        return json(val ? JSON.parse(val) : {error:"Not found"}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.startsWith("/api/workspaces/") && request.method === "DELETE") {
      try {
        var wsId = path.replace("/api/workspaces/","");
        if (env.PRISM_KV) await env.PRISM_KV.delete("workspace:"+wsId);
        return json({success:true}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Document upload to workspace (stored in KV, content in R2 if available) ──
    if (path.match(/\/api\/workspaces\/[^/]+\/documents/) && request.method === "POST") {
      try {
        var wsId = path.split("/")[3];
        var body = await request.json();
        var docId = "doc-"+Date.now();
        var doc = {
          id: docId,
          name: body.name || "document",
          size: body.size || 0,
          type: body.type || "text/plain",
          uploaded: new Date().toISOString(),
          content_key: null
        };

        // Store content in KV (up to 25MB limit)
        if (body.content && env.PRISM_KV) {
          var contentKey = "doc-content:"+wsId+":"+docId;
          await env.PRISM_KV.put(contentKey, body.content, {expirationTtl:86400*365});
          doc.content_key = contentKey;
        }

        // Update workspace
        if (env.PRISM_KV) {
          var wsRaw = await env.PRISM_KV.get("workspace:"+wsId);
          if (wsRaw) {
            var ws = JSON.parse(wsRaw);
            if (!ws.documents) ws.documents = [];
            ws.documents.push(doc);
            ws.updated = new Date().toISOString();
            await env.PRISM_KV.put("workspace:"+wsId, JSON.stringify(ws), {expirationTtl:86400*365});
          }
        }
        return json({success:true, document:doc}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Get document content ──────────────────────────────────────────────────
    if (path.match(/\/api\/documents\/[^/]+\/content/) && request.method === "GET") {
      try {
        var docId = path.split("/")[3];
        var wsId = url.searchParams.get("workspace");
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        var contentKey = "doc-content:"+wsId+":"+docId;
        var content = await env.PRISM_KV.get(contentKey);
        return json({content: content || "", id: docId}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Delete document ───────────────────────────────────────────────────────
    if (path.match(/\/api\/workspaces\/[^/]+\/documents\/[^/]+/) && request.method === "DELETE") {
      try {
        var parts = path.split("/");
        var wsId = parts[3], docId = parts[5];
        if (env.PRISM_KV) {
          await env.PRISM_KV.delete("doc-content:"+wsId+":"+docId);
          var wsRaw = await env.PRISM_KV.get("workspace:"+wsId);
          if (wsRaw) {
            var ws = JSON.parse(wsRaw);
            ws.documents = (ws.documents||[]).filter(function(d){return d.id!==docId;});
            ws.updated = new Date().toISOString();
            await env.PRISM_KV.put("workspace:"+wsId, JSON.stringify(ws), {expirationTtl:86400*365});
          }
        }
        return json({success:true}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Workspace notes (individual .md files in KV) ──────────────────────────
    if (path.match(/\/api\/workspaces\/[^/]+\/notes/) && request.method === "GET") {
      try {
        var wsId = path.split("/")[3];
        if (!env.PRISM_KV) return json({notes:[]}, 200, origin);
        var list = await env.PRISM_KV.list({prefix:"note:"+wsId+":"});
        var notes = [];
        for (var i=0; i<Math.min(list.keys.length,200); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) {
            var note = JSON.parse(val);
            notes.push({id:note.id, title:note.title, created:note.created, updated:note.updated, size:note.content.length});
          }
        }
        notes.sort(function(a,b){return new Date(b.updated)-new Date(a.updated);});
        return json({notes}, 200, origin);
      } catch(e) { return json({notes:[]}, 200, origin); }
    }

    if (path.match(/\/api\/workspaces\/[^/]+\/notes$/) && request.method === "POST") {
      try {
        var wsId = path.split("/")[3];
        var body = await request.json();
        var noteId = body.id || ("note-"+Date.now());
        var note = {
          id: noteId,
          title: body.title || "Untitled Note",
          content: body.content || "",
          created: body.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          tags: body.tags || []
        };
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        await env.PRISM_KV.put("note:"+wsId+":"+noteId, JSON.stringify(note), {expirationTtl:86400*365});
        return json({success:true, note:{id:note.id,title:note.title,created:note.created,updated:note.updated,size:note.content.length}}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.match(/\/api\/workspaces\/[^/]+\/notes\/[^/]+$/) && request.method === "GET") {
      try {
        var parts = path.split("/");
        var wsId = parts[3], noteId = parts[5];
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        var val = await env.PRISM_KV.get("note:"+wsId+":"+noteId);
        return json(val ? JSON.parse(val) : {error:"Note not found"}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.match(/\/api\/workspaces\/[^/]+\/notes\/[^/]+$/) && request.method === "DELETE") {
      try {
        var parts = path.split("/");
        var wsId = parts[3], noteId = parts[5];
        if (env.PRISM_KV) await env.PRISM_KV.delete("note:"+wsId+":"+noteId);
        return json({success:true}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // Download note as .md file
    if (path.match(/\/api\/workspaces\/[^/]+\/notes\/[^/]+\/download/) && request.method === "GET") {
      try {
        var parts = path.split("/");
        var wsId = parts[3], noteId = parts[5];
        if (!env.PRISM_KV) return new Response("KV not available", {status:500});
        var val = await env.PRISM_KV.get("note:"+wsId+":"+noteId);
        if (!val) return new Response("Note not found", {status:404});
        var note = JSON.parse(val);
        var filename = note.title.replace(/[^a-z0-9\-_]/gi,"_").toLowerCase() + ".md";
        return new Response(note.content, {
          status:200,
          headers:{
            "Content-Type":"text/markdown",
            "Content-Disposition":"attachment; filename=\""+filename+"\"",
            "Access-Control-Allow-Origin":origin||"*"
          }
        });
      } catch(e) { return new Response(e.message, {status:500}); }
    }


    // ── Research search ───────────────────────────────────────────────────────
    if (path === "/api/search" && request.method === "POST") {
      try {
        var body = await request.json();
        var query = body.query || body.q || "";
        var sources = body.sources || ["tavily"];
        var results = [];
        var errors = [];

        // Tavily search
        var tavilyKey = k(env, ["tavily_api_key","TAVILY_API_KEY"]);
        if (tavilyKey && (sources.includes("tavily") || sources.includes("web") || sources.length === 0)) {
          try {
            var tr = await fetch("https://api.tavily.com/search", {
              method:"POST", headers:{"Content-Type":"application/json"},
              body:JSON.stringify({api_key:tavilyKey, query:query, max_results:10, include_answer:true, search_depth:"advanced"})
            });
            if (tr.ok) {
              var td = await tr.json();
              if (td.answer) results.push({type:"answer", content:td.answer, source:"Tavily"});
              (td.results||[]).forEach(function(r) {
                results.push({type:"web", title:r.title, url:r.url, snippet:r.content, source:"Tavily", date:r.published_date||""});
              });
            }
          } catch(e) { errors.push("Tavily: "+e.message); }
        }

        // Brave search
        var braveKey = k(env, ["brave_api_key","BRAVE_API_KEY"]);
        if (braveKey && (sources.includes("brave") || sources.includes("web"))) {
          try {
            var br = await fetch("https://api.search.brave.com/res/v1/web/search?q="+encodeURIComponent(query)+"&count=10", {
              headers:{"Accept":"application/json","X-Subscription-Token":braveKey}
            });
            if (br.ok) {
              var bd = await br.json();
              (bd.web&&bd.web.results||[]).forEach(function(r) {
                results.push({type:"web", title:r.title, url:r.url, snippet:r.description, source:"Brave"});
              });
            }
          } catch(e) { errors.push("Brave: "+e.message); }
        }

        // Semantic Scholar (academic)
        var ssKey = k(env, ["semantic_scholar_api_key","SEMANTIC_SCHOLAR_API_KEY"]);
        if (sources.includes("semantic_scholar") || sources.includes("academic") || sources.includes("scholarly")) {
          try {
            var ssUrl = "https://api.semanticscholar.org/graph/v1/paper/search?query="+encodeURIComponent(query)+"&limit=5&fields=title,abstract,authors,year,url,externalIds";
            var ssHeaders = {"Accept":"application/json"};
            if (ssKey) ssHeaders["x-api-key"] = ssKey;
            var ssr = await fetch(ssUrl, {headers:ssHeaders});
            if (ssr.ok) {
              var ssd = await ssr.json();
              (ssd.data||[]).forEach(function(p) {
                results.push({type:"academic", title:p.title, snippet:p.abstract||"", authors:(p.authors||[]).map(function(a){return a.name;}).join(", "), year:p.year, url:p.url||("https://www.semanticscholar.org/paper/"+p.paperId), source:"Semantic Scholar"});
              });
            }
          } catch(e) { errors.push("Semantic Scholar: "+e.message); }
        }

        // Perplexity (with web search)
        var pplxKey = k(env, ["perplexity","perplexity_api_key","PERPLEXITY_API_KEY"]);
        if (pplxKey && (sources.includes("perplexity") || sources.includes("ai"))) {
          try {
            var pr = await fetch("https://api.perplexity.ai/chat/completions", {
              method:"POST", headers:{"Authorization":"Bearer "+pplxKey,"Content-Type":"application/json"},
              body:JSON.stringify({model:"sonar", messages:[{role:"user",content:query}], max_tokens:2048})
            });
            if (pr.ok) {
              var pd = await pr.json();
              var pcontent = pd.choices&&pd.choices[0]&&pd.choices[0].message&&pd.choices[0].message.content;
              if (pcontent) results.push({type:"ai_summary", content:pcontent, source:"Perplexity Sonar", citations:pd.citations||[]});
            }
          } catch(e) { errors.push("Perplexity: "+e.message); }
        }

        // Exa neural search
        var exaKey = k(env, ["exa_api_key","EXA_API_KEY"]);
        if (exaKey && (sources.includes("exa") || sources.includes("neural"))) {
          try {
            var er = await fetch("https://api.exa.ai/search", {
              method:"POST", headers:{"Content-Type":"application/json","x-api-key":exaKey},
              body:JSON.stringify({query:query, numResults:5, useAutoprompt:true, type:"neural"})
            });
            if (er.ok) {
              var ed = await er.json();
              (ed.results||[]).forEach(function(r) {
                results.push({type:"web", title:r.title, url:r.url, snippet:r.text||"", source:"Exa"});
              });
            }
          } catch(e) { errors.push("Exa: "+e.message); }
        }

        // OpenAlex academic search
        if (sources.includes("openalex") || sources.includes("scholarly")) {
          try {
            var oar = await fetch("https://api.openalex.org/works?search="+encodeURIComponent(query)+"&per-page=5&select=title,doi,publication_year,authorships", {
              headers:{"User-Agent":"Argentica/1.0 (mailto:hello@identitypartners.uk)"}
            });
            if (oar.ok) {
              var oad = await oar.json();
              (oad.results||[]).forEach(function(w) {
                var authors = (w.authorships||[]).slice(0,2).map(function(a){return a.author&&a.author.display_name||"";}).join(", ");
                results.push({type:"academic", title:w.title||"", snippet:"", authors:authors, year:w.publication_year, url:w.doi?"https://doi.org/"+w.doi:"", source:"OpenAlex"});
              });
            }
          } catch(e) { errors.push("OpenAlex: "+e.message); }
        }

        // arXiv preprints
        if (sources.includes("arxiv") || sources.includes("scholarly")) {
          try {
            var axr = await fetch("https://export.arxiv.org/api/query?search_query=all:"+encodeURIComponent(query)+"&max_results=5&sortBy=relevance");
            if (axr.ok) {
              var axText = await axr.text();
              var entries = axText.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
              entries.slice(0,5).forEach(function(entry) {
                var title = (entry.match(/<title>([\s\S]*?)<\/title>/)||[])[1]||"";
                var summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/)||[])[1]||"";
                var link = (entry.match(/<id>([\s\S]*?)<\/id>/)||[])[1]||"";
                var published = (entry.match(/<published>([\s\S]*?)<\/published>/)||[])[1]||"";
                results.push({type:"academic", title:title.trim(), snippet:summary.trim().substring(0,300), url:link.trim(), year:published.substring(0,4), source:"arXiv"});
              });
            }
          } catch(e) { errors.push("arXiv: "+e.message); }
        }

        return json({query, results, allResults:results, errors, total:results.length}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RSS feed proxy ────────────────────────────────────────────────────────
    if (path === "/api/rss" && request.method === "GET") {
      try {
        var feedUrl = url.searchParams.get("url");
        if (!feedUrl) return json({error:"No URL"}, 400, origin);
        var fr = await fetch(feedUrl, {headers:{"User-Agent":"Argentica/1.0","Accept":"application/rss+xml,application/xml,text/xml"}});
        if (!fr.ok) return json({error:"Feed fetch failed: "+fr.status}, 500, origin);
        var xml = await fr.text();
        // Parse RSS items
        var items = [];
        var itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
        itemMatches.slice(0,20).forEach(function(item) {
          var title = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i)||item.match(/<title[^>]*>(.*?)<\/title>/i)||[])[1]||"";
          var link = (item.match(/<link[^>]*>(.*?)<\/link>/i)||[])[1]||"";
          var desc = (item.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i)||item.match(/<description[^>]*>(.*?)<\/description>/i)||[])[1]||"";
          var pubDate = (item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)||[])[1]||"";
          var thumb = (item.match(/<media:thumbnail[^>]*url="([^"]+)"/i)||item.match(/<media:content[^>]*url="([^"]+)"/i)||[])[1]||"";
          if (title || link) items.push({title:title.trim(), url:link.trim(), snippet:desc.replace(/<[^>]+>/g,"").trim().substring(0,300), date:pubDate, image:thumb});
        });
        return json({items, feed:feedUrl}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Agents persistence ────────────────────────────────────────────────────
    if (path === "/api/agents/list" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({agents:[]}, 200, origin);
        var list = await env.PRISM_KV.list({prefix:"agent:"});
        var agents = [];
        for (var i=0; i<Math.min(list.keys.length,100); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) agents.push(JSON.parse(val));
        }
        agents.sort(function(a,b){return new Date(b.created||0)-new Date(a.created||0);});
        return json({agents}, 200, origin);
      } catch(e) { return json({agents:[]}, 200, origin); }
    }

    if (path === "/api/agents/save" && request.method === "POST") {
      try {
        var body = await request.json();
        var agent = body;
        if (!agent.id) agent.id = "agent-" + Date.now();
        agent.created = agent.created || new Date().toISOString();
        agent.updated = new Date().toISOString();
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        await env.PRISM_KV.put("agent:"+agent.id, JSON.stringify(agent), {expirationTtl:86400*365});
        return json({success:true, agent}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.startsWith("/api/agents/") && request.method === "DELETE") {
      try {
        var agentId = path.replace("/api/agents/","");
        if (env.PRISM_KV) await env.PRISM_KV.delete("agent:"+agentId);
        return json({success:true}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── Workflows persistence ─────────────────────────────────────────────────
    if (path === "/api/workflows/list" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({workflows:[]}, 200, origin);
        var list = await env.PRISM_KV.list({prefix:"workflow:"});
        var workflows = [];
        for (var i=0; i<Math.min(list.keys.length,100); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) workflows.push(JSON.parse(val));
        }
        workflows.sort(function(a,b){return new Date(b.created||0)-new Date(a.created||0);});
        return json({workflows}, 200, origin);
      } catch(e) { return json({workflows:[]}, 200, origin); }
    }

    if (path === "/api/workflows/save" && request.method === "POST") {
      try {
        var body = await request.json();
        var wf = body;
        if (!wf.id) wf.id = "wf-" + Date.now();
        wf.created = wf.created || new Date().toISOString();
        wf.updated = new Date().toISOString();
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        await env.PRISM_KV.put("workflow:"+wf.id, JSON.stringify(wf), {expirationTtl:86400*365});
        return json({success:true, workflow:wf}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    if (path.startsWith("/api/workflows/") && request.method === "DELETE") {
      try {
        var wfId = path.replace("/api/workflows/","");
        if (env.PRISM_KV) await env.PRISM_KV.delete("workflow:"+wfId);
        return json({success:true}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── WIP / Job spool ───────────────────────────────────────────────────────
    if (path === "/api/jobs" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({jobs:[]}, 200, origin);
        var list = await env.PRISM_KV.list({prefix:"analysis-job:"});
        var jobs = [];
        for (var i=0; i<Math.min(list.keys.length,50); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) {
            var job = JSON.parse(val);
            jobs.push({id:job.id, status:job.status, document_name:job.document_name, progress:job.progress, created:job.created, chunks_done:job.chunks_done, chunks_total:job.chunks_total});
          }
        }
        jobs.sort(function(a,b){return new Date(b.created||0)-new Date(a.created||0);});
        return json({jobs}, 200, origin);
      } catch(e) { return json({jobs:[]}, 200, origin); }
    }

    // ── Dev Team ──────────────────────────────────────────────────────────────
    if (path === "/api/devteam" && request.method === "POST") {
      try {
        var body = await request.json();
        var agentId = body.agent || "pm";
        var userMessage = body.message || "";
        var GKEY = k(env, ["gemini_api_key","GEMINI_API_KEY"]) || "";
        var mistralKey = k(env, ["mistral_api_key","MISTRAL_API_KEY"]);
        var groqKey = k(env, ["groq_free_1","GROQ_FREE_1"]) || "";

        var AGENT_PROMPTS = {
          pm: `You are Gerald, the Programme Manager for Argentica — the personal AI operating environment of Simon Johnson / Identity Partners.

SYSTEM CREDENTIALS (use these for all operations):
- Worker: https://prism-api.identitypartners.workers.dev
- Pages: https://prism.identitypartners.uk
- Repo: IdentityPartners/prism (GitHub)
- CF Account: d741de91f8cfff2306cc0f850a76ee07
- CF Token: ${CF_TOKEN_FROM_ENV}
- KV Namespace: 8d1a583cc99a482380aacb526d873030 (PRISM_KV)
- D1 Database: e953848b-7d62-4629-bb4d-271da0d03fd5 (PRISM_D1)
- R2 Bucket: prism-assets (public: https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/)

ROUTING CHAIN (current, in order):
1. GLM-5.3 via Mistral (zai-glm-5-3, 1M ctx, thinking+web search)
2. Gemma 4 31B (gemma-4-31b-it, 1M ctx, Google Search grounding)
3. Gemini 3.8 Flash (gemini-3.8-flash, 1M ctx)
4. Mistral Large 4 (mistral-large-4, 1M ctx, web_search_premium)
5. DeepSeek V4 Flash (deepseek-flash, 1M ctx)
6. GLM 4.7-flash (glm-4.7-flash, 128K, thinking)
7. GPT-OSS on Cerebras/Groq (8K, fast)
8. Llama 4 Scout on Groq (131K)
9. Grok-4.7 (500K, real-time X)
10. Perplexity Sonar (web search)
11. Pollinations (unconditional fallback)

API CALL FORMATS:
- Gemini/Gemma: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent, header x-goog-api-key, body {contents:[{role,parts:[{text}]}], systemInstruction:{parts:[{text}]}, generationConfig:{maxOutputTokens:8192}}
- Mistral: POST https://api.mistral.ai/v1/chat/completions, Bearer auth, body {model, messages, tools:[{type:"web_search_premium"}]}
- DeepSeek: POST https://api.deepseek.com/chat/completions, Bearer auth, body {model:"deepseek-flash", messages}
- GLM/Z.AI: POST https://open.bigmodel.cn/api/paas/v4/chat/completions, JWT auth (key format: id.secret), body {model, messages, tools:[{type:"web_search",web_search:{enable:true}}]}
- Groq: POST https://api.groq.com/openai/v1/chat/completions, Bearer auth, OpenAI format
- Cerebras: POST https://api.cerebras.ai/v1/chat/completions, Bearer auth, OpenAI format
- xAI: POST https://api.x.ai/v1/chat/completions, Bearer auth, OpenAI format
- Perplexity: POST https://api.perplexity.ai/chat/completions, Bearer auth, extra: search_recency_filter
- Cohere: POST https://api.cohere.com/v2/chat, Bearer auth, body {model, messages:[{role,content}]}

TROUBLESHOOTING GUIDE:
- "All providers unavailable": check routing:last in KV, run API Champion test
- Gemma 401: gemini_api_key secret may be wrong — current working key starts AQ.Ab8RN6Js
- Mistral 401: key is ${REDACTED_MISTRAL_KEY}8 (no trailing b)
- GLM 429: Z.AI credits exhausted — only glm-4.5-flash and glm-4.7-flash are free
- Worker syntax error: check for export {} at end — CF API rejects ES module bundles
- Workspaces empty: renderList() not renderWorkspaceList() — function name mismatch
- Research tabs broken: panels missing from HTML, switchSourceTab not showing/hiding

TOOLS (use TOOL_CALL: tool_name({params}) syntax):
- search_web({query}) — Tavily web search
- run_diagnostic() — check KV, Worker, Champion status
- send_telegram({message}) — notify Simon
- test_provider() — run API Champion

RULES: Never describe actions — execute them. Never ask Simon to do anything technical. British English. Direct, technical, concise.`,
          researcher: "You are the Research Agent for Argentica. Find, synthesise, and structure information. Use TOOL_CALL: search_web({query:\"...\"}) immediately when asked to research. Cite sources. Never hallucinate. British English.",
          "api-champion": "You are the API Champion for Argentica. Test all AI providers and update the routing chain. Use TOOL_CALL: run_diagnostic() to check system status. British English.",
          troubleshooter: "You are the Troubleshooter for Argentica. Diagnose and fix issues. Use TOOL_CALL: run_diagnostic() to check status. British English. Never ask Simon to do anything technical.",
        };

        var sysPrompt = AGENT_PROMPTS[agentId] || AGENT_PROMPTS["pm"];
        var messages = body.messages || [{role:"system",content:sysPrompt},{role:"user",content:userMessage}];
        if (messages.length > 0 && messages[0].role !== "system") {
          messages = [{role:"system",content:sysPrompt}].concat(messages);
        }

        // Execute tools mentioned in task
        var toolResults = [];
        var taskLower = userMessage.toLowerCase();

        if (/diagnos|status|health|check/.test(taskLower)) {
          var diag = {};
          try { var kvTest = await env.PRISM_KV.get("routing:last"); diag.kv = kvTest ? "OK" : "empty"; } catch(e) { diag.kv = "error: "+e.message; }
          diag.worker = "OK (responding)";
          try { var champRaw = await env.PRISM_KV.get("api-champion:last-run"); diag.champion_last_run = champRaw || "never"; } catch(e) {}
          toolResults.push({tool:"run_diagnostic", result:JSON.stringify(diag,null,2)});
          messages = messages.concat([{role:"assistant",content:"TOOL_CALL: run_diagnostic()"},{role:"user",content:"Tool result: "+JSON.stringify(diag)}]);
        }

        if (/search|find|research/.test(taskLower)) {
          var tavilyKey = k(env, ["tavily_api_key","TAVILY_API_KEY"]);
          if (tavilyKey) {
            try {
              var sr = await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:tavilyKey,query:userMessage.substring(0,200),max_results:3,include_answer:true})});
              if (sr.ok) { var sd = await sr.json(); if (sd.answer) { toolResults.push({tool:"search_web",result:sd.answer}); messages = messages.concat([{role:"assistant",content:"TOOL_CALL: search_web({query:\""+userMessage.substring(0,80)+"\"})"},{ role:"user",content:"Search result: "+sd.answer}]); } }
            } catch(e) {}
          }
        }

        // Call AI
        var result = await Promise.race([
          callProvider(env, "groq", groqKey, "openai/gpt-oss-120b", messages),
          new Promise(function(_,rej){setTimeout(function(){rej(new Error("timeout"));},8000);})
        ]).catch(function() {
          return callProvider(env, "gemini", GKEY, "gemma-4-31b-it", messages).catch(function(e){return {content:"All providers failed: "+e.message};});
        });

        var responseText = result.content || "No response.";

        // Save to thread
        if (env.PRISM_KV) {
          var threadKey = "thread:devteam-"+agentId;
          var existing = await env.PRISM_KV.get(threadKey).catch(function(){return null;});
          var thread = existing ? JSON.parse(existing) : {id:threadKey, messages:[], updated:new Date().toISOString()};
          thread.messages.push({role:"user",content:userMessage});
          thread.messages.push({role:"assistant",content:responseText});
          if (thread.messages.length > 40) thread.messages = thread.messages.slice(-40);
          thread.updated = new Date().toISOString();
          env.PRISM_KV.put(threadKey, JSON.stringify(thread), {expirationTtl:86400*30}).catch(function(){});
        }

        return json({content:responseText, provider:result.provider||"groq", model:result.model||"gpt-oss-120b", toolResults}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }


    // ── Chat history persistence (KV-backed, survives browser restart) ────────
    if (path === "/api/chat/history" && request.method === "GET") {
      try {
        var userId = url.searchParams.get("user") || "simon";
        if (!env.PRISM_KV) return json({history:[]}, 200, origin);
        var raw = await env.PRISM_KV.get("chat-history:" + userId);
        return json({history: raw ? JSON.parse(raw) : []}, 200, origin);
      } catch(e) { return json({history:[]}, 200, origin); }
    }

    if (path === "/api/chat/history" && request.method === "POST") {
      try {
        var body = await request.json();
        var userId = body.user || "simon";
        var history = body.history || [];
        if (!env.PRISM_KV) return json({error:"KV not available"}, 200, origin);
        // Keep last 100 messages
        if (history.length > 100) history = history.slice(-100);
        await env.PRISM_KV.put("chat-history:" + userId, JSON.stringify(history), {expirationTtl: 86400 * 90});
        return json({success:true, count:history.length}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }







    // ── Zoho OAuth: initiate ─────────────────────────────────────────────────
    if (path === "/oauth/zoho/calendar" && request.method === "GET") {
      var clientId = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID || env.zoho_client_id || "";
      if (!clientId) return new Response("Zoho client ID not configured", {status:500});
      var redirectUri = "https://prism-api.identitypartners.workers.dev/oauth/zoho/calendar/callback";
      var scope = "ZohoCalendar.calendar.READ,ZohoCalendar.event.READ,ZohoCalendar.event.CREATE,ZohoMail.messages.READ,ZohoMail.accounts.READ";
      var authUrl = "https://accounts.zoho.eu/oauth/v2/auth" +
        "?response_type=code" +
        "&client_id=" + encodeURIComponent(clientId) +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&scope=" + encodeURIComponent(scope) +
        "&access_type=offline" +
        "&prompt=consent";
      return Response.redirect(authUrl, 302);
    }

    // ── Zoho OAuth: callback ─────────────────────────────────────────────────
    if (path === "/oauth/zoho/calendar/callback" && request.method === "GET") {
      var url2 = new URL(request.url);
      var code = url2.searchParams.get("code");
      var error = url2.searchParams.get("error");
      if (error) {
        return new Response("<html><body><h2>Zoho OAuth Error</h2><p>" + error + "</p><a href='https://prism.identitypartners.uk/comms/zoho-calendar/'>Back</a></body></html>", {status:400, headers:{"Content-Type":"text/html"}});
      }
      if (!code) {
        return new Response("<html><body><h2>No code received</h2><a href='https://prism.identitypartners.uk/comms/zoho-calendar/'>Back</a></body></html>", {status:400, headers:{"Content-Type":"text/html"}});
      }
      var clientId2 = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID || env.zoho_client_id || "";
      var clientSecret2 = env.ZOHO_CLIENT_SECRET || env.Zoho_Client_Secret || env.zoho_client_secret || "";
      var redirectUri2 = "https://prism-api.identitypartners.workers.dev/oauth/zoho/calendar/callback";
      try {
        var tokenResp = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
          method: "POST",
          headers: {"Content-Type": "application/x-www-form-urlencoded"},
          body: "grant_type=authorization_code" +
            "&client_id=" + encodeURIComponent(clientId2) +
            "&client_secret=" + encodeURIComponent(clientSecret2) +
            "&redirect_uri=" + encodeURIComponent(redirectUri2) +
            "&code=" + encodeURIComponent(code)
        });
        var tokenData = await tokenResp.json();
        if (tokenData.error) {
          return new Response("<html><body><h2>Token Error</h2><p>" + tokenData.error + ": " + (tokenData.error_description||"") + "</p><a href='https://prism.identitypartners.uk/comms/zoho-calendar/'>Back</a></body></html>", {status:400, headers:{"Content-Type":"text/html"}});
        }
        // Store tokens in KV
        var tokenStore = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
          scope: tokenData.scope || "",
          api_domain: tokenData.api_domain || "https://calendar.zoho.eu",
          stored_at: new Date().toISOString()
        };
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("zoho:calendar:token", JSON.stringify(tokenStore));
          await env.PRISM_KV.put("zoho:mail:token", JSON.stringify(tokenStore));
        }
        return new Response(
          "<html><head><meta http-equiv='refresh' content='2;url=https://prism.identitypartners.uk/comms/zoho-calendar/'></head>" +
          "<body style='font-family:sans-serif;padding:40px;'>" +
          "<h2 style='color:#0f3b3a;'>&#x2713; Zoho Connected</h2>" +
          "<p>Calendar and Mail access granted. Redirecting back to Argentica...</p>" +
          "<p><a href='https://prism.identitypartners.uk/comms/zoho-calendar/'>Click here if not redirected</a></p>" +
          "</body></html>",
          {status:200, headers:{"Content-Type":"text/html"}}
        );
      } catch(e2) {
        return new Response("<html><body><h2>Error</h2><p>" + e2.message + "</p><a href='https://prism.identitypartners.uk/comms/zoho-calendar/'>Back</a></body></html>", {status:500, headers:{"Content-Type":"text/html"}});
      }
    }

    // ── Zoho token refresh helper ─────────────────────────────────────────────
    if (path === "/api/zoho/refresh" && request.method === "POST") {
      try {
        var stored = env.PRISM_KV ? await env.PRISM_KV.get("zoho:calendar:token") : null;
        if (!stored) return json({error:"Not connected — visit /comms/zoho-calendar/ to connect"}, 401, origin);
        var tok = JSON.parse(stored);
        if (Date.now() < tok.expires_at - 60000) return json({status:"valid", expires_at:tok.expires_at}, 200, origin);
        // Refresh
        var clientId3 = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID || "";
        var clientSecret3 = env.ZOHO_CLIENT_SECRET || env.Zoho_Client_Secret || "";
        var refreshResp = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
          method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded"},
          body:"grant_type=refresh_token&client_id="+encodeURIComponent(clientId3)+"&client_secret="+encodeURIComponent(clientSecret3)+"&refresh_token="+encodeURIComponent(tok.refresh_token)
        });
        var refreshData = await refreshResp.json();
        if (refreshData.access_token) {
          tok.access_token = refreshData.access_token;
          tok.expires_at = Date.now() + (refreshData.expires_in || 3600) * 1000;
          if (env.PRISM_KV) {
            await env.PRISM_KV.put("zoho:calendar:token", JSON.stringify(tok));
            await env.PRISM_KV.put("zoho:mail:token", JSON.stringify(tok));
          }
          return json({status:"refreshed", expires_at:tok.expires_at}, 200, origin);
        }
        return json({error:"Refresh failed", detail:refreshData}, 401, origin);
      } catch(e3) { return json({error:e3.message}, 500, origin); }
    }

    // ── Zoho Calendar: fetch events ───────────────────────────────────────────
    if (path === "/api/calendar/events" && request.method === "GET") {
      try {
        var stored2 = env.PRISM_KV ? await env.PRISM_KV.get("zoho:calendar:token") : null;
        if (!stored2) return json({today:[],week:[],next_week:[],status:"not_connected",message:"Connect at /comms/zoho-calendar/"}, 200, origin);
        var tok2 = JSON.parse(stored2);
        // Auto-refresh if expired
        if (Date.now() > tok2.expires_at - 60000) {
          var clientId4 = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID || "";
          var clientSecret4 = env.ZOHO_CLIENT_SECRET || env.Zoho_Client_Secret || "";
          var rr = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
            method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
            body:"grant_type=refresh_token&client_id="+encodeURIComponent(clientId4)+"&client_secret="+encodeURIComponent(clientSecret4)+"&refresh_token="+encodeURIComponent(tok2.refresh_token)
          });
          var rd = await rr.json();
          if (rd.access_token) {
            tok2.access_token = rd.access_token;
            tok2.expires_at = Date.now() + (rd.expires_in||3600)*1000;
            if (env.PRISM_KV) await env.PRISM_KV.put("zoho:calendar:token", JSON.stringify(tok2));
          }
        }
        // Fetch calendars list
        var apiDomain = tok2.api_domain || "https://calendar.zoho.eu";
        var calListResp = await fetch(apiDomain + "/api/v1/calendars", {
          headers:{"Authorization":"Zoho-oauthtoken " + tok2.access_token}
        });
        if (!calListResp.ok) {
          var errText = await calListResp.text();
          return json({today:[],week:[],next_week:[],status:"api_error",error:errText.substring(0,200)}, 200, origin);
        }
        var calList = await calListResp.json();
        var calendars = (calList.calendars || []).filter(function(c){return c.isdefault||c.privilege==="owner";});
        if (!calendars.length && calList.calendars) calendars = calList.calendars.slice(0,3);

        // Fetch events for next 14 days
        var now3 = new Date();
        var end3 = new Date(now3.getTime() + 14*86400000);
        var startStr = now3.toISOString().split("T")[0];
        var endStr = end3.toISOString().split("T")[0];
        var allEvents = [];
        for (var ci=0; ci<Math.min(calendars.length,5); ci++) {
          var calId = calendars[ci].uid;
          var evResp = await fetch(apiDomain + "/api/v1/calendars/" + calId + "/events?range_start=" + startStr + "&range_end=" + endStr, {
            headers:{"Authorization":"Zoho-oauthtoken " + tok2.access_token}
          });
          if (evResp.ok) {
            var evData = await evResp.json();
            (evData.events || []).forEach(function(ev) {
              allEvents.push({
                title: ev.title || ev.summary || "Event",
                start: ev.dateandtime ? ev.dateandtime.start : (ev.start || ""),
                end: ev.dateandtime ? ev.dateandtime.end : (ev.end || ""),
                calendar: calendars[ci].calname || "Calendar",
                allDay: ev.isallday || false
              });
            });
          }
        }
        // Sort and bucket
        var todayStr2 = now3.toISOString().split("T")[0];
        var weekEnd = new Date(now3.getTime() + 7*86400000).toISOString().split("T")[0];
        var todayEvs = [], weekEvs = [], nextEvs = [];
        allEvents.sort(function(a,b){return (a.start||"").localeCompare(b.start||"");});
        allEvents.forEach(function(ev) {
          var d = (ev.start||"").substring(0,10);
          if (d === todayStr2) todayEvs.push(ev);
          else if (d > todayStr2 && d <= weekEnd) weekEvs.push(ev);
          else if (d > weekEnd) nextEvs.push(ev);
        });
        return json({today:todayEvs, week:weekEvs, next_week:nextEvs, status:"ok", calendars:calendars.length}, 200, origin);
      } catch(e4) { return json({today:[],week:[],next_week:[],status:"error",error:e4.message}, 200, origin); }
    }

    // ── Zoho Mail: fetch inbox ────────────────────────────────────────────────
    if (path === "/api/zoho/mail/inbox" && request.method === "GET") {
      try {
        var stored3 = env.PRISM_KV ? await env.PRISM_KV.get("zoho:mail:token") : null;
        if (!stored3) return json({error:"Not connected",messages:[]}, 200, origin);
        var tok3 = JSON.parse(stored3);
        var apiDomain2 = tok3.api_domain || "https://mail.zoho.eu";
        // Get accounts
        var accResp = await fetch(apiDomain2 + "/api/accounts", {
          headers:{"Authorization":"Zoho-oauthtoken " + tok3.access_token}
        });
        if (!accResp.ok) return json({error:"Mail API error " + accResp.status, messages:[]}, 200, origin);
        var accData = await accResp.json();
        var accounts = accData.data || [];
        if (!accounts.length) return json({messages:[], status:"no_accounts"}, 200, origin);
        var accountId = accounts[0].accountId;
        // Get inbox messages
        var msgResp = await fetch(apiDomain2 + "/api/accounts/" + accountId + "/messages/view?folderId=inbox&limit=10", {
          headers:{"Authorization":"Zoho-oauthtoken " + tok3.access_token}
        });
        if (!msgResp.ok) return json({error:"Inbox error " + msgResp.status, messages:[]}, 200, origin);
        var msgData = await msgResp.json();
        var messages = (msgData.data || []).map(function(m) {
          return {
            id: m.messageId,
            subject: m.subject || "(no subject)",
            from: m.fromAddress || "",
            date: m.receivedTime || "",
            read: m.isRead || false,
            hasAttachment: m.hasAttachment || false
          };
        });
        return json({messages:messages, account:accounts[0].mailAddress, status:"ok"}, 200, origin);
      } catch(e5) { return json({error:e5.message, messages:[]}, 200, origin); }
    }


    // ── Delete/cancel a job ───────────────────────────────────────────────────
    if (path.startsWith("/api/jobs/") && request.method === "DELETE") {
      var jobId = path.replace("/api/jobs/", "");
      if (env.PRISM_KV && jobId) {
        await env.PRISM_KV.delete("agent-job:" + jobId).catch(function(){});
        await env.PRISM_KV.delete(jobId).catch(function(){});
        // Also mark as cancelled in case it's still referenced
        var existing = await env.PRISM_KV.get("agent-job:" + jobId).catch(function(){return null;});
        if (existing) {
          try {
            var job = JSON.parse(existing);
            job.status = "cancelled";
            await env.PRISM_KV.put("agent-job:" + jobId, JSON.stringify(job), {expirationTtl: 3600});
          } catch(e) {}
        }
      }
      return json({success: true, deleted: jobId}, 200, origin);
    }


    // ── Job: create (chunk document, store in KV, return job manifest) ────────
    if (path === "/api/jobs/create" && request.method === "POST") {
      try {
        var body = await request.json();
        var docText = body.document || "";
        var docName = body.document_name || "document";
        var task = body.task || "";
        var agentName = body.agent_name || "Research Agent";
        var systemPrompt = body.system_prompt || "";
        var chunkSize = 45000; // ~11K tokens per chunk — fits in any model's context

        if (!docText) return json({error:"No document text"}, 400, origin);

        // Split into chunks
        var chunks = [];
        var i = 0;
        while (i < docText.length) {
          chunks.push(docText.substring(i, i + chunkSize));
          i += chunkSize;
        }

        var jobId = "job-" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
        var job = {
          id: jobId,
          status: "pending",
          document_name: docName,
          task: task,
          agent_name: agentName,
          system_prompt: systemPrompt,
          total_chunks: chunks.length,
          completed_chunks: 0,
          results: [],
          synthesis: null,
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        };

        // Store job manifest
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("agent-job:" + jobId, JSON.stringify(job), {expirationTtl: 86400 * 7});
          // Store each chunk separately
          for (var ci = 0; ci < chunks.length; ci++) {
            await env.PRISM_KV.put("agent-chunk:" + jobId + ":" + ci, chunks[ci], {expirationTtl: 86400 * 7});
          }
        }

        return json({
          success: true,
          job_id: jobId,
          total_chunks: chunks.length,
          document_name: docName,
          message: "Job created. " + chunks.length + " chunks ready to process."
        }, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Job: process next chunk ───────────────────────────────────────────────
    if (path.match(/^\/api\/jobs\/[^/]+\/process$/) && request.method === "POST") {
      try {
        var jobId2 = path.split("/")[3];
        var body2 = await request.json().catch(function(){return {};});

        // Load job manifest
        var jobRaw = env.PRISM_KV ? await env.PRISM_KV.get("agent-job:" + jobId2) : null;
        if (!jobRaw) return json({error:"Job not found: " + jobId2}, 404, origin);
        var job2 = JSON.parse(jobRaw);

        if (job2.status === "complete") {
          return json({status:"complete", job: job2}, 200, origin);
        }

        var nextChunk = job2.completed_chunks;
        if (nextChunk >= job2.total_chunks) {
          // All chunks done — synthesise
          job2.status = "synthesising";
          job2.updated = new Date().toISOString();
          if (env.PRISM_KV) await env.PRISM_KV.put("agent-job:" + jobId2, JSON.stringify(job2), {expirationTtl: 86400 * 7});

          var allResults = job2.results.join("\n\n=== NEXT SECTION ===\n\n");
          var synthPrompt = job2.system_prompt ||
            ("You are " + job2.agent_name + " for Identity Partners. British English. Execute tasks completely.");
          var synthMessages = [
            {role:"system", content: synthPrompt},
            {role:"user", content: "You have processed all " + job2.total_chunks + " sections of '" + job2.document_name + "'. " +
              "Task: " + job2.task + "\n\nHere are all section results:\n\n" + allResults.substring(0, 60000) +
              "\n\nNow produce the final comprehensive synthesis. Do not truncate. Show all findings."}
          ];

          var GKEY2 = k(env, ["gemini_api_key","GEMINI_API_KEY"]) || "";
          var mistralKey2 = k(env, ["mistral_api_key","MISTRAL_API_KEY"]);
          var synthResult = await callProvider(env, "mistral", mistralKey2, "mistral-large-4", synthMessages)
            .catch(function() { return callProvider(env, "gemini", GKEY2, "gemma-4-31b-it", synthMessages); })
            .catch(function(e2) { return {content: "Synthesis failed: " + e2.message}; });

          job2.synthesis = synthResult.content;
          job2.status = "complete";
          job2.updated = new Date().toISOString();
          if (env.PRISM_KV) await env.PRISM_KV.put("agent-job:" + jobId2, JSON.stringify(job2), {expirationTtl: 86400 * 7});

          return json({
            status: "complete",
            chunk: nextChunk,
            total: job2.total_chunks,
            synthesis: job2.synthesis,
            job: job2
          }, 200, origin);
        }

        // Load and process next chunk
        var chunkText = env.PRISM_KV ? await env.PRISM_KV.get("agent-chunk:" + jobId2 + ":" + nextChunk) : null;
        if (!chunkText) {
          // Chunk missing — skip
          job2.completed_chunks++;
          job2.results.push("[Chunk " + (nextChunk+1) + " missing — skipped]");
          if (env.PRISM_KV) await env.PRISM_KV.put("agent-job:" + jobId2, JSON.stringify(job2), {expirationTtl: 86400 * 7});
          return json({status:"running", chunk: nextChunk+1, total: job2.total_chunks, skipped: true}, 200, origin);
        }

        var sysP = job2.system_prompt ||
          ("You are " + job2.agent_name + " for Identity Partners. British English. Execute tasks completely. Never truncate.");
        var chunkMessages = [
          {role:"system", content: sysP},
          {role:"user", content: "Task: " + job2.task +
            "\n\nThis is section " + (nextChunk+1) + " of " + job2.total_chunks + " from '" + job2.document_name + "'." +
            "\n\nProcess this section completely. Extract all relevant information. Do not skip anything.\n\n" + chunkText}
        ];

        var GKEY3 = k(env, ["gemini_api_key","GEMINI_API_KEY"]) || "";
        var mistralKey3 = k(env, ["mistral_api_key","MISTRAL_API_KEY"]);
        var deepseekKey3 = k(env, ["deepseek_paid","DEEPSEEK_PAID"]);

        var chunkResult = await Promise.race([
          callProvider(env, "mistral", mistralKey3, "mistral-large-4", chunkMessages)
            .catch(function() { return callProvider(env, "deepseek", deepseekKey3, "deepseek-flash", chunkMessages); })
            .catch(function() { return callProvider(env, "gemini", GKEY3, "gemma-4-31b-it", chunkMessages); })
            .catch(function(e3) { return {content: "[Chunk " + (nextChunk+1) + " error: " + e3.message + "]"}; }),
          new Promise(function(res) { setTimeout(function() { res({content:"[Chunk " + (nextChunk+1) + " timeout]"}); }, 25000); })
        ]);

        // Save result and update job
        job2.results.push("=== Section " + (nextChunk+1) + "/" + job2.total_chunks + " ===\n" + chunkResult.content);
        job2.completed_chunks = nextChunk + 1;
        job2.status = "running";
        job2.updated = new Date().toISOString();
        if (env.PRISM_KV) await env.PRISM_KV.put("agent-job:" + jobId2, JSON.stringify(job2), {expirationTtl: 86400 * 7});

        // Clean up processed chunk to save KV space
        if (env.PRISM_KV) await env.PRISM_KV.delete("agent-chunk:" + jobId2 + ":" + nextChunk).catch(function(){});

        return json({
          status: "running",
          chunk: nextChunk + 1,
          total: job2.total_chunks,
          result_preview: chunkResult.content.substring(0, 200),
          completed: job2.completed_chunks,
          remaining: job2.total_chunks - job2.completed_chunks
        }, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }

    // ── Job: get status/result ────────────────────────────────────────────────
    if (path.match(/^\/api\/jobs\/[^/]+$/) && request.method === "GET") {
      try {
        var jobId3 = path.split("/")[3];
        var jobRaw3 = env.PRISM_KV ? await env.PRISM_KV.get("agent-job:" + jobId3) : null;
        if (!jobRaw3) return json({error:"Job not found"}, 404, origin);
        var job3 = JSON.parse(jobRaw3);
        return json(job3, 200, origin);
      } catch(e) { return json({error: e.message}, 500, origin); }
    }


    // ── RAG: index document ───────────────────────────────────────────────────
    if (path === "/api/rag/index" && request.method === "POST") {
      try {
        var ragBody = await request.json();
        var ragText = ragBody.text || "";
        var ragName = ragBody.name || "document";
        var ragDocId = ragBody.doc_id || ("doc-" + Date.now());
        var ragWsId = ragBody.workspace_id || null;
        var ragTags = ragBody.tags || [];
        var GKEY_I = k(env,["gemini_api_key","GEMINI_API_KEY"])||"";
        if (!ragText) return json({error:"No text"}, 400, origin);
        if (!GKEY_I) return json({error:"No Gemini key"}, 500, origin);
        if (!env.PRISM_D1) return json({error:"D1 not bound — add PRISM_D1 in CF dashboard"}, 500, origin);
        var CSIZE = 2000, COVERLAP = 200;
        var ragChunks = [];
        for (var rci = 0; rci < ragText.length; rci += CSIZE - COVERLAP) {
          ragChunks.push(ragText.substring(rci, rci + CSIZE));
        }
        var ragEmbedded = 0, ragErrors = 0;
        await env.PRISM_D1.prepare("DELETE FROM rag_chunks WHERE doc_id=?").bind(ragDocId).run().catch(function(){});
        await env.PRISM_D1.prepare("DELETE FROM rag_documents WHERE id=?").bind(ragDocId).run().catch(function(){});
        for (var rbi = 0; rbi < ragChunks.length; rbi += 5) {
          var ragBatch = ragChunks.slice(rbi, rbi + 5);
          await Promise.all(ragBatch.map(function(chunk, rci2) {
            var idx = rbi + rci2;
            return fetch("https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent", {
              method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":GKEY_I},
              body:JSON.stringify({model:"models/text-embedding-004",content:{parts:[{text:chunk.substring(0,8000)}]}})
            })
            .then(function(r){return r.json();})
            .then(function(d){
              if (!d.embedding||!d.embedding.values) throw new Error("no embedding");
              return env.PRISM_D1.prepare(
                "INSERT OR REPLACE INTO rag_chunks (id,doc_id,doc_name,workspace_id,chunk_index,chunk_text,embedding,token_count,tags) VALUES (?,?,?,?,?,?,?,?,?)"
              ).bind(ragDocId+":"+idx,ragDocId,ragName,ragWsId,idx,chunk.substring(0,1000),JSON.stringify(d.embedding.values),Math.floor(chunk.length/4),JSON.stringify(ragTags)).run();
            })
            .then(function(){ragEmbedded++;})
            .catch(function(){ragErrors++;});
          }));
          if (rbi + 5 < ragChunks.length) await new Promise(function(r){setTimeout(r,300);});
        }
        await env.PRISM_D1.prepare(
          "INSERT OR REPLACE INTO rag_documents (id,name,workspace_id,source,chunk_count,tags) VALUES (?,?,?,?,?,?)"
        ).bind(ragDocId,ragName,ragWsId,ragBody.source||"",ragChunks.length,JSON.stringify(ragTags)).run().catch(function(){});
        return json({success:true,doc_id:ragDocId,chunks_total:ragChunks.length,chunks_embedded:ragEmbedded,errors:ragErrors}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: search ───────────────────────────────────────────────────────────
    if (path === "/api/rag/search" && request.method === "POST") {
      try {
        var sBody = await request.json();
        var sQuery = sBody.query || "";
        var sTopK = sBody.top_k || 5;
        var sWsId = sBody.workspace_id || null;
        var sDocId = sBody.doc_id || null;
        var GKEY_S = k(env,["gemini_api_key","GEMINI_API_KEY"])||"";
        if (!sQuery) return json({error:"No query"}, 400, origin);
        if (!env.PRISM_D1) return json({error:"D1 not bound"}, 500, origin);
        var sEmbResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",{
          method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GKEY_S},
          body:JSON.stringify({model:"models/text-embedding-004",content:{parts:[{text:sQuery}]},taskType:"RETRIEVAL_QUERY"})
        });
        var sEmbData = await sEmbResp.json();
        if (!sEmbData.embedding||!sEmbData.embedding.values) return json({error:"Query embedding failed"}, 500, origin);
        var sQVec = sEmbData.embedding.values;
        var sSql = "SELECT id,doc_id,doc_name,chunk_index,chunk_text,embedding FROM rag_chunks";
        var sParams = [];
        if (sDocId) { sSql += " WHERE doc_id=?"; sParams.push(sDocId); }
        else if (sWsId) { sSql += " WHERE workspace_id=?"; sParams.push(sWsId); }
        sSql += " LIMIT 500";
        var sStmt = env.PRISM_D1.prepare(sSql);
        if (sParams.length) sStmt = sStmt.bind(...sParams);
        var sRows = await sStmt.all();
        var sCandidates = sRows.results || [];
        function cosSim(a,b){var d=0,na=0,nb=0;for(var i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?d/(Math.sqrt(na)*Math.sqrt(nb)):0;}
        var sScored = sCandidates.map(function(row){
          try{var v=JSON.parse(row.embedding);return {id:row.id,doc_id:row.doc_id,doc_name:row.doc_name,chunk_index:row.chunk_index,text:row.chunk_text,score:cosSim(sQVec,v)};}
          catch(e){return {id:row.id,score:0,text:row.chunk_text,doc_name:row.doc_name};}
        });
        sScored.sort(function(a,b){return b.score-a.score;});
        return json({query:sQuery,results:sScored.slice(0,sTopK),total_searched:sCandidates.length}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: list documents ───────────────────────────────────────────────────
    if (path === "/api/rag/documents" && request.method === "GET") {
      try {
        if (!env.PRISM_D1) return json({error:"D1 not bound"}, 500, origin);
        var lUrl = new URL(request.url);
        var lWsId = lUrl.searchParams.get("workspace_id");
        var lSql = lWsId ? "SELECT * FROM rag_documents WHERE workspace_id=? ORDER BY indexed_at DESC" : "SELECT * FROM rag_documents ORDER BY indexed_at DESC LIMIT 50";
        var lStmt = lWsId ? env.PRISM_D1.prepare(lSql).bind(lWsId) : env.PRISM_D1.prepare(lSql);
        var lDocs = await lStmt.all();
        return json({documents:lDocs.results||[]}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

    // ── RAG: delete document ──────────────────────────────────────────────────
    if (path.match(/^\/api\/rag\/documents\/[^/]+$/) && request.method === "DELETE") {
      try {
        if (!env.PRISM_D1) return json({error:"D1 not bound"}, 500, origin);
        var dDocId = path.split("/").pop();
        await env.PRISM_D1.prepare("DELETE FROM rag_chunks WHERE doc_id=?").bind(dDocId).run();
        await env.PRISM_D1.prepare("DELETE FROM rag_documents WHERE id=?").bind(dDocId).run();
        return json({success:true,deleted:dDocId}, 200, origin);
      } catch(e) { return json({error:e.message}, 500, origin); }
    }

return json({ error: "Not found", path }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    // Daily pipeline at 08:00, 13:00, 20:00 UTC
    ctx.waitUntil((async function() {
      try {
        var hour = new Date().getUTCHours();
        var slot = hour >= 7 && hour < 9 ? "morning" : hour >= 12 && hour < 14 ? "lunchtime" : "evening";
        // Log the cron run
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("cron:last-run", JSON.stringify({ ts: new Date().toISOString(), slot }), { expirationTtl: 86400 * 7 });
        }
      } catch(e) {}
    })());
  }
};

