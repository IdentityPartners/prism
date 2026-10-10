var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.js
async function uploadToImgur(imageBase64, env) {
  var clientId = env.IMGUR_CLIENT_ID || env.IMGUR_CLIENT_ID || env.IMGUR_PAID_1 || "";
  var resp = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: {
      "Authorization": "Client-ID " + clientId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image: imageBase64,
      type: "base64",
      title: "Identity Partners",
      description: "identitypartners.uk"
    })
  });
  var data = await resp.json();
  if (data.success && data.data && data.data.link) {
    return { success: true, url: data.data.link, deleteHash: data.data.deletehash };
  }
  return { success: false, error: data.data ? data.data.error : "Imgur upload failed" };
}
__name(uploadToImgur, "uploadToImgur");
var AUTO_TAG_CATEGORIES = {
  "addiction": ["addiction", "recovery", "sobriety", "alcohol", "drugs", "substance", "relapse", "withdrawal", "12-step", "AA", "NA", "abstinence", "clean", "sober", "dependence", "detox", "harm reduction", "rehab", "rehabilitation", "compulsion", "craving"],
  "trauma": ["trauma", "PTSD", "abuse", "neglect", "adverse", "ACE", "dissociation", "flashback", "trigger", "hypervigilance", "complex trauma", "C-PTSD", "childhood", "survivor", "healing", "wound", "rupture", "repair", "safety", "stabilisation"],
  "mental-health": ["anxiety", "depression", "OCD", "bipolar", "schizophrenia", "mental health", "wellbeing", "therapy", "counselling", "psychiatry", "psychotherapy", "CBT", "DBT", "mindfulness", "self-care", "burnout", "stress", "grief", "loss", "bereavement", "suicidal", "crisis", "support"],
  "identity": ["identity", "self", "persona", "imposter", "authenticity", "values", "purpose", "meaning", "ikigai", "who am I", "self-worth", "self-esteem", "confidence", "belonging", "culture", "heritage", "narrative", "story", "past", "future"],
  "neurodivergence": ["ADHD", "autism", "dyslexia", "dyspraxia", "neurodivergent", "executive function", "masking", "stimming", "sensory", "ASD", "spectrum", "hyperfocus", "rejection sensitive", "RSD", "processing", "working memory"],
  "relationships": ["relationship", "attachment", "boundaries", "family", "partner", "loneliness", "connection", "intimacy", "trust", "codependency", "enmeshment", "avoidant", "anxious", "secure", "communication", "conflict", "repair", "rupture", "divorce", "separation"],
  "research": ["research", "study", "paper", "evidence", "data", "statistics", "literature", "academic", "journal", "findings", "meta-analysis", "systematic review", "clinical trial", "neuroscience", "psychology", "sociology", "epidemiology"],
  "social-media": ["post", "tweet", "bluesky", "linkedin", "instagram", "facebook", "content", "refract", "atomise", "social", "caption", "hashtag", "carousel", "reel", "story", "engagement", "reach", "audience"],
  "business": ["client", "CRM", "booking", "revenue", "programme", "cohort", "platform", "monetise", "invoice", "session", "consultation", "referral", "onboarding", "retention", "conversion", "funnel", "pricing", "package"],
  "technical": ["worker", "cloudflare", "API", "deploy", "code", "bug", "fix", "error", "database", "KV", "D1", "wrangler", "github", "commit", "route", "endpoint", "function", "script"],
  "creative": ["canvas", "design", "podcast", "worksheet", "template", "brand", "logo", "colour", "font", "visual", "infographic", "carousel", "quote card", "image", "graphic", "layout", "typography"],
  "personal": ["Goldsmiths", "MSc", "master", "study", "university", "placement", "volunteer", "career", "CV"]
};
function autoTag(text) {
  if (!text) return [];
  var lower = text.toLowerCase();
  var tags = [];
  Object.keys(AUTO_TAG_CATEGORIES).forEach(function(tag) {
    var keywords = AUTO_TAG_CATEGORIES[tag];
    if (keywords.some(function(kw) {
      return lower.includes(kw.toLowerCase());
    })) {
      tags.push(tag);
    }
  });
  return tags;
}
__name(autoTag, "autoTag");
async function saveThreadToD1(env, threadId, title, messages, persona, profile) {
  if (!env.PRISM_D1) return null;
  try {
    var now = (/* @__PURE__ */ new Date()).toISOString();
    var allText = "";
    for (var mi = 0; mi < messages.length; mi++) {
      var mc = messages[mi];
      if (mc && typeof mc.content === "string") allText += " " + mc.content;
    }
    var tags = autoTag(allText);
    var tagsJson = JSON.stringify(tags);
    var safeTitle = (title || "Untitled").substring(0, 200);
    var safePersona = (persona || "Gerald").substring(0, 50);
    var safeProfile = (profile || "balanced").substring(0, 50);
    var msgCount = messages ? messages.length : 0;
    var existing = await env.PRISM_D1.prepare("SELECT id FROM threads WHERE id = ?").bind(threadId).first();
    if (existing) {
      await env.PRISM_D1.prepare(
        "UPDATE threads SET title=?, message_count=?, auto_tags=?, updated_at=? WHERE id=?"
      ).bind(safeTitle, msgCount, tagsJson, now, threadId).run();
    } else {
      await env.PRISM_D1.prepare(
        "INSERT INTO threads (id, title, persona, profile, message_count, auto_tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(threadId, safeTitle, safePersona, safeProfile, msgCount, tagsJson, now, now).run();
    }
    if (messages && messages.length > 0) {
      var stmts = [];
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (!msg || !msg.role || !msg.content) continue;
        var msgId = threadId + ":" + i;
        var content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        var provider = msg.provider || null;
        var model = msg.model || null;
        stmts.push(
          env.PRISM_D1.prepare(
            "INSERT OR IGNORE INTO messages (id, thread_id, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(msgId, threadId, msg.role, content.substring(0, 1e4), provider, model, now)
        );
      }
      if (stmts.length > 0) {
        for (var b = 0; b < stmts.length; b += 10) {
          await env.PRISM_D1.batch(stmts.slice(b, b + 10));
        }
      }
    }
    return tags;
  } catch (e) {
    console.error("D1 save error:", e.message, e.stack ? e.stack.substring(0, 200) : "");
    return null;
  }
}
__name(saveThreadToD1, "saveThreadToD1");
async function getThreadFromD1(env, threadId) {
  if (!env.PRISM_D1) return null;
  try {
    var thread = await env.PRISM_D1.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first();
    if (!thread) return null;
    var msgs = await env.PRISM_D1.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY rowid ASC").bind(threadId).all();
    var parsedTags = [];
    try {
      parsedTags = JSON.parse(thread.auto_tags || "[]");
    } catch (e) {
    }
    return {
      id: thread.id,
      title: thread.title,
      persona: thread.persona,
      profile: thread.profile,
      tags: parsedTags,
      messages: (msgs.results || []).map(function(m) {
        return { role: m.role, content: m.content, provider: m.provider, model: m.model };
      }),
      created: thread.created_at,
      updated: thread.updated_at,
      source: "d1"
    };
  } catch (e) {
    console.error("D1 get error:", e.message);
    return null;
  }
}
__name(getThreadFromD1, "getThreadFromD1");
async function listThreadsFromD1(env, userId, limit, offset, tag) {
  if (!env.PRISM_D1) return [];
  try {
    var lim = limit || 100;
    var off = offset || 0;
    var result;
    if (tag) {
      result = await env.PRISM_D1.prepare(
        "SELECT id, title, persona, profile, message_count, auto_tags, created_at, updated_at FROM threads WHERE archived = 0 AND auto_tags LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      ).bind("%" + (tag || "").replace(/[%_]/g, "\\$&") + "%", lim, off).all();
    } else {
      result = await env.PRISM_D1.prepare(
        "SELECT id, title, persona, profile, message_count, auto_tags, created_at, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      ).bind(lim, off).all();
    }
    return (result.results || []).map(function(t) {
      return {
        id: t.id,
        title: t.title,
        persona: t.persona,
        profile: t.profile,
        messageCount: t.message_count,
        tags: JSON.parse(t.auto_tags || "[]"),
        created: t.created_at,
        updated: t.updated_at
      };
    });
  } catch (e) {
    console.error("D1 list error:", e.message);
    return [];
  }
}
__name(listThreadsFromD1, "listThreadsFromD1");
async function archiveToNotion(env, threadId, title, messages, tags) {
  var notionToken = env.NOTION_TOKEN || env.ntn_token;
  var notionDb = env.NOTION_DB || env.NOTION_DB_ID;
  if (!notionToken || !notionDb) return null;
  try {
    var blocks = [];
    if (tags && tags.length > 0) {
      blocks.push({ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Tags: " + tags.join(", ") } }], icon: { emoji: "" }, color: "gray_background" } });
    }
    var msgLimit = Math.min(messages.length, 50);
    for (var i = 0; i < msgLimit; i++) {
      var msg = messages[i];
      if (!msg || !msg.role) continue;
      var content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      var prefix = msg.role === "user" ? " " : " Gerald: ";
      var chunks = [];
      for (var j = 0; j < content.length; j += 1900) {
        chunks.push(content.substring(j, j + 1900));
      }
      chunks.forEach(function(chunk, ci) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{
              type: "text",
              text: { content: (ci === 0 ? prefix : "  ") + chunk },
              annotations: { bold: msg.role === "user", color: msg.role === "user" ? "blue" : "default" }
            }]
          }
        });
      });
    }
    if (messages.length > msgLimit) {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "... (" + (messages.length - msgLimit) + " more messages)" } }] } });
    }
    var pageData = {
      parent: { database_id: notionDb },
      properties: {
        Name: { title: [{ type: "text", text: { content: title || "Untitled Thread" } }] },
        Tags: { multi_select: (tags || []).map(function(t) {
          return { name: t };
        }) },
        "Thread ID": { rich_text: [{ type: "text", text: { content: threadId } }] },
        Messages: { number: messages.length },
        Date: { date: { start: (/* @__PURE__ */ new Date()).toISOString().split("T")[0] } }
      },
      children: blocks.slice(0, 100)
      // Notion limit
    };
    var resp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { "Authorization": "Bearer " + notionToken, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
      body: JSON.stringify(pageData)
    });
    var data = await resp.json();
    if (data.id) {
      if (env.PRISM_D1) {
        await env.PRISM_D1.prepare("UPDATE threads SET notion_page_id = ? WHERE id = ?").bind(data.id, threadId).run();
      }
      return data.id;
    }
    return null;
  } catch (e) {
    console.error("Notion archive error:", e.message);
    return null;
  }
}
__name(archiveToNotion, "archiveToNotion");
async function getZohoInboxSummary(env) {
  try {
    var tokens = null;
    if (env.PRISM_KV) {
      var raw = await env.PRISM_KV.get("zoho:tokens:mail");
      if (raw) tokens = JSON.parse(raw);
    }
    if (!tokens || !tokens.access_token) return null;
    var resp = await fetch("https://mail.zoho.eu/api/accounts", {
      headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token }
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var accounts = data.data || [];
    if (accounts.length === 0) return null;
    var accountId = accounts[0].accountId;
    var inboxResp = await fetch("https://mail.zoho.eu/api/accounts/" + accountId + "/folders?foldername=Inbox", {
      headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token }
    });
    if (!inboxResp.ok) return null;
    var inboxData = await inboxResp.json();
    var folders = inboxData.data || [];
    var inbox = folders.find(function(f) {
      return f.folderName === "Inbox";
    });
    if (!inbox) return null;
    var msgResp = await fetch("https://mail.zoho.eu/api/accounts/" + accountId + "/messages/view?folderId=" + inbox.folderId + "&status=unread&limit=5", {
      headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token }
    });
    if (!msgResp.ok) return { unread: inbox.unreadCount || 0, messages: [] };
    var msgData = await msgResp.json();
    var messages = (msgData.data || []).map(function(m) {
      return { from: m.fromAddress, subject: m.subject, date: m.receivedTime };
    });
    return { unread: inbox.unreadCount || 0, messages };
  } catch (e) {
    return null;
  }
}
__name(getZohoInboxSummary, "getZohoInboxSummary");
async function runWeeklyResearchScrape(env) {
  var RESEARCH_QUERIES = [
    "addiction recovery evidence-based 2026",
    "trauma-informed care mental health 2026",
    "neurodivergence ADHD identity 2026",
    "loneliness social isolation mental health 2026",
    "recovery capital community support 2026",
    "adverse childhood experiences ACE trauma 2026",
    "identity formation therapy 2026",
    "peer support addiction recovery outcomes 2026"
  ];
  var results = [];
  var tavilyKey = env.tavily_api_key || env.TAVILY_PAID_1;
  var semanticKey = env.semantic_scholar_api_key || env.SEMANTICSCHOLAR_FREE_1;
  for (var i = 0; i < Math.min(RESEARCH_QUERIES.length, 4); i++) {
    var query = RESEARCH_QUERIES[i];
    try {
      if (tavilyKey) {
        var tResp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: 3, search_depth: "advanced", include_domains: ["pubmed.ncbi.nlm.nih.gov", "scholar.google.com", "semanticscholar.org", "ncbi.nlm.nih.gov", "bmj.com", "thelancet.com", "nature.com", "sciencedirect.com"] })
        });
        if (tResp.ok) {
          var tData = await tResp.json();
          (tData.results || []).forEach(function(r) {
            results.push({ query, title: r.title, url: r.url, snippet: (r.content || "").substring(0, 300), source: "tavily", date: (/* @__PURE__ */ new Date()).toISOString() });
          });
        }
      }
      if (semanticKey) {
        var sResp = await fetch("https://api.semanticscholar.org/graph/v1/paper/search?query=" + encodeURIComponent(query) + "&limit=3&fields=title,abstract,year,authors,url", {
          headers: { "x-api-key": semanticKey }
        });
        if (sResp.ok) {
          var sData = await sResp.json();
          (sData.data || []).forEach(function(p) {
            if (p.year >= 2020) {
              results.push({ query, title: p.title, url: p.url || "https://semanticscholar.org/paper/" + p.paperId, snippet: (p.abstract || "").substring(0, 300), source: "semantic-scholar", year: p.year, date: (/* @__PURE__ */ new Date()).toISOString() });
            }
          });
        }
      }
    } catch (e) {
    }
  }
  if (env.PRISM_KV && results.length > 0) {
    var scrapeKey = "research:weekly:" + (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    await env.PRISM_KV.put(scrapeKey, JSON.stringify({ results, runAt: (/* @__PURE__ */ new Date()).toISOString(), count: results.length }), { expirationTtl: 86400 * 30 });
    await env.PRISM_KV.put("research:latest", JSON.stringify({ results: results.slice(0, 20), runAt: (/* @__PURE__ */ new Date()).toISOString(), count: results.length }));
  }
  var socialPosts = [];
  if (results.length > 0 && env.PRISM_KV) {
    var topResults = results.slice(0, 5);
    for (var j = 0; j < topResults.length; j++) {
      var r2 = topResults[j];
      try {
        var postResult = await orchestrate(env, [
          { role: "system", content: "You are a social media content creator for Identity Partners. Write a compelling Bluesky post (under 280 chars) about this research finding. British English. Professional. Include the key insight. End with www.identitypartners.uk" },
          { role: "user", content: "Research: " + r2.title + "\n\nKey finding: " + r2.snippet }
        ], "fast", "social_post", null);
        if (postResult.content) {
          socialPosts.push({ content: postResult.content, source: r2.title, url: r2.url, platform: "bluesky" });
        }
      } catch (e) {
      }
    }
    for (var k = 0; k < socialPosts.length; k++) {
      var sp = socialPosts[k];
      var qKey = "queue:research-" + Date.now() + "-" + k;
      await env.PRISM_KV.put(qKey, JSON.stringify({
        id: qKey,
        platform: "bluesky",
        content: sp.content,
        type: "Research Post",
        status: "pending",
        source: "weekly-research",
        sourceTitle: sp.source,
        sourceUrl: sp.url,
        scheduledAt: new Date(Date.now() + (k + 1) * 36e5).toISOString(),
        created: (/* @__PURE__ */ new Date()).toISOString()
      }));
    }
  }
  var tgToken = env.TELEGRAM_TOKEN || env.telegram_bot_token;
  var tgChat = env.TELEGRAM_CHAT || env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat && results.length > 0) {
    var summary = " Weekly Research Scrape complete\n" + results.length + " findings across " + RESEARCH_QUERIES.slice(0, 4).length + " topics\n" + socialPosts.length + " social posts queued\n\nTop finding: " + (results[0] ? results[0].title.substring(0, 100) : "none");
    await fetch("https://api.telegram.org/bot" + tgToken + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgChat, text: summary })
    });
  }
  return { results: results.length, posts: socialPosts.length };
}
__name(runWeeklyResearchScrape, "runWeeklyResearchScrape");
async function generateImageKie(key, model, prompt) {
  var resp = await fetch("https://api.kie.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" })
  });
  if (!resp.ok) throw new Error("kie.ai image HTTP " + resp.status);
  var data = await resp.json();
  var url = data.data && data.data[0] && (data.data[0].url || data.data[0].b64_json);
  if (!url) throw new Error("kie.ai image: no url");
  return { url, provider: "kie.ai/" + model };
}
__name(generateImageKie, "generateImageKie");
async function generateMusicKie(key, prompt, style, instrumental) {
  var resp = await fetch("https://api.kie.ai/suno-gen/v1/media/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model: "suno-gen",
      prompt,
      style: style || "ambient instrumental",
      instrumental: instrumental !== false,
      duration: 30
    })
  });
  if (!resp.ok) throw new Error("kie.ai music HTTP " + resp.status);
  var data = await resp.json();
  return { taskId: data.task_id, provider: "kie.ai/suno-v5.5" };
}
__name(generateMusicKie, "generateMusicKie");
async function getMusicStatusKie(key, taskId) {
  var resp = await fetch("https://api.kie.ai/suno-gen/v1/media/generations/" + taskId, {
    headers: { "Authorization": "Bearer " + key }
  });
  if (!resp.ok) throw new Error("kie.ai music status HTTP " + resp.status);
  var data = await resp.json();
  return data;
}
__name(getMusicStatusKie, "getMusicStatusKie");
async function runAgenticPipeline(env, config) {
  var log = [];
  var results = {};
  var pmHistory = [];
  var startTime = Date.now();
  function addLog(step, model, msg, status) {
    var entry = { step, model, msg, status: status || "info", ts: (/* @__PURE__ */ new Date()).toISOString() };
    log.push(entry);
    console.log("[AGENT] " + step + " (" + model + "): " + msg);
  }
  __name(addLog, "addLog");
  async function askPM(question, context) {
    pmHistory.push({ role: "user", content: "AGENT QUERY: " + question + (context ? "\n\nContext: " + context : "") });
    var pmMessages = [
      { role: "system", content: "You are the Programme Manager for an agentic AI pipeline running for Identity Partners. You coordinate between models, answer their questions, and modify the pipeline if something is not working. You have full knowledge of the pipeline steps, the IP brand guidelines, and the social media strategy. British English. Be direct and specific. No sycophancy. RULES: Never describe actions - execute them using available tools. Never invent business metrics, engagement numbers, or meeting outcomes. Never say I would... - do it. Never hallucinate data. If a tool is unavailable, say so plainly and escalate. You are an executor, not a consultant." },
      ...pmHistory
    ];
    var pmResult = await orchestrate(env, pmMessages, "balanced", "agent_task", null);
    pmHistory.push({ role: "assistant", content: pmResult.content });
    return pmResult.content;
  }
  __name(askPM, "askPM");
  addLog("step1", "gemma4/cerebras", "Generating search strings for: " + config.topic, "running");
  var searchStrings = [];
  try {
    var step1Result = await orchestrate(env, [
      { role: "system", content: 'You are a research strategist for Identity Partners. Your job is to expand a topic into a rich set of search queries that will find the most relevant academic papers, news articles, policy documents, and practitioner content. For each topic, you must: (1) identify synonyms and related terms (e.g. "stigma"  "shamed", "ostracised", "outcast", "deviant", "marginalised", "labelled"); (2) generate queries from multiple angles: academic, news, policy, practitioner, lived-experience, UK-specific; (3) include both broad and narrow queries. Return as a JSON array of strings only. No other text.' },
      { role: "user", content: 'Expand this topic into 10 diverse search queries: "' + config.topic + '". Include synonyms, related terms, and multiple angles (academic, news, policy, practitioner, lived experience, UK context). The queries should collectively cover the full semantic space of the topic.' }
    ], "fast", "research", null);
    try {
      var m = step1Result.content.match(/\[\s*"[\s\S]*?"\s*\]/);
      searchStrings = m ? JSON.parse(m[0]) : step1Result.content.split("\n").filter(function(l) {
        return l.trim().length > 10;
      }).slice(0, 8);
    } catch (e) {
      searchStrings = [config.topic + " research 2026", config.topic + " UK policy", config.topic + " lived experience"];
    }
    addLog("step1", "gemma4/cerebras", "Generated " + searchStrings.length + " search strings", "ok");
    results.searchStrings = searchStrings;
  } catch (e) {
    addLog("step1", "gemma4/cerebras", "Error: " + e.message + " -- asking PM", "error");
    var pmFix = await askPM("Step 1 failed: " + e.message + ". Should I use default search strings or retry?", config.topic);
    searchStrings = [config.topic, config.topic + " UK", config.topic + " recovery", config.topic + " mental health"];
    addLog("step1", "pm", "PM response: " + pmFix.substring(0, 100) + " -- using defaults", "warn");
  }
  addLog("step2", "tavily+exa+semantic", "Scraping " + searchStrings.length + " queries across all sources", "running");
  var allFindings = [];
  var tavilyKey = env.tavily_api_key || env.TAVILY_PAID_1;
  var semanticKey = env.semantic_scholar_api_key || env.SEMANTICSCHOLAR_FREE_1;
  var exaKey = env.exa_api_key || env.EXA_PAID_1;
  var scrapePromises = searchStrings.slice(0, 6).map(async function(query) {
    var findings = [];
    if (tavilyKey) {
      try {
        var tr = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query, max_results: 3, search_depth: "advanced" }) });
        if (tr.ok) {
          var td = await tr.json();
          (td.results || []).forEach(function(r) {
            findings.push({ title: r.title, url: r.url, snippet: (r.content || "").substring(0, 400), source: "tavily", query });
          });
        }
      } catch (e) {
      }
    }
    if (semanticKey) {
      try {
        var sr = await fetch("https://api.semanticscholar.org/graph/v1/paper/search?query=" + encodeURIComponent(query) + "&limit=2&fields=title,abstract,year,url", { headers: { "x-api-key": semanticKey } });
        if (sr.ok) {
          var sd = await sr.json();
          (sd.data || []).filter(function(p) {
            return p.year >= 2020;
          }).forEach(function(p) {
            findings.push({ title: p.title, url: p.url || "", snippet: (p.abstract || "").substring(0, 400), source: "semantic-scholar", query, year: p.year });
          });
        }
      } catch (e) {
      }
    }
    if (exaKey) {
      try {
        var er = await fetch("https://api.exa.ai/search", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": exaKey }, body: JSON.stringify({ query, numResults: 2, useAutoprompt: true }) });
        if (er.ok) {
          var ed = await er.json();
          (ed.results || []).forEach(function(r) {
            findings.push({ title: r.title, url: r.url, snippet: (r.text || "").substring(0, 400), source: "exa", query });
          });
        }
      } catch (e) {
      }
    }
    return findings;
  });
  var scrapeResults = await Promise.allSettled(scrapePromises);
  scrapeResults.forEach(function(r) {
    if (r.status === "fulfilled") allFindings = allFindings.concat(r.value);
  });
  addLog("step2", "tavily+exa+semantic", "Found " + allFindings.length + " findings across all sources", "ok");
  results.findings = allFindings;
  if (allFindings.length < 3) {
    var pmAdvice = await askPM("Only " + allFindings.length + ' findings found for "' + config.topic + '". Should I proceed or widen the search?', JSON.stringify(searchStrings));
    addLog("step2", "pm", "PM: " + pmAdvice.substring(0, 100), "warn");
  }
  addLog("step3", "deepseek", "Synthesising " + allFindings.length + " findings", "running");
  var synthesis = "";
  var socialAssets = {};
  try {
    var findingsText = allFindings.slice(0, 12).map(function(f) {
      return f.title + " (" + f.source + ", " + f.year + "):\n" + f.snippet;
    }).join("\n\n");
    var step3Result = await orchestrate(env, [
      { role: "system", content: "You are a content strategist for Identity Partners. Synthesise research findings into social media content. British English. No sycophancy. No wellness retreat language. Evidence-based, warm, direct. Return a JSON object with these exact keys: summary (200 words), bluesky_posts (array of 5 strings, each under 280 chars), linkedin_post (150 words, professional), quote_cards (array of 5 strings, each 15-25 words, powerful standalone quotes), instagram_caption (100 words + 8 hashtags), facebook_post (120 words, community-focused)." },
      { role: "user", content: 'Synthesise these findings about "' + config.topic + '" into social media content:\n\n' + findingsText }
    ], "balanced", "drafting", null);
    try {
      var jsonMatch = step3Result.content.match(/\{[\s\S]*\}/);
      socialAssets = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      synthesis = socialAssets.summary || step3Result.content.substring(0, 500);
    } catch (e) {
      synthesis = step3Result.content.substring(0, 500);
    }
    addLog("step3", "deepseek", "Synthesis complete. Assets: " + Object.keys(socialAssets).join(", "), "ok");
    results.synthesis = synthesis;
    results.socialAssets = socialAssets;
  } catch (e) {
    addLog("step3", "deepseek", "Error: " + e.message, "error");
    var pmFix3 = await askPM("DeepSeek synthesis failed: " + e.message + ". Should I retry with a different model?", "");
    addLog("step3", "pm", pmFix3.substring(0, 100), "warn");
  }
  addLog("step4", "canvas", "Generating canvas images for quote cards", "running");
  var canvasUrls = [];
  var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;

  if (quotes.length > 0) {
    for (var qi = 0; qi < Math.min(quotes.length, 3); qi++) {
      var quote = quotes[qi];
      try {
        // generateCanvasHtml now returns proper HTML/CSS with embedded background
        // No JS canvas element — eliminates the Browserless render timeout
        var html = await generateCanvasHtml(quote, ["quote-teal","quote-rose","quote-ivory","quote-dark"][qi % 4], env);

        var canvasGenerated = false;
        if (browserlessKey) {
          var blResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              html,
              options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false },
              waitForFunction: { fn: "() => document.title === 'READY'", timeout: 10000 },
              waitForTimeout: 12000
            })
          });

          if (blResp.ok) {
            var pngBuf = await blResp.arrayBuffer();
            if (pngBuf.byteLength > 5000) {
              var canvasKey = "agent-canvas-" + (config.topic || "ip").replace(/\s+/g, "-").substring(0, 20) + "-" + qi + "-" + Date.now() + ".png";
              if (env.PRISM_ASSETS) {
                await env.PRISM_ASSETS.put(canvasKey, pngBuf, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 30 });
              }
              var canvasUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + canvasKey;
              canvasUrls.push({ url: canvasUrl, quote, theme: qi % 4 });
              addLog("step4", "browserless", "Canvas " + qi + " generated: " + pngBuf.byteLength + " bytes", "ok");
              canvasGenerated = true;
            } else {
              addLog("step4", "browserless", "Canvas " + qi + " too small (" + pngBuf.byteLength + " bytes) — using pre-baked", "warn");
            }
          } else {
            addLog("step4", "browserless", "Canvas " + qi + " Browserless error " + blResp.status + " — using pre-baked", "warn");
          }
        }

        if (!canvasGenerated) {
          // Option B: pre-baked R2 template (spec Section 3.2)
          var ti = (qi * 37 + Math.floor(Date.now() / 86400000)) % 150;
          canvasUrls.push({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti + ".png", quote, theme: qi % 4 });
          addLog("step4", "prebaked", "Canvas " + qi + " using pre-baked template " + ti, "ok");
        }
      } catch (e) {
        var ti2 = qi % 150;
        canvasUrls.push({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti2 + ".png", quote, theme: qi % 4 });
        addLog("step4", "prebaked", "Canvas " + qi + " error fallback: " + e.message, "warn");
      }
    }
  } else {
    addLog("step4", "prebaked", "No quotes — using pre-baked templates", "warn");
    for (var ti3 = 0; ti3 < 3; ti3++) {
      canvasUrls.push({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti3 + ".png", quote: "", theme: ti3 % 4 });
    }
  }

  results.canvasUrls = canvasUrls;
  addLog("step5", "gemma4-vision", "QA checking " + canvasUrls.length + " canvases", "running");
  var approvedCanvases = [];
  var geminiKey = env.gemini_paid_api_key || env.GEMINI_PAID_1 || env.gemini_api_key;
  for (var ci = 0; ci < canvasUrls.length; ci++) {
    var cv = canvasUrls[ci];
    var qaPass = true;
    var qaReason = "Auto-approved (no vision model)";
    if (geminiKey) {
      try {
        var imgResp = await fetch(cv.url);
        if (imgResp.ok) {
          var imgBuf = await imgResp.arrayBuffer();
          var imgB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
          var qaResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "QA check for Identity Partners social media canvas. Check ALL of: (1) Quote text clearly readable? (2) IP logo visible top-right? (3) Colour grid visible top-left? (4) IdentityPartners wordmark present? (5) Background image visible? (6) Professional appearance? Reply PASS or FAIL + specific reason for each check." }, { inline_data: { mime_type: "image/png", data: imgB64.substring(0, 2e5) } }] }] }) });
          if (qaResp.ok) {
            var qaData = await qaResp.json();
            var qaText = qaData.candidates && qaData.candidates[0] && qaData.candidates[0].content && qaData.candidates[0].content.parts && qaData.candidates[0].content.parts[0] && qaData.candidates[0].content.parts[0].text || "";
            qaPass = qaText.toUpperCase().includes("PASS") && !qaText.toUpperCase().startsWith("FAIL");
            qaReason = qaText.substring(0, 200);
            if (!qaPass) {
              var pmQA = await askPM("Canvas " + ci + " failed QA: " + qaReason + ". Should I retry with a different template or skip this canvas?", "Quote: " + cv.quote.substring(0, 100));
              addLog("step5", "pm", "PM on failed canvas: " + pmQA.substring(0, 100), "warn");
            }
          }
        }
      } catch (e) {
        qaReason = "Vision QA error: " + e.message;
      }
    }
    if (qaPass) {
      approvedCanvases.push(cv);
      addLog("step5", "gemma4-vision", "Canvas " + ci + ": APPROVED -- " + qaReason.substring(0, 80), "ok");
    } else {
      addLog("step5", "gemma4-vision", "Canvas " + ci + ": REJECTED -- " + qaReason.substring(0, 80), "warn");
    }
  }
  results.approvedCanvases = approvedCanvases;
  addLog("step6", "social-queue", "Queuing assets across all platforms", "running");
  var queued = [];
  var suffix = "\n\nhello@identitypartners.uk | identitypartners.uk\n#IdentityPartners #MentalHealth #Recovery #" + config.topic.replace(/\s+/g, "");
  var scheduleBase = config.scheduleFrom ? new Date(config.scheduleFrom).getTime() : Date.now() + 36e5;
  var scheduleInterval = (config.spreadDays || 7) * 864e5 / Math.max(1, (socialAssets.bluesky_posts || []).length + approvedCanvases.length);
  var scheduleIdx = 0;
  var bskyPosts = socialAssets.bluesky_posts || [];
  for (var bi = 0; bi < bskyPosts.length; bi++) {
    var bskyText = (bskyPosts[bi] + " identitypartners.uk").substring(0, 300);
    var qKey = "queue:agent-" + Date.now() + "-bsky-" + bi;
    var scheduledAt = new Date(scheduleBase + scheduleIdx * scheduleInterval).toISOString();
    if (env.PRISM_KV) await env.PRISM_KV.put(qKey, JSON.stringify({ id: qKey, platform: "bluesky", content: bskyText, type: "Research Post (" + config.topic + ")", status: "pending", source: "agentic-pipeline", scheduledAt, created: (/* @__PURE__ */ new Date()).toISOString() }));
    queued.push({ platform: "bluesky", scheduledAt });
    scheduleIdx++;
  }
  for (var ai = 0; ai < approvedCanvases.length; ai++) {
    var cv2 = approvedCanvases[ai];
    var igCaption = (cv2.quote + suffix).substring(0, 2200);
    var scheduledAt2 = new Date(scheduleBase + scheduleIdx * scheduleInterval).toISOString();
    var qKey2 = "queue:agent-" + Date.now() + "-ig-" + ai;
    if (env.PRISM_KV) await env.PRISM_KV.put(qKey2, JSON.stringify({ id: qKey2, platform: "instagram", content: igCaption, imageUrl: cv2.url, type: "Canvas Post (" + config.topic + ")", status: "pending", source: "agentic-pipeline", scheduledAt: scheduledAt2, created: (/* @__PURE__ */ new Date()).toISOString() }));
    queued.push({ platform: "instagram", imageUrl: cv2.url, scheduledAt: scheduledAt2 });
    scheduleIdx++;
    var qKey3 = "queue:agent-" + Date.now() + "-fb-" + ai;
    var scheduledAt3 = new Date(scheduleBase + (scheduleIdx + 1) * scheduleInterval).toISOString();
    if (env.PRISM_KV) await env.PRISM_KV.put(qKey3, JSON.stringify({ id: qKey3, platform: "facebook", content: igCaption, imageUrl: cv2.url, type: "Canvas Post (" + config.topic + ")", status: "pending", source: "agentic-pipeline", scheduledAt: scheduledAt3, created: (/* @__PURE__ */ new Date()).toISOString() }));
    queued.push({ platform: "facebook", imageUrl: cv2.url, scheduledAt: scheduledAt3 });
    scheduleIdx++;
  }
  if (socialAssets.linkedin_post) {
    var liText = (socialAssets.linkedin_post + "\n\nhello@identitypartners.uk | identitypartners.uk\n#IdentityPartners #MentalHealth").substring(0, 3e3);
    var qKeyLI = "queue:agent-" + Date.now() + "-li";
    var scheduledAtLI = new Date(scheduleBase + scheduleIdx * scheduleInterval).toISOString();
    if (env.PRISM_KV) await env.PRISM_KV.put(qKeyLI, JSON.stringify({ id: qKeyLI, platform: "linkedin", content: liText, type: "LinkedIn Post (" + config.topic + ")", status: "pending", source: "agentic-pipeline", scheduledAt: scheduledAtLI, created: (/* @__PURE__ */ new Date()).toISOString() }));
    queued.push({ platform: "linkedin", scheduledAt: scheduledAtLI });
  }
  addLog("step6", "social-queue", "Queued " + queued.length + " items across " + [...new Set(queued.map(function(q) {
    return q.platform;
  }))].join(", "), "ok");
  results.queued = queued;
  addLog("step7", "pm", "Final pipeline review", "running");
  var pmSummary = await askPM(
    "Pipeline complete. Review the results and flag any issues.",
    "Topic: " + config.topic + ". Findings: " + allFindings.length + ". Canvases approved: " + approvedCanvases.length + "/" + canvasUrls.length + ". Items queued: " + queued.length + ". Log: " + log.filter(function(l) {
      return l.status === "error" || l.status === "warn";
    }).map(function(l) {
      return l.step + ": " + l.msg;
    }).join("; ")
  );
  results.pmReview = pmSummary;
  addLog("step7", "pm", pmSummary.substring(0, 200), "ok");
  var tgToken = env.TELEGRAM_TOKEN || env.telegram_bot_token;
  var tgChat = env.TELEGRAM_CHAT || env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    var errors = log.filter(function(l) {
      return l.status === "error";
    }).length;
    var summary = " Agentic Pipeline Complete\n\nTopic: " + config.topic + "\n\n Findings: " + allFindings.length + "\n Canvases: " + approvedCanvases.length + " approved\n Queued: " + queued.length + " posts\n" + (errors > 0 ? " Errors: " + errors + "\n" : "") + "\nPM: " + pmSummary.substring(0, 200);
    await fetch("https://api.telegram.org/bot" + tgToken + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgChat, text: summary }) });
  }
  return {
    success: true,
    topic: config.topic,
    steps: log.length,
    findings: allFindings.length,
    canvasesApproved: approvedCanvases.length,
    queued: queued.length,
    spreadDays: config.spreadDays || 7,
    pmReview: pmSummary,
    log,
    durationMs: Date.now() - startTime
  };
}
__name(runAgenticPipeline, "runAgenticPipeline");
async function generateCanvasHtml(text, template, env) {
  // ── Template library (12 named templates) ──────────────────────────────────
  // Each template defines: overlay, text colour, accent, wordmark colours,
  // and a Pexels search query matched to the mood.
  // Logo wordmark colours are chosen for contrast against the overlay.
  var TEMPLATES = {
    "quote-teal":      { overlay: "rgba(15,59,58,0.72)",   text: "#f7f3e9", accent: "#ddd0c8", identity: "#7ecfcd", partners: "#d4899a", query: "landscape+vista+nature+green" },
    "quote-rose":      { overlay: "rgba(92,45,63,0.72)",   text: "#f7f3e9", accent: "#ddd0c8", identity: "#7ecfcd", partners: "#f0b8c8", query: "sunset+landscape+warm+golden" },
    "quote-ivory":     { overlay: "rgba(247,243,233,0.88)", text: "#0f3b3a", accent: "#5c2d3f", identity: "#0f3b3a", partners: "#5c2d3f", query: "misty+morning+landscape+soft" },
    "quote-dark":      { overlay: "rgba(10,10,10,0.80)",   text: "#f7f3e9", accent: "#ddd0c8", identity: "#7ecfcd", partners: "#d4899a", query: "night+landscape+stars+dark" },
    "quote-slate":     { overlay: "rgba(30,41,59,0.75)",   text: "#f1f5f9", accent: "#94a3b8", identity: "#7dd3fc", partners: "#f9a8d4", query: "ocean+sea+horizon+blue" },
    "quote-forest":    { overlay: "rgba(20,50,30,0.74)",   text: "#f0fdf4", accent: "#bbf7d0", identity: "#86efac", partners: "#fde68a", query: "forest+trees+nature+green" },
    "quote-dusk":      { overlay: "rgba(60,20,80,0.74)",   text: "#fdf4ff", accent: "#e9d5ff", identity: "#d8b4fe", partners: "#fda4af", query: "dusk+purple+sky+twilight" },
    "quote-stone":     { overlay: "rgba(68,64,60,0.76)",   text: "#fafaf9", accent: "#d6d3d1", identity: "#e7e5e4", partners: "#fca5a5", query: "stone+architecture+heritage+building" },
    "quote-dawn":      { overlay: "rgba(120,53,15,0.68)",  text: "#fff7ed", accent: "#fed7aa", identity: "#fdba74", partners: "#fde68a", query: "dawn+sunrise+golden+morning" },
    "quote-coastal":   { overlay: "rgba(8,47,73,0.74)",    text: "#f0f9ff", accent: "#bae6fd", identity: "#7dd3fc", partners: "#fde68a", query: "coastal+sea+cliffs+water" },
    "quote-parchment": { overlay: "rgba(120,90,40,0.60)",  text: "#1c1917", accent: "#44403c", identity: "#0f3b3a", partners: "#5c2d3f", query: "autumn+leaves+warm+countryside" },
    "quote-midnight":  { overlay: "rgba(2,6,23,0.85)",     text: "#e2e8f0", accent: "#475569", identity: "#38bdf8", partners: "#f472b6", query: "city+night+lights+urban" }
  };

  // Pick template — random if not specified or unknown
  var tmplKeys = Object.keys(TEMPLATES);
  var t = TEMPLATES[template] || TEMPLATES[tmplKeys[Math.floor(Math.random() * tmplKeys.length)]];

  // ── Fetch Pexels background server-side ────────────────────────────────────
  var bgDataUri = "";
  try {
    var pexelsKey = env.pexels_api_key || env.PEXELS_API_KEY || env.pexels || "";
    if (pexelsKey) {
      // Use template-specific query for mood-matched backgrounds
      var query = t.query || "landscape+vista+nature";
      var pexelsResp = await fetch(
        "https://api.pexels.com/v1/search?query=" + query + "&per_page=15&orientation=landscape",
        { headers: { "Authorization": pexelsKey } }
      );
      if (pexelsResp.ok) {
        var pexelsData = await pexelsResp.json();
        var photos = pexelsData.photos || [];
        // Filter out prohibited subjects (yoga, wellness, boardroom, corporate)
        var prohibited = /yoga|wellness|boardroom|office|corporate|gym|meditation|business.meeting/i;
        photos = photos.filter(function(p) {
          var alt = (p.alt || "").toLowerCase();
          return !prohibited.test(alt);
        });
        if (photos.length > 0) {
          var photo = photos[Math.floor(Math.random() * Math.min(photos.length, 8))];
          var imgUrl = photo.src.large2x || photo.src.large;
          var imgResp = await fetch(imgUrl);
          if (imgResp.ok) {
            var imgBuf = await imgResp.arrayBuffer();
            var imgB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
            var ct = imgResp.headers.get("content-type") || "image/jpeg";
            bgDataUri = "data:" + ct + ";base64," + imgB64;
          }
        }
      }
    }
  } catch(e) { /* gradient fallback below */ }

  // Brand gradient fallback
  if (!bgDataUri) {
    var gradSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0%' stop-color='#0f3b3a'/><stop offset='45%' stop-color='#1a5c5a'/>" +
      "<stop offset='100%' stop-color='#5c2d3f'/></linearGradient></defs>" +
      "<rect width='1080' height='1080' fill='url(#g)'/></svg>";
    bgDataUri = "data:image/svg+xml;base64," + btoa(gradSvg);
  }

  var safeText = (text || "").substring(0, 280)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // IP logo SVG — colours chosen for contrast against overlay
  var logoSvg = "<svg viewBox='0 0 120 120' fill='none' xmlns='http://www.w3.org/2000/svg' style='width:100%;height:100%;'>" +
    "<rect x='5' y='5' width='50' height='50' rx='10' fill='#0f3b3a' opacity='0.95'/>" +
    "<rect x='65' y='5' width='50' height='50' rx='10' fill='#5c2d3f' opacity='0.95'/>" +
    "<rect x='5' y='65' width='50' height='50' rx='10' fill='#5c2d3f' opacity='0.75'/>" +
    "<rect x='65' y='65' width='50' height='50' rx='10' fill='#0f3b3a' opacity='0.75'/>" +
    // White border on logo squares for visibility on any background
    "<rect x='5' y='5' width='50' height='50' rx='10' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='1.5'/>" +
    "<rect x='65' y='5' width='50' height='50' rx='10' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='1.5'/>" +
    "<text x='60' y='68' font-family='Inter,sans-serif' font-size='14' fill='#f7f3e9' text-anchor='middle' font-weight='600'>IP</text>" +
    "</svg>";
  var logoB64 = btoa(logoSvg);

  // Font size: scale down for longer quotes
  var wordCount = (text || "").split(" ").length;
  var fontSize = wordCount > 30 ? "38px" : wordCount > 20 ? "44px" : "50px";

  var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
    "<link href='https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=Inter:wght@400;500;600&display=swap' rel='stylesheet'>" +
    "<style>" +
    "*{margin:0;padding:0;box-sizing:border-box;}" +
    "body{width:1080px;height:1080px;overflow:hidden;background:#0f3b3a;}" +
    ".canvas{width:1080px;height:1080px;position:relative;" +
      "background:#0f3b3a url('" + bgDataUri + "') center/cover no-repeat;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;}" +
    ".overlay{position:absolute;inset:0;background:" + t.overlay + ";}" +
    // White vignette border for logo visibility on any background
    ".vignette{position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(0,0,0,0.4);pointer-events:none;}" +
    ".accent-top{position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(90deg,#0f3b3a 0%,#5c2d3f 100%);}" +
    ".accent-bottom{position:absolute;bottom:0;left:0;right:0;height:8px;background:linear-gradient(90deg,#5c2d3f 0%,#0f3b3a 100%);}" +
    // IP grid — top left — white backdrop for visibility on any bg
    ".grid{position:absolute;top:32px;left:32px;width:88px;height:88px;" +
      "display:grid;grid-template-columns:1fr 1fr;gap:5px;" +
      "filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));}" +
    ".grid div{border-radius:7px;}" +
    // Logo — top right — white backdrop
    ".logo-area{position:absolute;top:28px;right:28px;width:110px;height:110px;" +
      "display:flex;align-items:center;justify-content:center;" +
      "filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));}" +
    ".content{position:relative;z-index:10;text-align:center;padding:0 110px;max-width:1080px;}" +
    ".open-quote{font-size:110px;color:" + t.text + ";opacity:0.15;line-height:0.7;margin-bottom:16px;" +
      "font-family:'Playfair Display',Georgia,serif;text-shadow:0 2px 8px rgba(0,0,0,0.4);}" +
    ".quote{font-size:" + fontSize + ";font-style:italic;color:" + t.text + ";line-height:1.55;font-weight:400;" +
      "font-family:'Playfair Display',Georgia,serif;" +
      "text-shadow:0 2px 16px rgba(0,0,0,0.6),0 1px 4px rgba(0,0,0,0.4);}" +
    ".divider{width:280px;height:2px;background:linear-gradient(90deg,#0f3b3a,#5c2d3f);opacity:0.9;margin:32px auto;}" +
    ".wordmark{font-size:28px;font-weight:600;font-style:normal;letter-spacing:-0.3px;" +
      "font-family:'Playfair Display',Georgia,serif;" +
      "text-shadow:0 1px 6px rgba(0,0,0,0.5);}" +
    ".identity{color:" + t.identity + ";}.partners{color:" + t.partners + ";}" +
    ".tagline{font-size:15px;color:" + t.text + ";opacity:0.85;margin-top:10px;" +
      "font-family:'Inter',sans-serif;letter-spacing:0.3px;" +
      "text-shadow:0 1px 4px rgba(0,0,0,0.4);}" +
    ".footer{position:absolute;bottom:24px;left:0;right:0;text-align:center;" +
      "font-size:15px;color:" + t.text + ";font-family:'Inter',sans-serif;opacity:0.85;" +
      "letter-spacing:0.2px;text-shadow:0 1px 4px rgba(0,0,0,0.4);}" +
    "</style></head><body>" +
    "<div class='canvas'>" +
    "<div class='overlay'></div>" +
    "<div class='vignette'></div>" +
    "<div class='accent-top'></div>" +
    "<div class='accent-bottom'></div>" +
    "<div class='grid'>" +
      "<div style='background:#0f3b3a;'></div>" +
      "<div style='background:#5c2d3f;'></div>" +
      "<div style='background:#5c2d3f;opacity:0.7;'></div>" +
      "<div style='background:#0f3b3a;opacity:0.7;'></div>" +
    "</div>" +
    "<div class='logo-area'><img src='data:image/svg+xml;base64," + logoB64 + "' style='width:100%;height:100%;' alt='IP logo'></div>" +
    "<div class='content'>" +
      "<div class='open-quote'>&ldquo;</div>" +
      "<div class='quote'>" + safeText + "</div>" +
      "<div class='divider'></div>" +
      "<div class='wordmark'><span class='identity'>Identity</span><span class='partners'>Partners</span></div>" +
      "<div class='tagline'>Understand your past &middot; Appreciate the present &middot; Define your future</div>" +
    "</div>" +
    "<div class='footer'>identitypartners.uk &nbsp;&middot;&nbsp; hello@identitypartners.uk</div>" +
    "</div>" +
    "<script>document.fonts.ready.then(function(){document.title='READY';});</script>" +
    "</body></html>";

  return html;
}
__name(generateCanvasHtml, "generateCanvasHtml");
function stripTropes(text) {
  if (!text) return text;
  var patterns = [
    /^(Great|Excellent|Wonderful|Fantastic|Amazing|Perfect|Brilliant)\s+(question|point|idea|observation|thought)[!.]\s*/gi,
    /^You'?re\s+absolutely\s+right[!.]\s*/gi,
    /\bdelve\b/gi,
    /\btapestry\b/gi,
    /^(In conclusion|To summarise|To summarize|In summary)[,:.]\s*/gim,
    /^(Certainly|Absolutely|Of course|Sure)[!,]\s*/gi,
    /I('m| am) (just |only )?an? (AI|language model|AI assistant)[^.]*\./gi
  ];
  var result = text;
  patterns.forEach(function(p) {
    result = result.replace(p, "");
  });
  return result.trim();
}
__name(stripTropes, "stripTropes");
function classifyIntent(message) {
  if (!message) return "chat";
  var m = message.toLowerCase();
  if (/\b(generate|create|draw|illustrate|make)\s+(an?\s+)?(image|picture|photo|illustration)\b/.test(m)) return "image_gen";
  if (/\b(generate|create|compose)\s+(a\s+)?(song|music|audio|track)\b/.test(m)) return "audio_gen";
  if (/\b(search|find|research|look up)\b/.test(m)) return "research";
  if (/\b(write|draft|compose)\s+(a\s+)?(email|letter|report|article|blog|essay)\b/.test(m)) return "drafting";
  if (/\b(code|function|script|program|debug|fix|implement)\b/.test(m)) return "coding";
  if (/\b(reason|analyse|analyze|evaluate|assess)\b/.test(m)) return "reasoning";
  if (/\b(remember|save|store|note|memory)\b/.test(m)) return "memory_action";
  if (/\b(crm|client|contact|session|booking)\b/.test(m)) return "crm_action";
  if (/\b(post|tweet|publish|schedule|social)\b/.test(m)) return "social_post";
  if (/\b(atomise|atomize|refract|repurpose)\b/.test(m)) return "social_post";
  return "chat";
}
__name(classifyIntent, "classifyIntent");
async function callCerebras(env, messages, model) {
  var keys = [
    env.CEREBRAS_PAID_1,
    env.CEREBRAS_PAID_2,
    env.cerebras_api_key,
    env.CEREBRAS_API_KEY,
    env.CEREBRAS_FREE_1,
    env.CEREBRAS_FREE_2,
    env.CEREBRAS_FREE_3,
    env.CEREBRAS_FREE_4,
    env.cerebras_free_1,
    env.cerebras_free_2,
    env.cerebras_free_3,
    env.cerebras_free_4,
    env.CEREBRAS_PAID,
    env.cerebras_paid,
    env.CEREBRAS_PAID2,
    env.cerebras_paid2
  ].filter(Boolean);
  if (!keys.length) throw new Error("No Cerebras keys configured");
  var shuffled = keys.slice().sort(function() {
    return Math.random() - 0.5;
  });
  var lastErr = "";
  for (var ki = 0; ki < shuffled.length; ki++) {
    try {
      var resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + shuffled[ki] },
        body: JSON.stringify({ model: model || "llama-4-scout-17b-16e-instruct", messages, max_tokens: 4096, temperature: 0.7 })
      });
      if (resp.status === 402 || resp.status === 429 || resp.status === 503) {
        lastErr = "HTTP " + resp.status;
        continue;
      }
      var data = await resp.json();
      if (data.error) {
        var ec = data.error.code || data.error.type || "";
        if (ec.indexOf("rate_limit") >= 0 || ec.indexOf("quota") >= 0) {
          lastErr = ec;
          continue;
        }
        throw new Error("Cerebras: " + (data.error.message || JSON.stringify(data.error)));
      }
      if (!data.choices || !data.choices[0]) {
        lastErr = "no choices";
        continue;
      }
      return { content: data.choices[0].message.content, provider: "cerebras", model: model || "llama-4-scout-17b-16e-instruct" };
    } catch (e) {
      if (e.message.indexOf("Cerebras:") === 0) throw e;
      lastErr = e.message;
    }
  }
  throw new Error("Cerebras: all " + shuffled.length + " keys exhausted. Last: " + lastErr);
}
__name(callCerebras, "callCerebras");
async function callGemini(env, messages, model) {
  var keys = [env.GEMINI_API_KEY, env.gemini_api_key, env.gemini_paid_api_key, env.GEMINI_PAID_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4].filter(Boolean);
  if (!keys.length) throw new Error("No Gemini keys");
  var key = keys[Math.floor(Math.random() * keys.length)];
  var mdl = model || "gemini-2.5-flash";
  var contents = messages.filter(function(m) {
    return m.role !== "system";
  }).map(function(m) {
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
  var sysMsg = messages.find(function(m) {
    return m.role === "system";
  });
  var body = { contents };
  if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg.content }] };
  var resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + mdl + ":generateContent?key=" + key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  var data = await resp.json();
  if (!resp.ok) throw new Error("Gemini: " + (data.error && data.error.message || resp.status));
  return data.candidates[0].content.parts[0].text;
}
__name(callGemini, "callGemini");
async function searchExa(env, query) {
  var key = env.EXA_API_KEY || env.exa_api_key;
  if (!key) throw new Error("No Exa key");
  var resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, numResults: 8, useAutoprompt: true, type: "neural", contents: { text: { maxCharacters: 500 } } })
  });
  if (!resp.ok) throw new Error("Exa: " + resp.status);
  var data = await resp.json();
  return (data.results || []).map(function(r) {
    return { title: r.title, url: r.url, content: r.text || r.snippet || "", score: r.score };
  });
}
__name(searchExa, "searchExa");
async function searchSemanticScholar(env, query) {
  var key = env.SEMANTIC_SCHOLAR_API_KEY || env.semantic_scholar_api_key;
  var headers = { "Content-Type": "application/json" };
  if (key) headers["x-api-key"] = key;
  var resp = await fetch("https://api.semanticscholar.org/graph/v1/paper/search?query=" + encodeURIComponent(query) + "&limit=8&fields=title,abstract,url,year,authors,citationCount,openAccessPdf", { headers });
  if (!resp.ok) throw new Error("Semantic Scholar: " + resp.status);
  var data = await resp.json();
  return (data.data || []).map(function(p) {
    return {
      title: p.title,
      url: p.openAccessPdf && p.openAccessPdf.url || "https://www.semanticscholar.org/paper/" + p.paperId,
      content: (p.abstract || "").substring(0, 400),
      year: p.year,
      authors: (p.authors || []).map(function(a) {
        return a.name;
      }).join(", "),
      citations: p.citationCount,
      _type: "academic"
    };
  });
}
__name(searchSemanticScholar, "searchSemanticScholar");
async function searchPubMed(env, query) {
  var key = env.NCBI_API_KEY || env.ncbi_api_key;
  var apiKey = key ? "&api_key=" + key : "";
  var searchResp = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=" + encodeURIComponent(query) + "&retmax=8&retmode=json" + apiKey);
  if (!searchResp.ok) throw new Error("PubMed search: " + searchResp.status);
  var searchData = await searchResp.json();
  var ids = searchData.esearchresult && searchData.esearchresult.idlist || [];
  if (ids.length === 0) return [];
  var summaryResp = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=" + ids.join(",") + "&retmode=json" + apiKey);
  if (!summaryResp.ok) return [];
  var summaryData = await summaryResp.json();
  var result = summaryData.result || {};
  return ids.map(function(id) {
    var item = result[id] || {};
    return {
      title: item.title || "",
      url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/",
      content: (item.source || "") + " " + (item.pubdate || ""),
      authors: (item.authors || []).map(function(a) {
        return a.name;
      }).join(", "),
      year: item.pubdate,
      _type: "academic",
      _source: "pubmed"
    };
  }).filter(function(r) {
    return r.title;
  });
}
__name(searchPubMed, "searchPubMed");
async function searchCrossref(env, query) {
  var resp = await fetch("https://api.crossref.org/works?query=" + encodeURIComponent(query) + "&rows=8&select=title,URL,abstract,author,published,container-title&mailto=hello@identitypartners.uk");
  if (!resp.ok) throw new Error("Crossref: " + resp.status);
  var data = await resp.json();
  return (data.message && data.message.items || []).map(function(item) {
    var authors = (item.author || []).map(function(a) {
      return (a.given || "") + " " + (a.family || "");
    }).join(", ");
    var year = item.published && item.published["date-parts"] && item.published["date-parts"][0] && item.published["date-parts"][0][0];
    return {
      title: item.title && item.title[0] || "",
      url: item.URL || "",
      content: (item.abstract || "").replace(/<[^>]+>/g, "").substring(0, 400),
      authors,
      year,
      journal: item["container-title"] && item["container-title"][0] || "",
      _type: "academic"
    };
  }).filter(function(r) {
    return r.title;
  });
}
__name(searchCrossref, "searchCrossref");
async function searchOpenAlex(env, query) {
  var resp = await fetch("https://api.openalex.org/works?search=" + encodeURIComponent(query) + "&per-page=8&select=title,doi,abstract_inverted_index,authorships,publication_year,primary_location&mailto=hello@identitypartners.uk");
  if (!resp.ok) throw new Error("OpenAlex: " + resp.status);
  var data = await resp.json();
  return (data.results || []).map(function(item) {
    var authors = (item.authorships || []).slice(0, 3).map(function(a) {
      return a.author && a.author.display_name || "";
    }).join(", ");
    var url = item.doi ? "https://doi.org/" + item.doi.replace("https://doi.org/", "") : "";
    return {
      title: item.title || "",
      url,
      content: "",
      authors,
      year: item.publication_year,
      _type: "academic"
    };
  }).filter(function(r) {
    return r.title;
  });
}
__name(searchOpenAlex, "searchOpenAlex");
async function searchCORE(env, query) {
  var resp = await fetch("https://api.core.ac.uk/v3/search/works?q=" + encodeURIComponent(query) + "&limit=8", {
    headers: { "Content-Type": "application/json" }
  });
  if (!resp.ok) throw new Error("CORE: " + resp.status);
  var data = await resp.json();
  return (data.results || []).map(function(item) {
    return {
      title: item.title || "",
      url: item.downloadUrl || item.sourceFulltextUrls && item.sourceFulltextUrls[0] || "https://core.ac.uk/works/" + item.id,
      content: (item.abstract || "").substring(0, 400),
      authors: (item.authors || []).map(function(a) {
        return a.name || "";
      }).join(", "),
      year: item.yearPublished,
      _type: "academic",
      openAccess: true
    };
  }).filter(function(r) {
    return r.title;
  });
}
__name(searchCORE, "searchCORE");
async function searchFirecrawl(env, query) {
  var key = env.FIRECRAWL_API_KEY || env.firecrawl_api_key;
  if (!key) throw new Error("No Firecrawl key");
  var resp = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ query, limit: 5, scrapeOptions: { formats: ["markdown"] } })
  });
  if (!resp.ok) throw new Error("Firecrawl: " + resp.status);
  var data = await resp.json();
  return (data.data || []).map(function(r) {
    return { title: r.metadata && r.metadata.title || r.url, url: r.url, content: (r.markdown || "").substring(0, 400) };
  });
}
__name(searchFirecrawl, "searchFirecrawl");
async function searchPerplexity(env, query) {
  var key = env.PERPLEXITY_API_KEY || env.perplexity;
  if (!key) throw new Error("No Perplexity key");
  var resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model: "llama-3.1-sonar-large-128k-online",
      messages: [{ role: "user", content: "Search for academic and professional information about: " + query + ". Provide 5 specific results with titles, URLs, and summaries. Focus on evidence-based sources." }],
      max_tokens: 2e3,
      return_citations: true,
      return_related_questions: false
    })
  });
  if (!resp.ok) throw new Error("Perplexity: " + resp.status);
  var data = await resp.json();
  var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
  var citations = data.citations || [];
  var results = citations.slice(0, 5).map(function(url, i) {
    return { title: "Source " + (i + 1) + ": " + url, url, content: "", _type: "web", _source: "perplexity" };
  });
  results.unshift({ title: "Perplexity AI Synthesis: " + query, url: "https://perplexity.ai", content, _type: "synthesis", _source: "perplexity" });
  return results;
}
__name(searchPerplexity, "searchPerplexity");
async function searchArXiv(env, query) {
  var resp = await fetch("https://export.arxiv.org/api/query?search_query=all:" + encodeURIComponent(query) + "&max_results=8&sortBy=relevance");
  if (!resp.ok) throw new Error("arXiv: " + resp.status);
  var text = await resp.text();
  var results = [];
  var entries = text.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  entries.forEach(function(entry) {
    var title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    var summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "";
    var id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || "";
    var published = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || "";
    results.push({ title: title.trim(), url: id.trim(), content: summary.trim().substring(0, 400), year: published.substring(0, 4), _type: "preprint" });
  });
  return results;
}
__name(searchArXiv, "searchArXiv");
async function searchEuropePMC(env, query) {
  var resp = await fetch("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=" + encodeURIComponent(query) + "&format=json&pageSize=8&resultType=core");
  if (!resp.ok) throw new Error("Europe PMC: " + resp.status);
  var data = await resp.json();
  return (data.resultList && data.resultList.result || []).map(function(r) {
    return {
      title: r.title || "",
      url: "https://europepmc.org/article/" + r.source + "/" + r.id,
      content: (r.abstractText || "").substring(0, 400),
      authors: r.authorString || "",
      year: r.pubYear,
      _type: "academic"
    };
  });
}
__name(searchEuropePMC, "searchEuropePMC");
async function searchZenodo(env, query) {
  var resp = await fetch("https://zenodo.org/api/records?q=" + encodeURIComponent(query) + "&size=8&sort=mostrecent");
  if (!resp.ok) throw new Error("Zenodo: " + resp.status);
  var data = await resp.json();
  return (data.hits && data.hits.hits || []).map(function(r) {
    return {
      title: r.metadata && r.metadata.title || "",
      url: "https://zenodo.org/record/" + r.id,
      content: (r.metadata && r.metadata.description || "").replace(/<[^>]+>/g, "").substring(0, 400),
      year: r.metadata && r.metadata.publication_date && r.metadata.publication_date.substring(0, 4),
      _type: "data"
    };
  });
}
__name(searchZenodo, "searchZenodo");
async function searchWorldBank(env, query) {
  var resp = await fetch("https://search.worldbank.org/api/v2/wds?qterm=" + encodeURIComponent(query) + "&rows=8&format=json");
  if (!resp.ok) throw new Error("World Bank: " + resp.status);
  var data = await resp.json();
  return (data.documents && Object.values(data.documents) || []).filter(function(d) {
    return d.display_title;
  }).slice(0, 8).map(function(d) {
    return {
      title: d.display_title || "",
      url: d.url || "",
      content: (d.abstract || "").substring(0, 400),
      year: d.docdt && d.docdt.substring(0, 4),
      _type: "data"
    };
  });
}
__name(searchWorldBank, "searchWorldBank");
async function searchONS(env, query) {
  var resp = await fetch("https://api.beta.ons.gov.uk/v1/search?q=" + encodeURIComponent(query) + "&limit=8");
  if (!resp.ok) throw new Error("ONS: " + resp.status);
  var data = await resp.json();
  return (data.items || []).map(function(r) {
    return {
      title: r.description && r.description.title || r.uri || "",
      url: "https://www.ons.gov.uk" + r.uri,
      content: (r.description && r.description.summary || "").substring(0, 400),
      _type: "data",
      _source: "ons"
    };
  });
}
__name(searchONS, "searchONS");
async function searchDataGovUK(env, query) {
  var resp = await fetch("https://data.gov.uk/api/3/action/package_search?q=" + encodeURIComponent(query) + "&rows=8");
  if (!resp.ok) throw new Error("data.gov.uk: " + resp.status);
  var data = await resp.json();
  return (data.result && data.result.results || []).map(function(r) {
    return {
      title: r.title || "",
      url: "https://data.gov.uk/dataset/" + r.name,
      content: (r.notes || "").substring(0, 400),
      _type: "data",
      _source: "data.gov.uk"
    };
  });
}
__name(searchDataGovUK, "searchDataGovUK");
async function searchSSRN(env, query) {
  var key = env.EXA_API_KEY || env.exa_api_key;
  if (!key) throw new Error("No Exa key for SSRN");
  var resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query: query + " site:ssrn.com", numResults: 6, useAutoprompt: false, contents: { text: { maxCharacters: 400 } } })
  });
  if (!resp.ok) throw new Error("SSRN via Exa: " + resp.status);
  var data = await resp.json();
  return (data.results || []).map(function(r) {
    return { title: r.title, url: r.url, content: r.text || "", _type: "preprint", _source: "ssrn" };
  });
}
__name(searchSSRN, "searchSSRN");
async function searchOurWorldInData(env, query) {
  var resp = await fetch("https://ourworldindata.org/search?q=" + encodeURIComponent(query));
  var key = env.EXA_API_KEY || env.exa_api_key;
  if (!key) throw new Error("No Exa key for OWID");
  var exaResp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query: query + " site:ourworldindata.org", numResults: 5, contents: { text: { maxCharacters: 400 } } })
  });
  if (!exaResp.ok) throw new Error("OWID: " + exaResp.status);
  var data = await exaResp.json();
  return (data.results || []).map(function(r) {
    return { title: r.title, url: r.url, content: r.text || "", _type: "data", _source: "ourworldindata" };
  });
}
__name(searchOurWorldInData, "searchOurWorldInData");
async function orchestrate(env, messages, profile, intent, threadId) {
  var log = [];
  var t0 = Date.now();
  messages = (messages || []).filter(function(m) {
    return m && m.role && m.content;
  });
  if (messages.length === 0) return { content: "No valid messages provided.", provider: "none", error: true };
  var kv2 = {};
  try {
    if (env.PRISM_KV) {
      var raw = await env.PRISM_KV.get("__secrets__");
      if (raw) kv2 = JSON.parse(raw);
    }
  } catch (e) {
    log.push("KV load error: " + e.message);
  }
  function k(names) {
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var v = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()];
      if (v && v.length > 6) return v;
      v = kv2[n] || kv2[n.toLowerCase()] || kv2[n.toUpperCase()];
      if (v && v.length > 6) return v;
    }
    return null;
  }
  __name(k, "k");
  var KEYS = {
    // Cerebras — paid key confirmed working with gpt-oss-120b
    cerebras: [
      k(["cerebras_paid","CEREBRAS_PAID"]),
      k(["cerebras_free_1","CEREBRAS_FREE_1"]),
      k(["cerebras_free_2","CEREBRAS_FREE_2"]),
    ].filter(Boolean),
    // Groq — confirmed working: gpt-oss-120b, qwen3.8-27b
    groq: [
      k(["groq_free_1","GROQ_FREE_1"]),
      k(["groq_free_2","GROQ_FREE_2"]),
      k(["groq_free_3","GROQ_FREE_3"])
    ].filter(Boolean),
    // Google AI Studio — free key confirmed working
    google: k(["google_ai_key","GOOGLE_AI_KEY"]),
    // Gemini paid
    gemini_free: k(["gemini_api_key","GEMINI_API_KEY"]),
    gemini_paid: k(["gemini_paid_api_key","GEMINI_PAID_API_KEY"]),
    // DeepSeek — new paid key (works via Worker, CORS blocks browser)
    deepseek: k(["deepseek_paid","DEEPSEEK_PAID"]),
    deepseek_f1: k(["deepseek_free_1","DEEPSEEK_FREE_1"]),
    // Kimi — new paid key
    kimi: k(["kimi_api_key","KIMI_API_KEY"]),
    // Mistral — confirmed working
    mistral: k(["mistral_api_key","MISTRAL_API_KEY"]),
    // Cohere — free + paid, v2 API
    cohere: k(["cohere_api_key","COHERE_API_KEY"]),
    cohere_paid: k(["cohere_paid_key","cohere_F1cbQGH0glbNU3cUb3gwtu0m4Xli4azAn0p8uyw42GtbM0"]),
    // Together
    together: k(["together_api_key","TOGETHER_API_KEY"]),
    // SambaNova
    sambanova: k(["sambanova_api_key","SAMBANOVA_API_KEY"]),
    // Fireworks
    fireworks: k(["fireworks_api_key","FIREWORKS_API_KEY"]),
    // Chutes
    chutes: k(["chutes_api_key","CHUTES_API_KEY"]),
    // AnyAPI
    anyapi: k(["anyapi_key","ANYAPI_KEY"]),
    // NVIDIA NIM — nemotron ultra
    nvidia: k(["nvidia_build_api_key","NVIDIA_BUILD_API_KEY"]),
    nvidia2: k(["nvidia_build_api_key_2"]),
    // xAI
    xai: k(["xai_api_key"]),
    // OpenRouter
    openrouter: k(["openrouter_api_key","OPENROUTER_API_KEY"]),
    // HuggingFace
    huggingface: k(["huggingface_api_key","HUGGINGFACE_API_KEY"]),
    // Pollinations
    pollinations: k(["pollinations_key","pollinations_p4"]),
    // Image/search
    pexels: k(["pexels_api_key","PEXELS_API_KEY"]),
    pixabay: k(["pixabay_api_key"]),
    unsplash: k(["unsplash_api_key"]),
    // ElevenLabs voice
    elevenlabs: k(["elevenlabs_api_key","ELEVENLABS_API_KEY"]),
    // Cartesia voice
    cartesia: k(["cartesia_api_key","CARTESIA_API_KEY"]),
  };
  ;
  var chain = [];
  var log = [];
  var t0 = Date.now();

  // Detect intent
  var lastMsg = "";
  for (var mi = messages.length - 1; mi >= 0; mi--) {
    if (messages[mi].role === "user") { lastMsg = messages[mi].content || ""; break; }
  }
  var msgLen = lastMsg.length;
  var detectedIntent = intent || "chat";
  var isMultimodal = profile === "multimodal";
  var isLongContext = msgLen > 50000 || profile === "frontier";
  var isReasoning = profile === "reasoning" || /\b(reason through|analyse in depth|evaluate critically|compare and contrast|formal logic|proof|deduce)\b/i.test(lastMsg);

  var GKEY = KEYS.google || "";

  if (isMultimodal) {
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.1-flash-image", ctx: 65536, out: 65536, cost: 0, note: "Gemini 3.1 Flash Image -- vision" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-2.5-flash-image", ctx: 32768, out: 32768, cost: 0, note: "Gemini 2.5 Flash Image -- vision" });
  }

  if (isReasoning) {
    // Best reasoning: Nemotron > Gemini 3.9 > DeepSeek V4 Flash > Mistral Large
    if (KEYS.nvidia) chain.push({ p: "nvidia", key: KEYS.nvidia, m: "nvidia/llama-3.1-nemotron-ultra-253b-v1", ctx: 128000, out: 4096, cost: 0, note: "Nemotron Ultra 253B -- best reasoning" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.9-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.9 Flash -- reasoning" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.1-pro-preview", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.1 Pro -- reasoning" });
    if (KEYS.deepseek) chain.push({ p: "deepseek", key: KEYS.deepseek, m: "deepseek-chat", ctx: 1000000, out: 8192, cost: 0.14, note: "DeepSeek V4 Flash -- 1M ctx reasoning" });
    if (KEYS.openrouter) chain.push({ p: "openrouter", key: KEYS.openrouter, m: "deepseek/deepseek-chat", ctx: 1000000, out: 8192, cost: 0, note: "DeepSeek V4 via OpenRouter" });
    if (KEYS.mistral) chain.push({ p: "mistral", key: KEYS.mistral, m: "mistral-large-latest", ctx: 128000, out: 8192, cost: 2, note: "Mistral Large -- reasoning" });
  } else if (isLongContext) {
    // Long context: DeepSeek 1M > Gemini 1M
    if (KEYS.deepseek) chain.push({ p: "deepseek", key: KEYS.deepseek, m: "deepseek-chat", ctx: 1000000, out: 8192, cost: 0.14, note: "DeepSeek V4 Flash -- 1M ctx" });
    if (KEYS.openrouter) chain.push({ p: "openrouter", key: KEYS.openrouter, m: "deepseek/deepseek-chat", ctx: 1000000, out: 8192, cost: 0, note: "DeepSeek via OpenRouter -- 1M ctx" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.8-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.8 Flash -- 1M ctx" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.5-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.5 Flash -- 1M ctx" });
    if (KEYS.kimi) chain.push({ p: "kimi", key: KEYS.kimi, m: "moonshot-v1-128k", ctx: 128000, out: 4096, cost: 0.12, note: "Kimi 128K" });
  } else {
    // ── BALANCED DEFAULT CHAIN ──────────────────────────────────────────────
    // Priority: Quality > Speed > Cost
    // Gemini 3.9 first (newest, biggest context, free)
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.9-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.9 Flash -- newest, 1M ctx, free" });

    // DeepSeek V4 Flash (1M context, excellent quality)
    if (KEYS.deepseek) chain.push({ p: "deepseek", key: KEYS.deepseek, m: "deepseek-chat", ctx: 1000000, out: 8192, cost: 0.14, note: "DeepSeek V4 Flash -- 1M ctx" });
    if (KEYS.openrouter) chain.push({ p: "openrouter", key: KEYS.openrouter, m: "deepseek/deepseek-chat", ctx: 1000000, out: 8192, cost: 0, note: "DeepSeek V4 via OpenRouter -- free" });

    // NVIDIA Nemotron Ultra (free, excellent)
    if (KEYS.nvidia) chain.push({ p: "nvidia", key: KEYS.nvidia, m: "nvidia/llama-3.1-nemotron-ultra-253b-v1", ctx: 128000, out: 4096, cost: 0, note: "Nemotron Ultra 253B -- free, excellent" });

    // Gemma 4 (free, good quality)
    chain.push({ p: "gemini", key: GKEY, m: "gemma-4-31b-it", ctx: 262144, out: 32768, cost: 0, note: "Gemma 4 31B -- free" });
    chain.push({ p: "gemini", key: GKEY, m: "gemma-4-26b-a4b-it", ctx: 262144, out: 32768, cost: 0, note: "Gemma 4 26B -- free" });

    // More Gemini (free, 1M context)
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.8-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.8 Flash -- free, 1M ctx" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.5-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.5 Flash -- free, 1M ctx" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-flash-latest", ctx: 1048576, out: 65536, cost: 0, note: "Gemini Flash latest -- free" });

    // Mistral Large (confirmed working, high quality)
    if (KEYS.mistral) chain.push({ p: "mistral", key: KEYS.mistral, m: "mistral-large-latest", ctx: 128000, out: 8192, cost: 2, note: "Mistral Large -- confirmed working" });

    // Cerebras (confirmed working with paid key)
    if (KEYS.cerebras && KEYS.cerebras.length > 0) {
      chain.push({ p: "cerebras", key: KEYS.cerebras[0], m: "gpt-oss-120b", ctx: 8192, out: 8192, cost: 0, note: "GPT-OSS 120B on Cerebras -- confirmed working" });
    }

    // Groq (confirmed working)
    if (KEYS.groq && KEYS.groq.length > 0) {
      chain.push({ p: "groq", key: KEYS.groq[0], m: "openai/gpt-oss-120b", ctx: 8192, out: 8192, cost: 0, note: "GPT-OSS 120B on Groq -- confirmed working" });
      chain.push({ p: "groq", key: KEYS.groq[0], m: "qwen/qwen3.8-27b", ctx: 8192, out: 8192, cost: 0, note: "Qwen3 on Groq -- confirmed working" });
    }

    // Cohere (v2 API, confirmed working)
    if (KEYS.cohere_paid) chain.push({ p: "cohere", key: KEYS.cohere_paid, m: "command-a-03-2025", ctx: 256000, out: 8192, cost: 2.5, note: "Cohere Command A -- paid" });
    if (KEYS.cohere) chain.push({ p: "cohere", key: KEYS.cohere, m: "command-r-plus-08-2024", ctx: 128000, out: 4096, cost: 3, note: "Cohere R+ -- confirmed working" });

    // Kimi (new key)
    if (KEYS.kimi) chain.push({ p: "kimi", key: KEYS.kimi, m: "moonshot-v1-32k", ctx: 32000, out: 4096, cost: 0.12, note: "Kimi 32K" });

    // Mistral Small (fast)
    if (KEYS.mistral) chain.push({ p: "mistral", key: KEYS.mistral, m: "mistral-small-latest", ctx: 32000, out: 8192, cost: 0.2, note: "Mistral Small -- fast" });

    // Together, Fireworks, Chutes
    if (KEYS.together) chain.push({ p: "together", key: KEYS.together, m: "meta-llama/Llama-3.3-70B-Instruct-Turbo", ctx: 131072, out: 8192, cost: 0.18, note: "Together Llama 70B" });
    if (KEYS.fireworks) chain.push({ p: "fireworks", key: KEYS.fireworks, m: "accounts/fireworks/models/llama-v3p3-70b-instruct", ctx: 131072, out: 8192, cost: 0.2, note: "Fireworks Llama 70B" });
    if (KEYS.chutes) chain.push({ p: "chutes", key: KEYS.chutes, m: "deepseek-ai/DeepSeek-V3-0324", ctx: 64000, out: 8192, cost: 0, note: "Chutes DeepSeek free" });

    // More Gemini
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.7-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.7 Flash" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-3.6-flash", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 3.6 Flash" });
    chain.push({ p: "gemini", key: GKEY, m: "gemini-2.5-flash-lite", ctx: 1048576, out: 65536, cost: 0, note: "Gemini 2.5 Flash Lite" });
  }

  // Unconditional fallback
  chain.push({ p: "pollinations", key: null, m: "openai", note: "Pollinations -- unconditional fallback" });
  chain.push({ p: "pollinations", key: null, m: "mistral", note: "Pollinations Mistral" });

for (var ci = 0; ci < chain.length; ci++) {
    var entry = chain[ci];
    var ta = Date.now();
    try {
      var result = await Promise.race([
        callProvider(env, entry.p, entry.key, entry.m, messages),
        new Promise(function(_, rej) {
          setTimeout(function() {
            rej(new Error("timeout 25s"));
          }, 25e3);
        })
      ]);
      if (result && result.content) {
        var stripped = stripTropes(result.content);
        if (!stripped || stripped.length < 2) {
          log.push(entry.p + "/" + entry.m + ": content was only roleplay/tropes, skipping");
          continue;
        }
        result.content = stripped;
        result.provider = entry.p;
        result.model = entry.m;
        result.routingLog = log.concat([entry.p + "/" + entry.m + ": OK (" + (Date.now() - ta) + "ms)"]);
        if (env.PRISM_KV) {
          env.PRISM_KV.put("routing:last", JSON.stringify({
            ts: (/* @__PURE__ */ new Date()).toISOString(),
            winner: entry.p + "/" + entry.m,
            log: result.routingLog,
            totalMs: Date.now() - t0
          }), { expirationTtl: 3600 }).catch(function() {
          });
        }
        return result;
      }
      log.push(entry.p + "/" + entry.m + ": empty (" + (Date.now() - ta) + "ms)");
    } catch (e) {
      var ms = Date.now() - ta;
      var err = e.message || "unknown";
      var reason = err.includes("429") ? "rate-limited" : err.includes("402") ? "quota" : err.includes("401") ? "auth-error" : err.includes("404") ? "model-not-found" : err.includes("timeout") ? "timeout" : err.includes("403") ? "forbidden" : err.substring(0, 30);
      log.push(entry.p + "/" + entry.m + ": " + reason + " (" + ms + "ms)");
    }
    if (Date.now() - t0 > 55e3) {
      log.push("CPU limit approaching -- stopping chain");
      break;
    }
  }
  if (env.PRISM_KV) {
    env.PRISM_KV.put("routing:last-failure", JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      log,
      totalMs: Date.now() - t0
    }), { expirationTtl: 86400 }).catch(function() {
    });
  }
  return {
    content: "All providers unavailable (30s). Log: " + log.slice(-5).join(" | "),
    provider: "none",
    error: true,
    routingLog: log
  };
}
__name(orchestrate, "orchestrate");
async function callProvider(env, provider, key, model, messages) {
  var systemMsg = messages.find(function(m) {
    return m.role === "system";
  });
  var userMsgs = messages.filter(function(m) {
    return m.role !== "system";
  });
  var system = systemMsg ? systemMsg.content : "";
  if (provider === "cerebras") {
    var r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Cerebras " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (content === null || content === void 0) throw new Error("No content from Cerebras: " + JSON.stringify(d).substring(0, 100));
    return { content: content || "" };
  }
  if (provider === "groq") {
    var r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Groq " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from Groq");
    return { content };
  }
  if (provider === "nvidia") {
    var r = await fetch("https://api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7, stream: false })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("NVIDIA " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from NVIDIA");
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { content };
  }
  if (provider === "deepseek") {
    var r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("DeepSeek " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from DeepSeek");
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { content };
  }
  if (provider === "kimi") {
    try {
      var kimiR = await fetch("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
      });
      if (kimiR.ok) {
        var kimiD = await kimiR.json();
        var kimiContent = kimiD.choices && kimiD.choices[0] && kimiD.choices[0].message && kimiD.choices[0].message.content;
        if (kimiContent) return { content: kimiContent };
      }
      var kimiStatus = kimiR.status;
      if (kimiStatus !== 403 && kimiStatus !== 0) {
        var kimiErr = await kimiR.text();
        throw new Error("Kimi " + kimiStatus + ": " + kimiErr.substring(0, 100));
      }
    } catch (kimiDirectErr) {
      if (!kimiDirectErr.message.includes("403") && !kimiDirectErr.message.includes("geo") && !kimiDirectErr.message.includes("network")) {
        throw kimiDirectErr;
      }
    }
    var kieKeyForKimi = env["kie_p1"] || typeof kv !== "undefined" && kv["kie_p1"];
    if (kieKeyForKimi) {
      var kieKimiR = await fetch("https://api.kie.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + kieKeyForKimi, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "moonshot-v1-8k", messages, max_tokens: 8192 })
      });
      if (kieKimiR.ok) {
        var kieKimiD = await kieKimiR.json();
        var kieKimiContent = kieKimiD.choices && kieKimiD.choices[0] && kieKimiD.choices[0].message && kieKimiD.choices[0].message.content;
        if (kieKimiContent) return { content: kieKimiContent };
      }
    }
    throw new Error("Kimi unavailable (geo-blocked, KIE.ai fallback also failed)");
  }
  if (provider === "cohere") {
    var cohereMessages = messages.filter(function(m) {
      return m.role !== "system";
    }).map(function(m) {
      return { role: m.role === "user" ? "user" : "assistant", content: m.content };
    });
    var r = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, chat_history: cohereMessages.slice(0, -1), message: cohereMessages[cohereMessages.length - 1].message, preamble: system, max_tokens: 8192 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Cohere " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.text;
    if (!content) throw new Error("No content from Cohere");
    return { content };
  }
  if (provider === "mistral") {
    var r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Mistral " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from Mistral");
    return { content };
  }
  if (provider === "together" || provider === "sambanova" || provider === "fireworks" || provider === "anyapi") {
    var baseUrls = {
      together: "https://api.together.xyz/v1/chat/completions",
      sambanova: "https://api.sambanova.ai/v1/chat/completions",
      fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
      anyapi: "https://api.anyapi.io/v1/chat/completions"
    };
    var r = await fetch(baseUrls[provider], {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error(provider + " " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from " + provider);
    return { content };
  }
  if (provider === "chutes") {
    var r = await fetch("https://llm.chutes.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7, stream: false })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Chutes " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from Chutes");
    return { content };
  }
  if (provider === "gemini") {
    var geminiMessages = messages.filter(function(m) {
      return m.role !== "system";
    }).map(function(m) {
      var content2 = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return { role: m.role === "user" ? "user" : "model", parts: [{ text: content2 }] };
    });
    var geminiBody = { contents: geminiMessages, generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } };
    if (system) geminiBody.systemInstruction = { parts: [{ text: system }] };
    var isAIStudioKey = key && key.startsWith("AQ.");
    var geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent" + (isAIStudioKey ? "" : "?key=" + key);
    var geminiHeaders = { "Content-Type": "application/json" };
    if (isAIStudioKey) geminiHeaders["x-goog-api-key"] = key;
    var r = await fetch(geminiUrl, { method: "POST", headers: geminiHeaders, body: JSON.stringify(geminiBody) });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Gemini " + r.status + ": " + e.substring(0, 150));
    }
    var d = await r.json();
    var content = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0] && d.candidates[0].content.parts[0].text;
    if (!content) throw new Error("No content from Gemini: " + JSON.stringify(d).substring(0, 100));
    return { content };
  }
  if (provider === "openrouter") {
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://prism.identitypartners.uk", "X-Title": "Argentica" },
      body: JSON.stringify({ model, messages, max_tokens: 8192 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("OpenRouter " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from OpenRouter");
    return { content };
  }
  if (provider === "kie") {
    var kieModel = model || "gemini-2.5-flash";
    var kieR = await fetch("https://api.kie.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: kieModel, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!kieR.ok) {
      var kieErr = await kieR.text();
      throw new Error("KIE.ai " + kieR.status + ": " + kieErr.substring(0, 100));
    }
    var kieD = await kieR.json();
    var kieContent = kieD.choices && kieD.choices[0] && kieD.choices[0].message && kieD.choices[0].message.content;
    if (!kieContent) throw new Error("No content from KIE.ai");
    return { content: kieContent };
  }
  if (provider === "pollinations") {
    var pollinationsMessages = messages.map(function(m) {
      return { role: m.role, content: m.content };
    });
    var r = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: pollinationsMessages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("Pollinations " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from Pollinations");
    return { content };
  }
  if (provider === "kie") {
    var r = await fetch("https://api.kie.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.7 })
    });
    if (!r.ok) {
      var e = await r.text();
      throw new Error("kie.ai " + r.status + ": " + e.substring(0, 100));
    }
    var d = await r.json();
    var content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!content) throw new Error("No content from kie.ai");
    return { content };
  }
  throw new Error("Unknown provider: " + provider);
}
__name(callProvider, "callProvider");
async function getMemories(env) {
  if (!env.PRISM_KV) return [];
  try {
    var list = await env.PRISM_KV.list({ prefix: "memory:" });
    var memories = [];
    for (var i = 0; i < Math.min(list.keys.length, 10); i++) {
      var val = await env.PRISM_KV.get(list.keys[i].name);
      if (val) memories.push(JSON.parse(val));
    }
    return memories;
  } catch (e) {
    return [];
  }
}
__name(getMemories, "getMemories");
async function saveMemory(env, content, tags) {
  if (!env.PRISM_KV) return null;
  var id = "memory:" + Date.now();
  await env.PRISM_KV.put(id, JSON.stringify({ id, content, tags: tags || [], created: (/* @__PURE__ */ new Date()).toISOString() }));
  return id;
}
__name(saveMemory, "saveMemory");
async function getThread(env, threadId) {
  if (!env.PRISM_KV) return null;
  var val = await env.PRISM_KV.get("thread:" + threadId);
  return val ? JSON.parse(val) : null;
}
__name(getThread, "getThread");
async function listThreads(env) {
  if (!env.PRISM_KV) return [];
  try {
    var list = await env.PRISM_KV.list({ prefix: "thread:" });
    var threads = [];
    for (var i = 0; i < Math.min(list.keys.length, 50); i++) {
      var val = await env.PRISM_KV.get(list.keys[i].name);
      if (val) {
        var t = JSON.parse(val);
        threads.push({ id: t.id, title: t.title, messageCount: (t.messages || []).length, updated: t.updated });
      }
    }
    return threads.sort(function(a, b) {
      return new Date(b.updated) - new Date(a.updated);
    });
  } catch (e) {
    return [];
  }
}
__name(listThreads, "listThreads");
async function generateImage(env, prompt, modelName) {
  var _falKey = env.FAL_API_KEY || env.fal_api_key;
  if (_falKey) {
    try {
      var falKey = env.FAL_API_KEY || env.fal_api_key;
      var resp = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Key " + falKey },
        body: JSON.stringify({ prompt, image_size: "landscape_4_3", num_images: 1 })
      });
      if (resp.ok) {
        var data = await resp.json();
        if (data.images && data.images[0]) return { url: data.images[0].url, provider: "fal" };
      }
    } catch (e) {
    }
  }
  var encoded = encodeURIComponent(prompt);
  return { url: "https://image.pollinations.ai/prompt/" + encoded + "?width=1024&height=768&nologo=true&model=" + (modelName || "flux"), provider: "pollinations" };
}
__name(generateImage, "generateImage");
async function searchTavily(env, query) {
  var key = env.TAVILY_API_KEY || env.TAVILY_API_KEY_2 || env.tavily_api_key;
  if (!key) return [];
  var resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true })
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return data.results || [];
}
__name(searchTavily, "searchTavily");
async function searchBrave(env, query) {
  var key = env.BRAVE_API_KEY || env.BRAVE_API_KEY_2 || env.brave_api_key;
  if (!key) return [];
  var resp = await fetch("https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=5", {
    headers: { "Accept": "application/json", "X-Subscription-Token": key }
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return data.web && data.web.results ? data.web.results : [];
}
__name(searchBrave, "searchBrave");
async function atomise(env, text, profile, variations) {
  function extractArray(raw) {
    if (!raw) return null;
    var cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    try {
      var p2 = JSON.parse(cleaned);
      if (Array.isArray(p2)) return p2;
    } catch (e) {
    }
    var m = cleaned.match(/\[\s*[\s\S]*?\]/);
    if (m) {
      try {
        var p22 = JSON.parse(m[0]);
        if (Array.isArray(p22)) return p22;
      } catch (e) {
      }
    }
    var m2 = cleaned.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (m2) {
      try {
        var p3 = JSON.parse(m2[0]);
        if (Array.isArray(p3)) return p3;
      } catch (e) {
      }
    }
    var lines = cleaned.split(/\n+/).filter(function(l) {
      return l.trim() && !l.match(/^[\[\]{}]/);
    });
    if (lines.length > 0) return lines.map(function(l) {
      return l.replace(/^\d+\.\s*/, "").replace(/^["']|["']$/g, "").trim();
    }).filter(Boolean);
    return [cleaned];
  }
  __name(extractArray, "extractArray");
  var sys = { role: "system", content: "You are a content strategist for Identity Partners. Write in British English. Professional, warm, evidence-based. No sycophancy. Always include a CTA to www.identitypartners.uk or the booking page at www.identitypartners.uk/contact IMPORTANT: When asked to return JSON arrays, return ONLY the raw JSON array with no markdown formatting, no code blocks, no explanation." };
  var assets = {};
  var p = profile || "balanced";
  var wordCount = text.trim().split(/\s+/).length;
  var isRich = wordCount > 400;
  var isMedium = wordCount > 80;
  var variations = variations || 3;
  var postCount = String(Math.min(20, Math.max(variations, Math.round(wordCount / 50) * variations)));
  var qCount = String(Math.min(10, Math.max(3, Math.round(wordCount / 100))));
  var slideCount = String(Math.min(10, Math.max(3, Math.round(wordCount / 150))));
  var threadCount = String(Math.min(8, Math.max(2, Math.round(wordCount / 100))));
  assets.title = text.split(/[.!?]/)[0].trim().split(" ").slice(0, 6).join(" ") || "Identity Partners";
  function prompt(instruction) {
    return { role: "user", content: instruction + " Source text: " + text.substring(0, 1500) };
  }
  __name(prompt, "prompt");
  await Promise.allSettled([
    orchestrate(env, [sys, prompt("Extract " + qCount + ' powerful standalone quotes, each 15-25 words, suitable for a visual quote card, no hashtags. Return ONLY a raw JSON array of strings like ["post 1","post 2"]. No markdown, no code blocks, no explanation.')], p, "drafting", null).then(function(r) {
      var _equotes = extractArray(r.content);
      assets.quotes = _equotes || [r.content];
    }),
    orchestrate(env, [sys, prompt("Write " + postCount + ' standalone Bluesky posts, each under 280 characters, conversational, no hashtags in body, each works independently. Return ONLY a raw JSON array of strings like ["post 1","post 2"]. No markdown, no code blocks, no explanation.')], p, "drafting", null).then(function(r) {
      var _ebluesky = extractArray(r.content);
      assets.bluesky = _ebluesky || [r.content];
    }),
    orchestrate(env, [sys, prompt("Write " + postCount + ' standalone X/Twitter posts, each strictly under 280 characters, punchy, 1-2 hashtags per post. Return ONLY a raw JSON array of strings like ["post 1","post 2"]. No markdown, no code blocks, no explanation.')], p, "drafting", null).then(function(r) {
      var _etwitter = extractArray(r.content);
      assets.twitter = _etwitter || [r.content];
    }),
    orchestrate(env, [sys, prompt("Write " + threadCount + ' Threads notes, each under 500 characters, casual and authentic, no hashtags. Return ONLY a raw JSON array of strings like ["post 1","post 2"]. No markdown, no code blocks, no explanation.')], p, "drafting", null).then(function(r) {
      var _ethreads = extractArray(r.content);
      assets.threads = _ethreads || [r.content];
    })
  ]);
  await Promise.allSettled([
    orchestrate(env, [sys, prompt("Write a LinkedIn post, 150-200 words, professional, hook in first line, 3-5 hashtags at end, clear CTA.")], p, "drafting", null).then(function(r) {
      assets.linkedin_post = r.content;
    }),
    orchestrate(env, [sys, prompt("Create a " + slideCount + '-slide LinkedIn carousel. Return ONLY a raw JSON array like this: [{"title":"Slide title","body":"Slide body text"},{"title":"Next slide","body":"Body text"}]. No markdown, no code blocks, no explanation. Just the JSON array.')], p, "drafting", null).then(function(r) {
      try {
        var _cc = r.content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        var _cm = _cc.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        assets.linkedin_carousel = JSON.parse(_cm ? _cm[0] : _cc);
        if (!Array.isArray(assets.linkedin_carousel)) throw new Error("not array");
      } catch (e) {
        assets.linkedin_carousel = [{ title: "Key Insight", body: (r.content || "").substring(0, 100) }];
      }
    }),
    // Instagram posts = same as Bluesky (rendered on canvas in frontend)
    // Instagram carousel
    orchestrate(env, [sys, prompt('Create a 5-slide Instagram carousel. Each slide: short punchy title (max 6 words) and body (max 20 words). Warm, visual. Return ONLY a raw JSON array: [{"slide":1,"title":"Hook","body":"Opening"},{"slide":2,"title":"Point 1","body":"Detail"},{"slide":3,"title":"Point 2","body":"Detail"},{"slide":4,"title":"Point 3","body":"Detail"},{"slide":5,"title":"Save this","body":"Follow @identitypartners"}]. No markdown, no code blocks.')], p, "drafting", null).then(function(r) {
      try {
        var _ic = r.content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        var _im = _ic.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        assets.instagram_carousel = JSON.parse(_im ? _im[0] : _ic);
        if (!Array.isArray(assets.instagram_carousel)) throw new Error("not array");
      } catch (e) {
        assets.instagram_carousel = [{ slide: 1, title: "Key Insight", body: (r.content || "").substring(0, 80) }];
      }
    }),
    orchestrate(env, [sys, prompt("Write a Facebook post, 100-150 words, conversational and community-focused, ask a question to encourage comments, include link to www.identitypartners.uk.")], p, "drafting", null).then(function(r) {
      assets.facebook = r.content;
    }),
    // LinkedIn 1/N thread (main post + comment replies)
    orchestrate(env, [sys, prompt('Write a LinkedIn 1/N thread. A main post (under 200 words, professional, strong hook) followed by 4 comment replies that expand on it. Return ONLY this JSON: {"main":"main post text","comments":["comment 1 text","comment 2 text","comment 3 text","comment 4 text"]}. No markdown, no code blocks.')], p, "drafting", null).then(function(r) {
      try {
        var _lc = r.content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        var _lm = _lc.match(/\{[\s\S]*"main"[\s\S]*"comments"[\s\S]*\}/);
        assets.linkedin_thread = JSON.parse(_lm ? _lm[0] : _lc);
      } catch (e) {
        assets.linkedin_thread = { main: (r.content || "").substring(0, 300), comments: [] };
      }
    })
  ]);
  if (isMedium) {
    await Promise.allSettled([
      orchestrate(env, [sys, prompt("Write " + threadCount + ' Substack Notes, each under 300 characters, teaser that makes people want to read more. Return ONLY a raw JSON array of strings like ["post 1","post 2"]. No markdown, no code blocks, no explanation.')], p, "drafting", null).then(function(r) {
        var _esubstack_note = extractArray(r.content);
        assets.substack_note = _esubstack_note || [r.content];
      }),
      orchestrate(env, [sys, prompt("Write a Tumblr post, 200-300 words, creative and thoughtful, include relevant tags at end in format #tag1 #tag2.")], p, "drafting", null).then(function(r) {
        assets.tumblr = r.content;
      }),
      orchestrate(env, [sys, prompt("Write an email newsletter snippet with subject line at top (Subject: ...), 100-150 words, warm tone, CTA at end.")], p, "drafting", null).then(function(r) {
        assets.email = r.content;
      }),
      orchestrate(env, [sys, prompt("Write a Pinterest pin description, 100-150 words, keyword-rich, helpful tone, CTA, end with 5 keywords.")], p, "drafting", null).then(function(r) {
        assets.pinterest = r.content;
      })
    ]);
  }
  if (isRich) {
    await Promise.allSettled([
      orchestrate(env, [sys, prompt("Write a LinkedIn article, 600-800 words, professional and evidence-based, compelling headline, introduction, 3-4 subheadings, conclusion with CTA to www.identitypartners.uk.")], p, "drafting", null).then(function(r) {
        assets.linkedin_article = r.content;
      }),
      orchestrate(env, [sys, prompt("Write a Substack newsletter article, 400-600 words, warm and personal, subject line, personal opening, 2-3 sections, closing reflection, CTA to www.identitypartners.uk/contact")], p, "drafting", null).then(function(r) {
        assets.substack_article = r.content;
      }),
      orchestrate(env, [sys, prompt("Write a Reddit post for r/mentalhealth or r/addiction, 150-250 words, community-first not promotional, share insight or ask a question, suggest a subreddit.")], p, "drafting", null).then(function(r) {
        assets.reddit = r.content;
      }),
      orchestrate(env, [sys, prompt("Write a WhatsApp/Telegram broadcast message, under 200 words, personal and direct, warm tone, include link to www.identitypartners.uk/contact")], p, "drafting", null).then(function(r) {
        assets.broadcast = r.content;
      })
    ]);
  }
  assets.instagram = assets.bluesky;
  assets.postsPerPlatform = parseInt(postCount);
  assets.wordCount = wordCount;
  return assets;
}
__name(atomise, "atomise");
async function postViaBuffer(env, text, platforms) {
  var bufferKey = env.BUFFER_API_KEY || env.buffer_api_key;
  if (!bufferKey) return { results: {}, errors: { error: "BUFFER_API_KEY not set" } };
  var channelMap = {};
  try {
    if (env.BUFFER_CHANNEL_MAP) channelMap = JSON.parse(env.BUFFER_CHANNEL_MAP);
  } catch (e) {
  }
  if (Object.keys(channelMap).length === 0 && env.BUFFER_ORG_ID) {
    try {
      var chQ = JSON.stringify({ query: '{ channels(input:{organizationId:"' + env.BUFFER_ORG_ID + '"}) { id name service } }' });
      var chR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufferKey, "Content-Type": "application/json" }, body: chQ });
      var chD = await chR.json();
      (chD.data && chD.data.channels || []).forEach(function(c) {
        channelMap[c.service.toLowerCase()] = c.id;
      });
    } catch (e) {
    }
  }
  var results = {};
  var errors = {};
  var aliases = { x: "twitter", twitter: "twitter", instagram: "instagram", facebook: "facebook", threads: "threads", linkedin: "linkedin" };
  for (var pi = 0; pi < platforms.length; pi++) {
    var platform = platforms[pi];
    var service = aliases[platform] || platform;
    var channelId = channelMap[service] || channelMap[platform];
    if (!channelId) {
      errors[platform] = platform + " not in Buffer -- add at publish.buffer.com/channels";
      continue;
    }
    var postText = text;
    if (service === "twitter") postText = text.substring(0, 280);
    if (service === "instagram") postText = text.substring(0, 2200);
    var metadataStr = "";
    if (service === "instagram") {
      errors[platform] = "Instagram requires an image. Use Refract canvas previews, download, and post via Buffer.";
      continue;
    }
    if (service === "facebook") {
      metadataStr = ", metadata:{facebook:{type:post}}";
    }
    var assetsStr = "assets:[]";
    var cleanMetaStr = metadataStr;
    if (metadataStr.includes("assets:[{")) {
      var assetMatch = metadataStr.match(/assets:\[\{[^\]]+\}\]/);
      if (assetMatch) {
        assetsStr = assetMatch[0];
        cleanMetaStr = metadataStr.replace(/,\s*assets:\[\{[^\]]+\}\]/, "");
      }
    }
    var mutation = JSON.stringify({
      query: 'mutation{createPost(input:{channelId:"' + channelId + '",text:' + JSON.stringify(postText) + "," + assetsStr + ",mode:shareNow,needsApproval:false,schedulingType:automatic" + cleanMetaStr + "}){...on PostActionSuccess{post{id status}}...on MutationError{message}}}"
    });
    try {
      var postR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufferKey, "Content-Type": "application/json" }, body: mutation });
      var postD = await postR.json();
      var cp = postD.data && postD.data.createPost || {};
      if (cp.post) {
        results[platform] = { success: true, id: cp.post.id, status: cp.post.status, via: "buffer" };
      } else {
        errors[platform] = "Buffer: " + (cp.message || (postD.errors || [{}])[0].message || "unknown");
      }
    } catch (pe) {
      errors[platform] = "Buffer error: " + pe.message;
    }
  }
  return { results, errors };
}
__name(postViaBuffer, "postViaBuffer");
async function postToMastodon(env, text) {
  // Rate limit: max 2 posts per day, minimum 30 minutes between posts (spec item 17)
  if (env.PRISM_KV) {
    var now = Date.now();
    var lastPostStr = await env.PRISM_KV.get("mastodon:last_post_time");
    var dailyCountStr = await env.PRISM_KV.get("mastodon:daily_count:" + new Date().toISOString().slice(0,10));
    var lastPost = lastPostStr ? parseInt(lastPostStr) : 0;
    var dailyCount = dailyCountStr ? parseInt(dailyCountStr) : 0;
    var minGapMs = 30 * 60 * 1000;
    if (now - lastPost < minGapMs) {
      return { success: false, error: "Mastodon rate limit: minimum 30 minutes between posts. Next allowed at " + new Date(lastPost + minGapMs).toISOString() };
    }
    if (dailyCount >= 2) {
      return { success: false, error: "Mastodon rate limit: maximum 2 posts per day reached." };
    }
  }

  var token = env.MASTODON_ACCESS_TOKEN;
  var instance = env.MASTODON_INSTANCE || "https://mastodon.social";
  if (!token) return { error: "MASTODON_ACCESS_TOKEN not set" };
  var postText = text.length > 500 ? text.substring(0, 497) + "..." : text;
  try {
    var r = await fetch(instance + "/api/v1/statuses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ status: postText, visibility: "public" })
    });
    var d = await r.json();
    if (d.id) if (env.PRISM_KV) {
      var nowTs = Date.now();
      await env.PRISM_KV.put("mastodon:last_post_time", nowTs.toString(), { expirationTtl: 86400 });
      var today = new Date().toISOString().slice(0,10);
      var cnt = parseInt(await env.PRISM_KV.get("mastodon:daily_count:" + today) || "0");
      await env.PRISM_KV.put("mastodon:daily_count:" + today, (cnt+1).toString(), { expirationTtl: 86400 });
    }
    return { success: true, id: d.id, url: d.url };
    return { error: d.error || JSON.stringify(d).substring(0, 100) };
  } catch (e) {
    return { error: e.message };
  }
}
__name(postToMastodon, "postToMastodon");
async function postToBluesky(env, text, imageUrl) {
  var handle = env.bluesky_handle || env.BLUESKY_HANDLE || "identitypartners.bsky.social";
  var appPassword = env.bluesky_app_password || env.BLUESKY_APP_PASSWORD;
  if (!appPassword) throw new Error("No Bluesky credentials");
  var loginResp = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword })
  });
  var session = await loginResp.json();
  if (!session.accessJwt) throw new Error("Bluesky login failed: " + JSON.stringify(session));
  var postRecord = {
    "$type": "app.bsky.feed.post",
    text: text.substring(0, 300),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    langs: ["en-GB"]
  };
  if (imageUrl) {
    try {
      var imgResp = await fetch(imageUrl);
      if (imgResp.ok) {
        var imgBuf = await imgResp.arrayBuffer();
        var imgCt = imgResp.headers.get("content-type") || "image/png";
        var blobResp = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
          method: "POST",
          headers: { "Content-Type": imgCt, "Authorization": "Bearer " + session.accessJwt },
          body: imgBuf
        });
        var blobData = await blobResp.json();
        if (blobData.blob) {
          postRecord.embed = {
            "$type": "app.bsky.embed.images",
            images: [{ image: blobData.blob, alt: "Identity Partners" }]
          };
        }
      }
    } catch (imgErr) {
    }
  }
  var postResp = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.accessJwt },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record: postRecord })
  });
  var postData = await postResp.json();
  if (postData.uri) return { success: true, uri: postData.uri, cid: postData.cid };
  throw new Error("Bluesky post failed: " + JSON.stringify(postData));
}
__name(postToBluesky, "postToBluesky");
async function sendTelegram(env, message) {
  var token = env.TELEGRAM_TOKEN;
  var chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" })
  });
}
__name(sendTelegram, "sendTelegram");
function cors(origin) {
  var allowOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Thread-ID, X-Profile",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
__name(cors, "cors");
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors(origin))
  });
}
__name(json, "json");
var DEV_TEAM_PROMPTS = {
  pm: "You are the Programme Manager for Argentica (prism.identitypartners.uk). Worker: prism-api.identitypartners.workers.dev. Repo: IdentityPartners/prism. You coordinate the dev team and own the roadmap. RULES: Never describe actions — execute them. Use the available tools: search_web, post_to_social, generate_canvas, run_research, send_telegram, update_kv. When asked to fix something, call the appropriate tool immediately. When asked to post content, call post_to_social. When asked to research, call run_research. Never say 'I would' — do it. Never hallucinate metrics. British English. Direct, technical, concise.",
  troubleshooter: "You are the Troubleshooter for Argentica. Diagnose and fix issues by calling tools directly. Available tools: check_worker_health, get_kv_value, set_kv_value, push_github_file, run_diagnostic. When you identify a bug, fix it immediately using push_github_file. Do not ask Simon to do anything technical. Common JS rules: var not const/let at top level, no arrow functions in onclick, use document.createElement not innerHTML with mixed quotes. British English.",
  researcher: "You are the Research Agent for Argentica. Find information and synthesise research using search_web and run_research tools. Focus on addiction, trauma, mental health, community wellbeing, social policy. When research is complete, offer to post findings via post_to_social or save to memory via save_memory. British English. Cite sources. Never hallucinate citations.",
  creator: "You are the Creator Agent for Argentica. Create content using generate_canvas, generate_voice, and post_to_social tools. Identity Partners brand: warm, professional, evidence-based, focused on addiction and mental health. When asked to create a post, generate it AND queue it via post_to_social immediately. When asked for a canvas, call generate_canvas. British English.",
  api_champion: "You are the API Champion for Argentica. Monitor the model registry daily using check_provider_models tool. When you find stale model names, fix them immediately using push_github_file. Know all providers: Cerebras, Groq, DeepSeek, Gemini, OpenRouter, SambaNova, NVIDIA NIM, Mistral, Together, Fireworks, Cohere, Kimi, Chutes, Nebius, Zhipu. Never include Ollama in automated routing. Report updates concisely and act on them.",
  media_manager: "You are the Media Manager for Argentica. You own all content publication. Use post_to_social to queue and approve posts. Use generate_canvas to create images. Use check_queue to review pending items. Never describe what you will do — do it immediately using the available tools. Enforce IP brand rules: mandatory hashtags (#IdentityPartners #MentalHealth #Recovery #Addiction #Wellbeing), footer (hello@identitypartners.uk | www.identitypartners.uk/contact). British English."
};

// ── Dev Team tool execution ───────────────────────────────────────────────────
async function executeDevTeamTool(toolName, params, env) {
  try {
    switch(toolName) {
      case 'search_web': {
        var tavilyKey = env.tavily_api_key || env.TAVILY_API_KEY || env.tavily || "";
        if (!tavilyKey) return {error: "Tavily not configured"};
        var r = await fetch("https://api.tavily.com/search", {
          method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+tavilyKey},
          body: JSON.stringify({query: params.query, max_results: 5})
        });
        var d = await r.json();
        return {results: (d.results||[]).map(function(x){return {title:x.title,url:x.url,snippet:x.content};})};
      }
      case 'post_to_social': {
        var qReq = new Request("https://prism-api.identitypartners.workers.dev/api/mm/queue", {
          method: "POST", headers: {"Content-Type":"application/json","Origin":"https://prism.identitypartners.uk"},
          body: JSON.stringify({text: params.text, platforms: params.platforms||["bluesky"], source: "devteam-agent"})
        });
        var qResp = await fetch(qReq);
        return await qResp.json();
      }
      case 'generate_canvas': {
        var cReq = new Request("https://prism-api.identitypartners.workers.dev/api/canvas/render", {
          method: "POST", headers: {"Content-Type":"application/json","Origin":"https://prism.identitypartners.uk"},
          body: JSON.stringify({text: params.text, template: params.template||"quote-teal"})
        });
        var cResp = await fetch(cReq);
        return await cResp.json();
      }
      case 'check_worker_health': {
        var hResp = await fetch("https://prism-api.identitypartners.workers.dev/health");
        return {status: hResp.status, ok: hResp.ok};
      }
      case 'get_kv_value': {
        if (!env.PRISM_KV) return {error: "KV not available"};
        var val = await env.PRISM_KV.get(params.key);
        return {key: params.key, value: val};
      }
      case 'set_kv_value': {
        if (!env.PRISM_KV) return {error: "KV not available"};
        await env.PRISM_KV.put(params.key, params.value);
        return {success: true, key: params.key};
      }
      case 'send_telegram': {
        var tgTok = env.TELEGRAM_TOKEN || env.telegram_token;
        var tgChat = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
        if (!tgTok || !tgChat) return {error: "Telegram not configured"};
        var tgR = await fetch("https://api.telegram.org/bot"+tgTok+"/sendMessage", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({chat_id: tgChat, text: params.text.substring(0,4096)})
        });
        return await tgR.json();
      }
      case 'run_research': {
        var rReq = new Request("https://prism-api.identitypartners.workers.dev/api/research/search", {
          method: "POST", headers: {"Content-Type":"application/json","Origin":"https://prism.identitypartners.uk"},
          body: JSON.stringify({query: params.query, sources: params.sources||["tavily","brave"]})
        });
        var rResp = await fetch(rReq);
        return await rResp.json();
      }
      case 'check_queue': {
        var mmResp = await fetch("https://prism-api.identitypartners.workers.dev/api/mm/queue", {
          headers: {"Origin":"https://prism.identitypartners.uk"}
        });
        return await mmResp.json();
      }
      default:
        return {error: "Unknown tool: " + toolName};
    }
  } catch(e) {
    return {error: e.message};
  }
}
var index_default = {
  async scheduled(event, env, ctx) {
    var hour = (/* @__PURE__ */ new Date()).getUTCHours();
    var slot = hour >= 7 && hour < 9 ? "morning" : hour >= 12 && hour < 14 ? "lunchtime" : hour >= 19 && hour < 21 ? "evening" : null;
    if (slot) {
      try {
        // Media Manager owns the daily pipeline — routes through /api/mm/run
        var req = new Request("https://prism-api.identitypartners.workers.dev/api/mm/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot }) });
        await this.fetch(req, env, ctx);
      } catch (e) {
      }
    }
    if (hour === 6) {
      try {
        var req2 = new Request("https://prism-api.identitypartners.workers.dev/api/champion/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        await this.fetch(req2, env, ctx);
      } catch (e) {
      }
      try {
        await runWeeklyResearchScrape(env);
      } catch (e) {
      }
    }
    var dayOfWeek = (/* @__PURE__ */ new Date()).getUTCDay();
    if (hour === 6 && dayOfWeek === 1) {
      try {
        var canvasReq = new Request("https://prism-api.identitypartners.workers.dev/api/agents/canvas-regen", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" }, body: "{}" });
        await this.fetch(canvasReq, env, ctx);
      } catch (e) {
      }
    }
  },
  async fetch(request, env, ctx) {
    async function S(name2) {
      if (env[name2]) return env[name2];
      if (env[name2.toUpperCase()]) return env[name2.toUpperCase()];
      if (env.PRISM_KV) {
        try {
          var kv6 = await env.PRISM_KV.get("__secrets__");
          if (kv6) {
            var p = JSON.parse(kv6);
            return p[name2] || p[name2.toUpperCase()] || p[name2.toLowerCase()] || null;
          }
        } catch (e) {
        }
      }
      return null;
    }
    __name(S, "S");
    var url = new URL(request.url);
    var path = url.pathname;
    var origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (path === "/" || path === "/health") {
      return json({ status: "ok", version: "1.0.0", worker: "prism-api", timestamp: (/* @__PURE__ */ new Date()).toISOString() }, 200, origin);
    }
    if (path === "/api/chat" && request.method === "POST") {
      try {
        var body = await request.json();
        var messages = body.messages || [];
        var profile = body.profile || "balanced";
        var threadId = body.threadId || "t" + Date.now();
        var antiRoleplay = " CRITICAL: Never use asterisks for actions or roleplay. No *sighs*, no *leans back*, no *raises eyebrow*. Speak directly. British English. NEVER invent calendar events, emails, social stats, engagement metrics, or any data you cannot verify. If you have no live data access, say so plainly.";
        messages = (messages || []).filter(function(m2) {
          return m2 && m2.role && m2.content;
        });
        var hasSystem = messages.length > 0 && messages[0] && messages[0].role === "system";
        if (hasSystem) {
          if (messages[0].content && !messages[0].content.includes("Never use asterisks")) {
            messages = messages.slice();
            messages[0] = { role: "system", content: messages[0].content + antiRoleplay };
          }
        } else {
          // Load persona from KV if set, otherwise use Orchestrator default
          var personaRaw = env.PRISM_KV ? await env.PRISM_KV.get("persona:active") : null;
          var personaPrompt = personaRaw ? JSON.parse(personaRaw).systemPrompt : null;

          // Load memories about Simon to inject into every conversation
          var aboutMeRaw = env.PRISM_KV ? await env.PRISM_KV.get("memory:about-simon") : null;
          var aboutMeFacts = aboutMeRaw ? JSON.parse(aboutMeRaw) : [];
          var aboutMeContext = aboutMeFacts.length > 0
            ? "\n\nWhat I know about Simon Johnson:\n" + aboutMeFacts.slice(0, 20).map(function(m) { return "- " + m.fact; }).join("\n")
            : "";


          var ragContext = ""; // RAG disabled until rag_index table is created via /api/rag/setup

          var orchestratorPrompt = "You are the Orchestrator for Argentica, the personal AI operating environment of Simon Johnson / Identity Partners. " +
            "You are omnipotent within this system. You know every module, every agent, every tool, and every rule. " +
            "You allocate models and tools appropriately: large documents go to Gemini 2.5 Pro; reasoning tasks go to DeepSeek or Kimi; " +
            "fast chat goes to Cerebras or Groq; creative work goes to Mistral. " +
            "You never hallucinate. You never invent data. You never describe actions — you execute them. " +
            "You are direct, precise, and competent. British English throughout. No sycophancy. No AI tropes. " +
            "When you need to add a memory about Simon, call MEMORY_ADD: [fact] on a new line. " +
            "When you need to use a tool, call TOOL_CALL: tool_name(params) on a new line." +
            aboutMeContext;

          messages = [{ role: "system", content: (personaPrompt || orchestratorPrompt) + antiRoleplay }].concat(messages);
        }
        var lastMsg = messages[messages.length - 1];
        var intent = body.intent || classifyIntent(lastMsg ? lastMsg.content : "");
        var memories = await getMemories(env);
        if (memories.length > 0) {
          var memText = memories.slice(0, 5).map(function(m2) {
            return m2.content;
          }).join("\n");
          var sysIdx = messages.findIndex(function(m2) {
            return m2.role === "system";
          });
          if (sysIdx >= 0) {
            messages[sysIdx] = { role: "system", content: messages[sysIdx].content + "\n\nRelevant memories:\n" + memText };
          } else {
            messages = [{ role: "system", content: "Relevant memories:\n" + memText }].concat(messages);
          }
        }
        var kvRaw = null;
        try {
          kvRaw = await env.PRISM_KV.get("__secrets__");
        } catch (e) {
        }
        var kvSecrets = {};
        if (kvRaw) {
          try {
            kvSecrets = JSON.parse(kvRaw);
          } catch (e) {
          }
        }
        var envPlus = new Proxy(env, {
          get: /* @__PURE__ */ __name(function(target, prop) {
            if (target[prop] !== void 0) return target[prop];
            if (kvSecrets[prop] !== void 0) return kvSecrets[prop];
            if (kvSecrets[prop.toUpperCase()] !== void 0) return kvSecrets[prop.toUpperCase()];
            if (kvSecrets[prop.toLowerCase()] !== void 0) return kvSecrets[prop.toLowerCase()];
            return void 0;
          }, "get")
        });
        if (intent === "research" || intent === "chat") {
          var lastMsg = body.messages[body.messages.length - 1];
          var msgText = lastMsg ? lastMsg.content : "";
          var needsSearch = /\b(search|find|look up|what is|who is|latest|current|recent|news|today)\b/i.test(msgText);
          if (needsSearch && msgText.length > 10) {
            try {
              var sr = await searchTavily(envPlus, msgText.substring(0, 200));
              if (sr && sr.length > 0) {
                var sc = "LIVE SEARCH RESULTS:\n\n" + sr.slice(0, 3).map(function(r2, i2) {
                  return i2 + 1 + ". " + r2.title + "\n" + (r2.content || r2.snippet || "").substring(0, 300);
                }).join("\n\n");
                var si = messages.findIndex(function(m2) {
                  return m2.role === "system";
                });
                if (si >= 0) messages[si] = { role: "system", content: messages[si].content + "\n\n" + sc };
                else messages.unshift({ role: "system", content: sc });
              }
            } catch (e) {
            }
          }
        }
        var images = body.images || [];
        if (images.length > 0) {
          try {
            var visionResult = await callGemini(envPlus, messages, "gemini-2.5-flash", images);
            var result = { content: stripTropes(visionResult), provider: "gemini", model: "gemini-2.0-flash-vision", intent };
          } catch (ve) {
            var result = await orchestrate(envPlus, messages, profile, intent, threadId);
          }
        } else {
          var result = await orchestrate(envPlus, messages, profile, intent, threadId);
        }
        var saveResult = result || {};
        var saveContent = saveResult.content || "";
        if (env.PRISM_KV && threadId) {
          try {
            await env.PRISM_KV.put("debug:last-save", JSON.stringify({
              threadId,
              hasContent: !!saveContent,
              contentLen: saveContent.length,
              ts: (/* @__PURE__ */ new Date()).toISOString()
            }), { expirationTtl: 3600 });
          } catch (dbgErr) {
          }
          try {
            var tKey = "thread:" + threadId;
            var existing = null;
            try {
              var ex = await env.PRISM_KV.get(tKey);
              if (ex) existing = JSON.parse(ex);
            } catch (e2) {
            }
            var msgs = existing ? existing.messages || [] : [];
            var lastUser = messages[messages.length - 1];
            if (lastUser && lastUser.role === "user") {
              msgs.push({ role: "user", content: typeof lastUser.content === "string" ? lastUser.content : "[multimodal]" });
            }
            msgs.push({ role: "assistant", content: saveContent || "[no content]" });
            if (msgs.length > 100) msgs = msgs.slice(-100);
            var tTitle = existing ? existing.title : msgs[0] && msgs[0].content ? msgs[0].content.substring(0, 50) : "Thread";
            var tData = { id: threadId, title: tTitle, messages: msgs, messageCount: msgs.length, updated: (/* @__PURE__ */ new Date()).toISOString(), created: existing ? existing.created : (/* @__PURE__ */ new Date()).toISOString() };
            await env.PRISM_KV.put(tKey, JSON.stringify(tData), { expirationTtl: 86400 * 90 });
            var idxKey = "threads:index";
            var tidx = [];
            try {
              var ti = await env.PRISM_KV.get(idxKey);
              if (ti) tidx = JSON.parse(ti);
            } catch (e3) {
            }
            var existing_entry = tidx.find(function(t2) {
              return t2.id === threadId;
            });
            if (existing_entry) {
              existing_entry.title = tTitle;
              existing_entry.messageCount = msgs.length;
              existing_entry.updated = tData.updated;
            } else {
              tidx.unshift({ id: threadId, title: tTitle, messageCount: msgs.length, updated: tData.updated, created: tData.created });
            }
            if (tidx.length > 200) tidx = tidx.slice(0, 200);
            await env.PRISM_KV.put(idxKey, JSON.stringify(tidx));
          } catch (saveErr) {
          }
          try {
            var d1Msgs = msgs || [];
            var d1HasBinding = !!env.PRISM_D1;
            if (env.PRISM_KV) {
              await env.PRISM_KV.put("debug:d1-binding", JSON.stringify({ has: d1HasBinding, ts: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 3600 });
            }
            if (d1HasBinding) {
              var d1Tags = await saveThreadToD1(env, threadId, tTitle, d1Msgs, "Gerald", profile || "balanced");
              if (env.PRISM_KV) {
                await env.PRISM_KV.put("debug:d1-save", JSON.stringify({ success: true, tags: d1Tags, msgCount: d1Msgs.length, ts: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 3600 });
              }
              if (d1Msgs.length >= 100 && d1Msgs.length % 50 === 0) {
                archiveToNotion(env, threadId, tTitle, d1Msgs, d1Tags || []).catch(function() {
                });
              }
            }
          } catch (d1Err) {
            if (env.PRISM_KV) {
              await env.PRISM_KV.put("debug:d1-error", JSON.stringify({ error: d1Err.message, stack: d1Err.stack ? d1Err.stack.substring(0, 500) : "", ts: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 3600 }).catch(function() {
              });
            }
          }
        }
        // Parse MEMORY_ADD calls from response and strip them from output
        var responseContent = result.content || "";
        var memLines = responseContent.split("\n");
        var cleanLines = [];
        for (var mli = 0; mli < memLines.length; mli++) {
          var line = memLines[mli];
          if (line.trim().startsWith("MEMORY_ADD:")) {
            var fact = line.replace("MEMORY_ADD:", "").trim().substring(0, 500);
            if (fact && env.PRISM_KV) {
              try {
                var amRaw = await env.PRISM_KV.get("memory:about-simon");
                var amFacts = amRaw ? JSON.parse(amRaw) : [];
                var isDup = amFacts.some(function(m) { return m.fact.toLowerCase() === fact.toLowerCase(); });
                if (!isDup) {
                  amFacts.unshift({ fact, category: "auto", source: "orchestrator", addedAt: Date.now() });
                  if (amFacts.length > 200) amFacts = amFacts.slice(0, 200);
                  await env.PRISM_KV.put("memory:about-simon", JSON.stringify(amFacts));
                }
              } catch(memErr) {}
            }
          } else {
            cleanLines.push(line);
          }
        }
        result.content = cleanLines.join("\n").trim();
        return json({ content: result.content, provider: result.provider, model: result.model, intent, threadId }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/threads" && request.method === "GET") {
      try {
        var url_t = new URL(request.url);
        var limitT = parseInt(url_t.searchParams.get("limit") || "200");
        var offsetT = parseInt(url_t.searchParams.get("offset") || "0");
        var tagT = url_t.searchParams.get("tag") || null;
        var d1T = await listThreadsFromD1(env, "simon", limitT, offsetT, tagT);
        if (d1T.length > 0) return json({ threads: d1T, total: d1T.length, source: "d1" }, 200, origin);
        return json({ threads: await listThreads(env) }, 200, origin);
      } catch (e) {
        return json({ threads: await listThreads(env) }, 200, origin);
      }
    }
    if (path === "/api/threads/tags" && request.method === "GET") {
      try {
        if (!env.PRISM_D1) return json({ tags: [] }, 200, origin);
        var result = await env.PRISM_D1.prepare(
          'SELECT auto_tags FROM threads WHERE archived = 0 AND auto_tags != "[]"'
        ).all();
        var tagCounts = {};
        (result.results || []).forEach(function(row2) {
          try {
            JSON.parse(row2.auto_tags || "[]").forEach(function(tag2) {
              tagCounts[tag2] = (tagCounts[tag2] || 0) + 1;
            });
          } catch (e) {
          }
        });
        var tags = Object.keys(tagCounts).map(function(t2) {
          return { tag: t2, count: tagCounts[t2] };
        });
        tags.sort(function(a, b) {
          return b.count - a.count;
        });
        return json({ tags }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/threads/search" && request.method === "GET") {
      try {
        var url3 = new URL(request.url);
        var q = url3.searchParams.get("q") || "";
        var tag = url3.searchParams.get("tag") || "";
        if (!env.PRISM_D1) return json({ threads: [] }, 200, origin);
        var sql = "SELECT id, title, persona, message_count, auto_tags, updated_at FROM threads WHERE archived = 0";
        var params = [];
        if (q) {
          sql += " AND (title LIKE ? OR auto_tags LIKE ?)";
          params.push("%" + q + "%", "%" + q + "%");
        }
        if (tag) {
          sql += " AND auto_tags LIKE ?";
          params.push("%" + tag + "%");
        }
        sql += " ORDER BY updated_at DESC LIMIT 50";
        var result;
        if (params.length === 2) result = await env.PRISM_D1.prepare(sql).bind(params[0], params[1]).all();
        else if (params.length === 3) result = await env.PRISM_D1.prepare(sql).bind(params[0], params[1], params[2]).all();
        else result = await env.PRISM_D1.prepare(sql).bind(params[0], params[1]).all();
        var threads = (result.results || []).map(function(t2) {
          return { id: t2.id, title: t2.title, persona: t2.persona, messageCount: t2.message_count, tags: JSON.parse(t2.auto_tags || "[]"), updated: t2.updated_at };
        });
        return json({ threads, query: q, tag }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/threads/") && request.method === "DELETE") {
      try {
        var delId = path.replace("/api/threads/", "");
        if (env.PRISM_D1) await env.PRISM_D1.prepare("UPDATE threads SET archived = 1 WHERE id = ?").bind(delId).run();
        if (env.PRISM_KV) await env.PRISM_KV.delete("thread:" + delId);
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/threads/") && !path.includes("/delete") && request.method === "GET") {
      try {
        var tid = path.slice(13);
        var d1Thread = await getThreadFromD1(env, tid);
        if (d1Thread) return json(d1Thread, 200, origin);
        var thread = await getThread(env, tid);
        return thread ? json(thread, 200, origin) : json({ error: "Not found" }, 404, origin);
      } catch (e) {
        var tid2 = path.slice(13);
        var thread2 = await getThread(env, tid2);
        return thread2 ? json(thread2, 200, origin) : json({ error: "Not found" }, 404, origin);
      }
    }
    if (path.startsWith("/api/threads/") && request.method === "DELETE") {
      try {
        var delId = path.slice(13);
        if (env.PRISM_D1) await env.PRISM_D1.prepare("UPDATE threads SET archived = 1 WHERE id = ?").bind(delId).run();
        if (env.PRISM_KV) await env.PRISM_KV.delete("thread:" + delId);
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/threads/") && request.method === "DELETE") {
      var tid = path.slice(13);
      if (env.PRISM_KV) await env.PRISM_KV.delete("thread:" + tid);
      return json({ success: true }, 200, origin);
    }
    if (path === "/api/memory" && request.method === "GET") {
      return json({ memories: await getMemories(env) }, 200, origin);
    }
    if (path === "/api/memory" && request.method === "POST") {
      var body = await request.json();
      var id = await saveMemory(env, body.content, body.tags);
      return json({ success: true, id }, 200, origin);
    }
    if (path.startsWith("/api/memory/") && request.method === "DELETE") {
      var mid = path.slice(12);
      if (env.PRISM_KV) await env.PRISM_KV.delete(mid);
      return json({ success: true }, 200, origin);
    }
    if (path === "/api/image" && request.method === "POST") {
      try {
        var body = await request.json();
        var result = await generateImage(env, body.prompt, body.model);
        return json(result, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/image/models") {
      try {
        var resp = await fetch("https://image.pollinations.ai/models");
        var models = await resp.json();
        return json({ models }, 200, origin);
      } catch (e) {
        return json({ models: ["flux", "turbo", "gptimage"] }, 200, origin);
      }
    }
    if (path === "/api/search" && request.method === "POST") {
      try {
        var body = await request.json();
        var query = body.query || "";
        var sources = body.sources || ["tavily", "brave"];
        var results = {};
        var errors = {};
        var promises = [];
        if (sources.includes("tavily")) {
          promises.push(searchTavily(env, query).then(function(r2) {
            results.tavily = r2;
          }).catch(function(e) {
            errors.tavily = e.message;
          }));
        }
        if (sources.includes("brave")) {
          promises.push(searchBrave(env, query).then(function(r2) {
            results.brave = r2;
          }).catch(function(e) {
            errors.brave = e.message;
          }));
        }
        if (sources.includes("exa") || sources.includes("exa_api")) {
          promises.push(searchExa(env, query).then(function(r2) {
            results.exa = r2;
          }).catch(function(e) {
            errors.exa = e.message;
          }));
        }
        if (sources.includes("semantic_scholar") || sources.includes("semanticscholar")) {
          promises.push(searchSemanticScholar(env, query).then(function(r2) {
            results.semantic_scholar = r2;
          }).catch(function(e) {
            errors.semantic_scholar = e.message;
          }));
        }
        if (sources.includes("pubmed") || sources.includes("ncbi")) {
          promises.push(searchPubMed(env, query).then(function(r2) {
            results.pubmed = r2;
          }).catch(function(e) {
            errors.pubmed = e.message;
          }));
        }
        if (sources.includes("crossref")) {
          promises.push(searchCrossref(env, query).then(function(r2) {
            results.crossref = r2;
          }).catch(function(e) {
            errors.crossref = e.message;
          }));
        }
        if (sources.includes("openalex")) {
          promises.push(searchOpenAlex(env, query).then(function(r2) {
            results.openalex = r2;
          }).catch(function(e) {
            errors.openalex = e.message;
          }));
        }
        if (sources.includes("core")) {
          promises.push(searchCORE(env, query).then(function(r2) {
            results.core = r2;
          }).catch(function(e) {
            errors.core = e.message;
          }));
        }
        if (sources.includes("firecrawl")) {
          promises.push(searchFirecrawl(env, query).then(function(r2) {
            results.firecrawl = r2;
          }).catch(function(e) {
            errors.firecrawl = e.message;
          }));
        }
        if (sources.includes("perplexity")) {
          promises.push(searchPerplexity(env, query).then(function(r2) {
            results.perplexity = r2;
          }).catch(function(e) {
            errors.perplexity = e.message;
          }));
        }
        if (sources.includes("arxiv")) {
          promises.push(searchArXiv(env, query).then(function(r2) {
            results.arxiv = r2;
          }).catch(function(e) {
            errors.arxiv = e.message;
          }));
        }
        if (sources.includes("europe_pmc")) {
          promises.push(searchEuropePMC(env, query).then(function(r2) {
            results.europe_pmc = r2;
          }).catch(function(e) {
            errors.europe_pmc = e.message;
          }));
        }
        if (sources.includes("zenodo")) {
          promises.push(searchZenodo(env, query).then(function(r2) {
            results.zenodo = r2;
          }).catch(function(e) {
            errors.zenodo = e.message;
          }));
        }
        if (sources.includes("world_bank")) {
          promises.push(searchWorldBank(env, query).then(function(r2) {
            results.world_bank = r2;
          }).catch(function(e) {
            errors.world_bank = e.message;
          }));
        }
        if (sources.includes("ons")) {
          promises.push(searchONS(env, query).then(function(r2) {
            results.ons = r2;
          }).catch(function(e) {
            errors.ons = e.message;
          }));
        }
        if (sources.includes("data_gov_uk")) {
          promises.push(searchDataGovUK(env, query).then(function(r2) {
            results.data_gov_uk = r2;
          }).catch(function(e) {
            errors.data_gov_uk = e.message;
          }));
        }
        if (sources.includes("ssrn")) {
          promises.push(searchSSRN(env, query).then(function(r2) {
            results.ssrn = r2;
          }).catch(function(e) {
            errors.ssrn = e.message;
          }));
        }
        if (sources.includes("our_world_in_data")) {
          promises.push(searchOurWorldInData(env, query).then(function(r2) {
            results.our_world_in_data = r2;
          }).catch(function(e) {
            errors.our_world_in_data = e.message;
          }));
        }
        await Promise.all(promises);
        var allResults = [];
        Object.keys(results).forEach(function(source) {
          var sourceResults = results[source] || [];
          sourceResults.forEach(function(r2) {
            r2._source = source;
            allResults.push(r2);
          });
        });
        var seen = {};
        allResults = allResults.filter(function(r2) {
          var url4 = r2.url || r2.link || "";
          if (seen[url4]) return false;
          seen[url4] = true;
          return true;
        });
        return json({ results, allResults, query, errors, sourceCount: Object.keys(results).length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/atomise" && request.method === "POST") {
      try {
        var body = await request.json();
        var kvRaw3 = null;
        try {
          kvRaw3 = await env.PRISM_KV.get("__secrets__");
        } catch (e) {
        }
        var kvSecrets3 = {};
        if (kvRaw3) {
          try {
            kvSecrets3 = JSON.parse(kvRaw3);
          } catch (e) {
          }
        }
        var envPlus3 = new Proxy(env, {
          get: /* @__PURE__ */ __name(function(target, prop) {
            if (target[prop] !== void 0) return target[prop];
            if (kvSecrets3[prop] !== void 0) return kvSecrets3[prop];
            if (kvSecrets3[prop.toUpperCase()] !== void 0) return kvSecrets3[prop.toUpperCase()];
            if (kvSecrets3[prop.toLowerCase()] !== void 0) return kvSecrets3[prop.toLowerCase()];
            return void 0;
          }, "get")
        });
        var assets = await atomise(envPlus3, body.text, body.profile, body.variations || 3);
        return json({ assets }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/social/queue" && request.method === "GET") {
      if (!env.PRISM_KV) return json({ queue: [], total: 0 }, 200, origin);
      var status_filter = url.searchParams.get("status") || "";
      var limit = parseInt(url.searchParams.get("limit") || "100");
      var cursor = url.searchParams.get("cursor") || void 0;
      var listOpts = { prefix: "queue:", limit: Math.min(limit, 100) };
      if (cursor) listOpts.cursor = cursor;
      var list = await env.PRISM_KV.list(listOpts);
      var queue = [];
      for (var i = 0; i < list.keys.length; i++) {
        try {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) {
            var item = JSON.parse(val);
            if (!status_filter || item.status === status_filter) queue.push(item);
          }
        } catch (e) {
        }
      }
      queue.sort(function(a, b) {
        return new Date(b.created || 0) - new Date(a.created || 0);
      });
      return json({ queue, total: queue.length, has_more: !list.list_complete, cursor: list.cursor }, 200, origin);
    }
    if (path === "/api/social/queue" && request.method === "POST") {
      var body = await request.json();
      var id = "queue:" + Date.now();
      var item = Object.assign({ id, created: (/* @__PURE__ */ new Date()).toISOString(), status: "pending" }, body);
      if (env.PRISM_KV) await env.PRISM_KV.put(id, JSON.stringify(item));
      return json({ success: true, id }, 200, origin);
    }
    if (path === "/oauth/x/callback") {
      var code = url.searchParams.get("code");
      var state = url.searchParams.get("state");
      if (!code) {
        var clientId = env.X_CLIENT_ID || env.x_client_id || env.TWITTER_CLIENT_ID;
        if (!clientId) return json({ error: "X client ID not configured. Add X_CLIENT_ID to Worker secrets." }, 400, origin);
        var redirectUri = "https://prism.identitypartners.uk/oauth/x/callback";
        var scope = "tweet.read tweet.write users.read offline.access";
        var authUrl = "https://twitter.com/i/oauth2/authorize?response_type=code&client_id=" + clientId + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&scope=" + encodeURIComponent(scope) + "&state=prism&code_challenge=challenge&code_challenge_method=plain";
        return Response.redirect(authUrl, 302);
      }
      var clientId2 = env.X_CLIENT_ID || env.x_client_id;
      var clientSecret = env.X_CLIENT_SECRET || env.x_client_secret;
      var tokenResp = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + btoa(clientId2 + ":" + clientSecret) },
        body: "grant_type=authorization_code&code=" + code + "&redirect_uri=" + encodeURIComponent("https://prism.identitypartners.uk/oauth/x/callback") + "&code_verifier=challenge"
      });
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put("oauth:x:tokens", JSON.stringify(tokens));
      return new Response("<html><body><script>window.close();<\/script><p>X connected. You may close this window.</p></body></html>", { headers: { "Content-Type": "text/html" } });
    }
    if (path === "/api/social/post/x" && request.method === "POST") {
      try {
        var body = await request.json();
        var tokenData = null;
        if (env.PRISM_KV) {
          var td = await env.PRISM_KV.get("oauth:x:tokens");
          if (td) tokenData = JSON.parse(td);
        }
        if (!tokenData || !tokenData.access_token) return json({ error: "X not connected. Go to /oauth/x/callback to connect." }, 401, origin);
        var postResp = await fetch("https://api.twitter.com/2/tweets", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tokenData.access_token },
          body: JSON.stringify({ text: body.text })
        });
        var postData = await postResp.json();
        if (!postResp.ok) return json({ error: postData.detail || "X post failed", data: postData }, 400, origin);
        return json({ success: true, id: postData.data && postData.data.id }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/oauth/linkedin/callback") {
      var code = url.searchParams.get("code");
      var clientId = env.LINKEDIN_CLIENT_ID || env.linkedin_client_id;
      var clientSecret = env.LINKEDIN_CLIENT_SECRET || env.linkedin_primary_client_secret || env.linkedin_client_secret;
      if (!code) {
        if (!clientId) return json({ error: "LinkedIn client ID not configured." }, 400, origin);
        var redirectUri = "https://prism.identitypartners.uk/oauth/linkedin/callback";
        var scope = "openid profile email w_member_social";
        var authUrl = "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=" + clientId + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&scope=" + encodeURIComponent(scope) + "&state=prism";
        return Response.redirect(authUrl, 302);
      }
      var redirectUri2 = "https://prism.identitypartners.uk/oauth/linkedin/callback";
      var tokenResp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=" + code + "&redirect_uri=" + encodeURIComponent(redirectUri2) + "&client_id=" + clientId + "&client_secret=" + clientSecret
      });
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put("oauth:linkedin:tokens", JSON.stringify(tokens));
      return new Response("<html><body><script>window.close();<\/script><p>LinkedIn connected.</p></body></html>", { headers: { "Content-Type": "text/html" } });
    }
    if (path === "/api/social/post/linkedin" && request.method === "POST") {
      try {
        var body = await request.json();
        var tokenData = null;
        if (env.PRISM_KV) {
          var td = await env.PRISM_KV.get("oauth:linkedin:tokens");
          if (td) tokenData = JSON.parse(td);
        }
        // Check token expiry (LinkedIn tokens expire after 60 days)
        if (tokenData && tokenData.expires_at && Date.now() > tokenData.expires_at) {
          if (tokenData.refresh_token && (env.LINKEDIN_CLIENT_ID || env.linkedin_client_id)) {
            try {
              var refreshResp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(tokenData.refresh_token) +
                      "&client_id=" + encodeURIComponent(env.LINKEDIN_CLIENT_ID || env.linkedin_client_id) +
                      "&client_secret=" + encodeURIComponent(env.LINKEDIN_CLIENT_SECRET || env.linkedin_primary_client_secret)
              });
              if (refreshResp.ok) {
                var refreshData = await refreshResp.json();
                tokenData = { access_token: refreshData.access_token, refresh_token: refreshData.refresh_token || tokenData.refresh_token, expires_at: Date.now() + (refreshData.expires_in || 5184000) * 1000 };
                if (env.PRISM_KV) await env.PRISM_KV.put("oauth:linkedin:tokens", JSON.stringify(tokenData));
              } else { tokenData = null; }
            } catch(e) { tokenData = null; }
          } else { tokenData = null; }
        }
        if (!tokenData || !tokenData.access_token) return json({ error: "LinkedIn not connected. Go to /oauth/linkedin/callback to connect." }, 401, origin);
        var meResp = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { "Authorization": "Bearer " + tokenData.access_token } });
        var me = await meResp.json();
        var urn = "urn:li:person:" + me.sub;
        var postResp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tokenData.access_token, "X-Restli-Protocol-Version": "2.0.0" },
          body: JSON.stringify({ author: urn, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: body.text }, shareMediaCategory: "NONE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } })
        });
        var postData = await postResp.json();
        if (!postResp.ok) return json({ error: "LinkedIn post failed", data: postData }, 400, origin);
        return json({ success: true, id: postData.id }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/oauth/meta/callback") {
      var code = url.searchParams.get("code");
      var clientId = env.META_APP_ID || env.meta_app_id || env.FACEBOOK_APP_ID;
      var clientSecret = env.META_APP_SECRET || env.meta_app_secret || env.FACEBOOK_APP_SECRET;
      if (!code) {
        if (!clientId) return json({ error: "Meta App ID not configured. Add META_APP_ID to Worker secrets." }, 400, origin);
        var redirectUri = "https://prism.identitypartners.uk/oauth/meta/callback";
        var scope = "pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,publish_to_groups";
        var authUrl = "https://www.facebook.com/v19.0/dialog/oauth?client_id=" + clientId + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&scope=" + encodeURIComponent(scope) + "&state=prism";
        return Response.redirect(authUrl, 302);
      }
      var redirectUri2 = "https://prism.identitypartners.uk/oauth/meta/callback";
      var tokenResp = await fetch("https://graph.facebook.com/v19.0/oauth/access_token?client_id=" + clientId + "&redirect_uri=" + encodeURIComponent(redirectUri2) + "&client_secret=" + clientSecret + "&code=" + code);
      var tokens = await tokenResp.json();
      if (env.PRISM_KV) await env.PRISM_KV.put("oauth:meta:tokens", JSON.stringify(tokens));
      return new Response("<html><body><script>window.close();<\/script><p>Meta connected.</p></body></html>", { headers: { "Content-Type": "text/html" } });
    }
    if (path === "/api/social/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = body.text || "";
        var platforms = body.platforms || ["bluesky"];
        var imageUrl = body.imageUrl || null;
        var bypassMM = body.bypassMM === true; // Only /api/mm/approve sets this

        // All posts go through Media Manager queue unless bypassMM is set
        // bypassMM is only set internally by /api/mm/approve
        if (!bypassMM) {
          var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
          var q = qRaw ? JSON.parse(qRaw) : [];
          var newItem = {
            id: "mm-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
            text: text.substring(0, 2200),
            platforms,
            imageUrl,
            status: "pending",
            source: body.source || "direct",
            createdAt: Date.now(),
            scheduledFor: null,
            notes: "Queued via /api/social/post — awaiting Media Manager approval"
          };
          q.push(newItem);
          if (env.PRISM_KV) await env.PRISM_KV.put("mm:queue", JSON.stringify(q));
          return json({
            success: true,
            queued: true,
            itemId: newItem.id,
            message: "Queued for Media Manager review. Approve at /social-queue/ or via /api/mm/approve."
          }, 200, origin);
        }

        // bypassMM=true path — actual posting (called only by /api/mm/approve)
        var results = {};
        var errors = {};
        for (var pi = 0; pi < platforms.length; pi++) {
          var platform = platforms[pi];
          try {
            if (platform === "x" || platform === "twitter" || platform === "facebook") {
              var _bufP = platform === "x" ? "twitter" : platform;
              var _bufR = await postViaBuffer(env, text, [_bufP], imageUrl);
              if (_bufR.results && _bufR.results[_bufP]) results[platform] = _bufR.results[_bufP];
              else errors[platform] = (_bufR.errors && _bufR.errors[_bufP]) || _bufR.error || platform + " not connected in Buffer";
              continue;
            }
            if (platform === "mastodon") {
              var _masR = await postToMastodon(env, text);
              if (_masR.success) results.mastodon = _masR;
              else errors.mastodon = _masR.error || "Mastodon post failed";
              continue;
            }
            if (platform === "bluesky") {
              results.bluesky = await postToBluesky(env, text);
            } else if (platform === "linkedin") {
              var liR = await postToLinkedIn(env, text);
              if (liR.success) results.linkedin = liR;
              else errors.linkedin = liR.error || "LinkedIn post failed";
            }
          } catch(e) {
            errors[platform] = e.message;
          }
        }
        return json({ success: true, results, errors }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/devteam" && request.method === "POST") {
      try {
        var body = await request.json();
        var agent = body.agent || "pm";
        var historyKey = "devteam:" + agent + ":history";
        var history = [];
        if (env.PRISM_KV) {
          var stored = await env.PRISM_KV.get(historyKey);
          if (stored) history = JSON.parse(stored);
        }
        var sysPrompt = DEV_TEAM_PROMPTS[agent] || DEV_TEAM_PROMPTS["pm"];
        var messages = [{ role: "system", content: sysPrompt }].concat(history).concat([{ role: "user", content: body.message }]);
        var kvRaw2 = null;
        try {
          kvRaw2 = await env.PRISM_KV.get("__secrets__");
        } catch (e) {
        }
        var kvSecrets2 = {};
        if (kvRaw2) {
          try {
            kvSecrets2 = JSON.parse(kvRaw2);
          } catch (e) {
          }
        }
        var envPlus2 = new Proxy(env, {
          get: /* @__PURE__ */ __name(function(target, prop) {
            if (target[prop] !== void 0) return target[prop];
            if (kvSecrets2[prop] !== void 0) return kvSecrets2[prop];
            if (kvSecrets2[prop.toUpperCase()] !== void 0) return kvSecrets2[prop.toUpperCase()];
            if (kvSecrets2[prop.toLowerCase()] !== void 0) return kvSecrets2[prop.toLowerCase()];
            return void 0;
          }, "get")
        });
        var result = await orchestrate(envPlus2, messages, "balanced", "chat", null);
        history.push({ role: "user", content: body.message });
        history.push({ role: "assistant", content: result.content });
        if (history.length > 40) history = history.slice(-40);
        if (env.PRISM_KV) await env.PRISM_KV.put(historyKey, JSON.stringify(history));
        // Parse tool calls from LLM response
        var responseText = result.content || "";
        var toolResults = [];
        var toolCallRegex = /TOOL_CALL:\s*(\w+)\s*\(([^)]+)\)/g;
        var match;
        while ((match = toolCallRegex.exec(responseText)) !== null) {
          var toolName = match[1];
          var toolParamsStr = match[2];
          var toolParams = {};
          try { toolParams = JSON.parse("{" + toolParamsStr + "}"); } catch(e) {
            // Try simple key:value parsing
            toolParamsStr.split(",").forEach(function(pair) {
              var kv = pair.split(":"); if (kv.length >= 2) toolParams[kv[0].trim().replace(/['"]/g,"")] = kv.slice(1).join(":").trim().replace(/['"]/g,"");
            });
          }
          var toolResult = await executeDevTeamTool(toolName, toolParams, env);
          toolResults.push({tool: toolName, params: toolParams, result: toolResult});
          responseText += "\n\n[Tool: " + toolName + " → " + JSON.stringify(toolResult).substring(0,200) + "]";
        }
        return json({ content: responseText, provider: result.provider, agent, toolResults }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/crm/contacts" && request.method === "GET") {
      if (!env.PRISM_KV) return json({ contacts: [] }, 200, origin);
      var list = await env.PRISM_KV.list({ prefix: "crm:contact:" });
      var contacts = [];
      for (var i = 0; i < list.keys.length; i++) {
        var val = await env.PRISM_KV.get(list.keys[i].name);
        if (val) contacts.push(JSON.parse(val));
      }
      return json({ contacts }, 200, origin);
    }
    if (path === "/api/crm/contacts" && request.method === "POST") {
      var body = await request.json();
      var id = "crm:contact:" + Date.now();
      var contact = Object.assign({ id, created: (/* @__PURE__ */ new Date()).toISOString() }, body);
      if (env.PRISM_KV) await env.PRISM_KV.put(id, JSON.stringify(contact));
      return json({ success: true, id, contact }, 200, origin);
    }
    if (path === "/api/notify" && request.method === "POST") {
      try {
        var body = await request.json();
        await sendTelegram(env, body.message);
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/kv" && request.method === "GET") {
      if (!env.PRISM_KV) return json({ keys: [] }, 200, origin);
      var prefix = url.searchParams.get("prefix") || "";
      var list = await env.PRISM_KV.list({ prefix });
      return json({ keys: list.keys.map(function(k) {
        return k.name;
      }) }, 200, origin);
    }
    if (path === "/api/rss" && request.method === "GET") {
      var feedUrl = url.searchParams.get("url");
      if (!feedUrl) return json({ error: "No URL provided" }, 400, origin);
      try {
        var rssResp = await fetch(feedUrl, { headers: { "User-Agent": "Argentica/1.0 RSS Reader" } });
        var rssText = await rssResp.text();
        return new Response(rssText, {
          headers: Object.assign({ "Content-Type": "application/rss+xml; charset=utf-8" }, cors(origin))
        });
      } catch (e) {
        return json({ error: "RSS fetch failed: " + e.message }, 500, origin);
      }
    }
    if (path === "/api/ingest-secrets" && request.method === "POST") {
      try {
        var body = await request.json();
        var secrets = body.secrets || {};
        var cfToken = body.cfToken;
        var accountId = body.accountId || "d741de91f8cfff2306cc0f850a76ee07";
        var workerName = body.workerName || "prism-api";
        var results = { ok: [], failed: [] };
        if (env.PRISM_KV) {
          var kvSecrets = {};
          try {
            var existing = await env.PRISM_KV.get("__secrets__");
            if (existing) kvSecrets = JSON.parse(existing);
          } catch (e) {
          }
          Object.assign(kvSecrets, secrets);
          await env.PRISM_KV.put("__secrets__", JSON.stringify(kvSecrets));
        }
        if (cfToken) {
          var entries = Object.entries(secrets);
          for (var i = 0; i < entries.length; i++) {
            var key = entries[i][0];
            var val = entries[i][1];
            try {
              var r = await fetch(
                "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/workers/scripts/" + workerName + "/secrets",
                {
                  method: "PUT",
                  headers: { "Authorization": "Bearer " + cfToken, "Content-Type": "application/json" },
                  body: JSON.stringify({ name: key, text: val, type: "secret_text" })
                }
              );
              var rd = await r.json();
              if (rd.success) results.ok.push(key);
              else results.failed.push({ key, error: rd.errors && rd.errors[0] ? rd.errors[0].message : "unknown" });
            } catch (e) {
              results.failed.push({ key, error: e.message });
            }
          }
        } else {
          results.ok = Object.keys(secrets);
        }
        return json({ success: true, kvStored: Object.keys(secrets).length, cfPushed: results.ok.length, failed: results.failed }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    async function getSecret(env2, name2) {
      if (env2[name2]) return env2[name2];
      if (env2[name2.toUpperCase()]) return env2[name2.toUpperCase()];
      if (env2.PRISM_KV) {
        try {
          var kvSecrets4 = await env2.PRISM_KV.get("__secrets__");
          if (kvSecrets4) {
            var parsed2 = JSON.parse(kvSecrets4);
            return parsed2[name2] || parsed2[name2.toUpperCase()] || parsed2[name2.toLowerCase()] || null;
          }
        } catch (e) {
        }
      }
      return null;
    }
    __name(getSecret, "getSecret");
    if (path === "/api/roundtable" && request.method === "POST") {
      try {
        let k2 = function(names2) {
          for (var i2 = 0; i2 < names2.length; i2++) {
            var n = names2[i2];
            var v2 = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()] || kv2[n] || kv2[n.toLowerCase()] || kv2[n.toUpperCase()];
            if (v2 && v2.length > 6) return v2;
          }
          return null;
        };
        __name(k2, "k2");
        var body = await request.json();
        var messages = body.messages || [];
        var models = body.models || ["cerebras-qwen3", "groq-llama3", "gemini-free", "deepseek-chat", "kimi"];
        var synthesise = body.synthesise !== false;
        var responses = [];
        var kv2 = {};
        try {
          if (env.PRISM_KV) {
            var raw2 = await env.PRISM_KV.get("__secrets__");
            if (raw2) kv2 = JSON.parse(raw2);
          }
        } catch (e) {
        }
        var MODEL_REGISTRY = [
          // Cerebras - use cerebras_api_key (old name) which works, not CEREBRAS_PAID_1 (402)
          { id: "cerebras-qwen3", provider: "cerebras", model: "qwen-3.8-27b", key: k2(["cerebras_api_key", "CEREBRAS_PAID_2"]) },
          { id: "cerebras-qwen36", provider: "cerebras", model: "qwen-3.6-27b", key: k2(["cerebras_api_key", "CEREBRAS_PAID_2"]) },
          // Groq - current active models (verified Sep 2026)
          { id: "groq-compound-mini", provider: "groq", model: "groq/compound-mini", key: k2(["GROQ_PAID_1", "groq_api_key"]) },
          { id: "groq-gpt-oss", provider: "groq", model: "openai/gpt-oss-120b", key: k2(["GROQ_PAID_1", "groq_api_key"]) },
          { id: "groq-compound", provider: "groq", model: "groq/compound", key: k2(["GROQ_PAID_1", "groq_api_key"]) },
          // DeepSeek - confirmed working
          { id: "deepseek-chat", provider: "deepseek", model: "deepseek-chat", key: k2(["DEEPSEEK_PAID_1", "deepseek_api_key"]) },
          // Kimi/Moonshot
          { id: "kimi", provider: "kimi", model: "moonshot-v1-8k", key: k2(["KIMI_PAID_1", "kimi_api_key"]) },
          // Mistral
          { id: "mistral", provider: "mistral", model: "mistral-small-latest", key: k2(["MISTRAL_PAID_1", "mistral_api_key"]) },
          // Cohere
          { id: "cohere", provider: "cohere", model: "command-a-03-2025", key: k2(["COHERE_PAID_1", "cohere_api_key"]) },
          // NVIDIA Nemotron
          { id: "nvidia-nemotron", provider: "nvidia", model: "nvidia/llama-3.1-nemotron-ultra-253b-v1", key: k2(["NVIDIA_PAID_1", "nvidia_build_api_key"]) },
          // xAI Grok
          { id: "xai-grok", provider: "xai", model: "grok-beta", key: k2(["XAI_PAID_1"]) },
          // Gemini - use paid key with correct model
          { id: "gemini", provider: "gemini", model: "gemini-2.5-flash", key: k2(["GEMINI_PAID_1", "GEMINI_FREE_1", "gemini_paid_api_key", "gemini_api_key"]) },
          // Pollinations - always available
          { id: "kie-gemma4", provider: "kie", model: "google/gemma-4-27b-it", key: k2(["KIE_AI", "kie_ai"]) },
          { id: "kie-gemini", provider: "kie", model: "gemini-2.5-flash", key: k2(["KIE_AI", "kie_ai"]) },
          { id: "pollinations", provider: "pollinations", model: "openai-large", key: k2(["POLLINATIONS_FREE_1", "pollinations_key"]) }
        ];
        var selectedModels = MODEL_REGISTRY.filter(function(m2) {
          return models.indexOf(m2.id) >= 0 || models.indexOf("all") >= 0;
        });
        if (selectedModels.length === 0) selectedModels = MODEL_REGISTRY.slice(0, 4);
        var modelPromises = selectedModels.map(async function(modelDef) {
          if (!modelDef.key && modelDef.provider !== "pollinations") {
            return { model: modelDef.id, content: "", error: "No API key configured", provider: modelDef.provider };
          }
          try {
            var result2 = await Promise.race([
              callProvider(env, modelDef.provider, modelDef.key, modelDef.model, messages),
              new Promise(function(_, reject) {
                setTimeout(function() {
                  reject(new Error("timeout"));
                }, 15e3);
              })
            ]);
            return { model: modelDef.id, content: result2.content || "", provider: result2.provider || modelDef.provider, ms: Date.now() };
          } catch (e) {
            return { model: modelDef.id, content: "", error: e.message, provider: modelDef.provider };
          }
        });
        var settled = await Promise.allSettled(modelPromises);
        settled.forEach(function(r2) {
          if (r2.status === "fulfilled") {
            if (r2.value.content && r2.value.content.length > 0) {
              responses.push(r2.value);
            } else if (r2.value.error) {
              responses.push({ model: r2.value.model, content: "[Error: " + r2.value.error + "]", provider: r2.value.provider, isError: true });
            }
          } else if (r2.status === "rejected") {
            responses.push({ model: "unknown", content: "[Rejected: " + r2.reason + "]", provider: "none", isError: true });
          }
        });
        var synthesis = null;
        if (synthesise && responses.length > 1) {
          var synthKey = k2(["NVIDIA_PAID_1", "nvidia_build_api_key"]) || k2(["GEMINI_PAID_1", "gemini_paid_api_key"]);
          var synthProvider = synthKey === k2(["NVIDIA_PAID_1", "nvidia_build_api_key"]) ? "nvidia" : "gemini";
          var synthModel = synthProvider === "nvidia" ? "nvidia/llama-3.1-nemotron-ultra-253b-v1" : "gemini-2.5-pro";
          try {
            var synthMessages = messages.concat([{ role: "user", content: "You are a synthesis engine. The following are responses from multiple AI models to the same question. Synthesise them into a single authoritative, balanced answer that captures the best insights from each. Be concise. British English.\n\n" + responses.map(function(r2) {
              return r2.model + ": " + r2.content;
            }).join("\n\n") }]);
            var synthResult = await callProvider(env, synthProvider, synthKey, synthModel, synthMessages);
            synthesis = synthResult.content;
          } catch (e) {
            synthesis = null;
          }
        }
        return json({ responses, synthesis, modelCount: responses.length, availableModels: MODEL_REGISTRY.map(function(m2) {
          return { id: m2.id, available: !!(m2.key || m2.provider === "pollinations") };
        }) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/render" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 280);
        var template = body.template || "quote-teal";
        var cacheKey = body.cacheKey || ("canvas-" + Date.now() + ".png");
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;

        // Option B: pre-baked R2 template (immediate, always works)
        // Use when Browserless key absent or caller requests it explicitly
        if (!browserlessKey || body.usePrebaked) {
          var ti = Math.floor(Math.random() * 150);
          var prebakedUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti + ".png";
          return json({ success: true, url: prebakedUrl, method: "prebaked", index: ti }, 200, origin);
        }

        // Option A: HTML/CSS via Browserless (no JS canvas element — eliminates render timeout)
        // generateCanvasHtml now returns proper HTML with base64-embedded background
        var html = await generateCanvasHtml(text, template, env);

        var browserlessResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html,
            options: {
              type: "png",
              clip: { x: 0, y: 0, width: 1080, height: 1080 },
              fullPage: false
            },
            waitForFunction: {
              fn: "() => document.title === 'READY'",
              timeout: 10000
            },
            waitForTimeout: 12000
          })
        });

        if (!browserlessResp.ok) {
          var errText = await browserlessResp.text();
          // Browserless failed — fall back to pre-baked template
          var ti2 = Math.floor(Math.random() * 150);
          var fallbackUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti2 + ".png";
          return json({
            success: true,
            url: fallbackUrl,
            method: "prebaked-fallback",
            browserlessError: "Browserless " + browserlessResp.status + ": " + errText.substring(0, 100)
          }, 200, origin);
        }

        var pngBuffer = await browserlessResp.arrayBuffer();
        var pngSize = pngBuffer.byteLength;

        // Sanity check: blank images are typically < 5KB
        if (pngSize < 5000) {
          var ti3 = Math.floor(Math.random() * 150);
          var tinyFallback = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti3 + ".png";
          return json({
            success: true,
            url: tinyFallback,
            method: "prebaked-fallback",
            browserlessError: "PNG too small (" + pngSize + " bytes) — likely blank"
          }, 200, origin);
        }

        // Upload to R2 (not Imgur — spec Section 3.2 mandates R2)
        var r2Url = null;
        if (env.PRISM_ASSETS) {
          await env.PRISM_ASSETS.put(cacheKey, pngBuffer, {
            httpMetadata: { contentType: "image/png" },
            expirationTtl: 86400 * 30
          });
          r2Url = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + cacheKey;
        }

        return json({
          success: true,
          url: r2Url || ("data:image/png;base64," + btoa(String.fromCharCode(...new Uint8Array(pngBuffer)))),
          method: "browserless-html",
          sizeBytes: pngSize,
          cacheKey
        }, 200, origin);

      } catch (e) {
        // Last resort: pre-baked template
        var ti4 = Math.floor(Math.random() * 150);
        return json({
          success: true,
          url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti4 + ".png",
          method: "prebaked-error-fallback",
          error: e.message
        }, 200, origin);
      }
    }
        if (path === "/api/social/post-with-canvas" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 2200);
        var platforms = body.platforms || ["instagram"];
        var template = body.template || "quote-teal";

        var bufferKey = env.BUFFER_API_KEY || env.buffer;
        var igChannelId = env.BUFFER_IG_CHANNEL || env.buffer_ig_channel || "6a97edce065799be46722eab";
        var fbChannelId = env.BUFFER_FB_CHANNEL || env.buffer_fb_channel || "6a97ea40065799be46721fdd";

        // ── Step 1: Resolve image URL ─────────────────────────────────────
        var pngUrl = body.prebuiltImageUrl || null;

        if (!pngUrl) {
          // Call our own canvas render endpoint (now uses HTML/CSS + R2 fallback)
          var renderReq = new Request("https://prism-api.identitypartners.workers.dev/api/canvas/render", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
            body: JSON.stringify({ text, template, cacheKey: "social-canvas-" + Date.now() + ".png" })
          });
          var renderResp = await fetch(renderReq);
          if (renderResp.ok) {
            var renderData = await renderResp.json();
            pngUrl = renderData.url || null;
          }
        }

        // Final fallback: random pre-baked R2 template
        if (!pngUrl) {
          var ti = Math.floor(Math.random() * 150);
          pngUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti + ".png";
        }

        var results = {};
        var errors = {};
        var caption = text + "\n\nhello@identitypartners.uk | www.identitypartners.uk/contact\n#IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing";

        // ── Step 2: Post to each platform via Buffer GraphQL ─────────────
        for (var pi = 0; pi < platforms.length; pi++) {
          var platform = platforms[pi];

          if (platform === "instagram" && bufferKey) {
            var igCaption = caption.substring(0, 2200);
            var igMutation = JSON.stringify({
              query: "mutation{createPost(input:{channelId:\"" + igChannelId + "\",text:" +
                JSON.stringify(igCaption) +
                ",assets:[{image:{url:" + JSON.stringify(pngUrl) + "}}]," +
                "mode:shareNow,needsApproval:false,schedulingType:automatic," +
                "metadata:{instagram:{type:post,shouldShareToFeed:true}}})" +
                "{...on PostActionSuccess{post{id status}}...on MutationError{message}}}"
            });
            var igR = await fetch("https://api.buffer.com/graphql", {
              method: "POST",
              headers: { "Authorization": "Bearer " + bufferKey, "Content-Type": "application/json" },
              body: igMutation
            });
            var igD = await igR.json();
            var igCp = ((igD.data || {}).createPost || {});
            if (igCp.post) {
              results.instagram = { success: true, id: igCp.post.id, imageUrl: pngUrl };
            } else {
              errors.instagram = igCp.message || ((igD.errors || [{}])[0].message || "Buffer Instagram error");
            }
          }

          if (platform === "facebook" && bufferKey) {
            var fbCaption = caption.substring(0, 63206);
            var fbMutation = JSON.stringify({
              query: "mutation{createPost(input:{channelId:\"" + fbChannelId + "\",text:" +
                JSON.stringify(fbCaption) +
                ",assets:[{image:{url:" + JSON.stringify(pngUrl) + "}}]," +
                "mode:shareNow,needsApproval:false,schedulingType:automatic," +
                "metadata:{facebook:{type:post}}})" +
                "{...on PostActionSuccess{post{id status}}...on MutationError{message}}}"
            });
            var fbR = await fetch("https://api.buffer.com/graphql", {
              method: "POST",
              headers: { "Authorization": "Bearer " + bufferKey, "Content-Type": "application/json" },
              body: fbMutation
            });
            var fbD = await fbR.json();
            var fbCp = ((fbD.data || {}).createPost || {});
            if (fbCp.post) {
              results.facebook = { success: true, id: fbCp.post.id, imageUrl: pngUrl };
            } else {
              errors.facebook = fbCp.message || ((fbD.errors || [{}])[0].message || "Buffer Facebook error");
            }
          }
        }

        return json({ success: true, results, errors, imageUrl: pngUrl }, 200, origin);

      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/penpot-url" && request.method === "GET") {
      var penpotUrl = env.Penpot_url || env.PENPOT_URL || env.Penpot || env.penpot_url || "https://design.penpot.app";
      var baseUrl = penpotUrl.replace(/\/login\/?$/, "").replace(/\/$/, "");
      return json({ url: baseUrl, configured: true }, 200, origin);
    }
    if (path.startsWith("/api/penpot/") && request.method !== "OPTIONS") {
      try {
        var penpotBase = env.Penpot_url || env.PENPOT_URL || env.Penpot || env.penpot_url || "";
        penpotBase = penpotBase.replace(/\/login\/?$/, "").replace(/\/$/, "");
        if (!penpotBase) return json({ error: "Penpot URL not configured" }, 200, origin);
        var penpotPath = path.replace("/api/penpot", "/api/rpc/command");
        var penpotReq = await fetch(penpotBase + penpotPath, {
          method: request.method,
          headers: {
            "Content-Type": request.headers.get("Content-Type") || "application/json",
            "Authorization": request.headers.get("Authorization") || ""
          },
          body: request.method !== "GET" ? await request.text() : void 0
        });
        var penpotData = await penpotReq.text();
        return new Response(penpotData, {
          status: penpotReq.status,
          headers: {
            "Content-Type": penpotReq.headers.get("Content-Type") || "application/json",
            "Access-Control-Allow-Origin": origin
          }
        });
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/polotno-key" && request.method === "GET") {
      var key = env.POLOTNO_KEY || env.polotno_key || "nFA5H9elEytDyPyvKL7T";
      return json({ key }, 200, origin);
    }
    if (path === "/api/zoho/test" && request.method === "GET") {
      var clientId = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID;
      var clientSecret = env.ZOHO_CLIENT_SECRET || env.Zoho_Client_Secret;
      var hasTokens = {};
      if (env.PRISM_KV) {
        for (var svc of ["mail", "calendar", "crm", "social"]) {
          var t = await env.PRISM_KV.get("zoho:tokens:" + svc);
          hasTokens[svc] = t ? "stored" : "not connected";
        }
      }
      return json({
        clientId: clientId ? clientId.substring(0, 20) + "..." : "MISSING",
        clientSecret: clientSecret ? "present (" + clientSecret.length + " chars)" : "MISSING",
        redirectUris: {
          mail: "https://prism.identitypartners.uk/oauth/zoho/mail",
          calendar: "https://prism.identitypartners.uk/oauth/zoho/calendar",
          crm: "https://prism.identitypartners.uk/oauth/zoho/crm",
          social: "https://prism.identitypartners.uk/oauth/zoho/social"
        },
        authEndpoint: "https://accounts.zoho.eu/oauth/v2/auth",
        tokenEndpoint: "https://accounts.zoho.eu/oauth/v2/token",
        tokens: hasTokens
      }, 200, origin);
    }
    if (path === "/api/zoho/mail/send" && request.method === "POST") {
      try {
        var body = await request.json();
        var tokens = null;
        if (env.PRISM_KV) {
          var t = await env.PRISM_KV.get("zoho:tokens:mail");
          if (t) tokens = JSON.parse(t);
        }
        if (!tokens || !tokens.access_token) return json({ success: false, error: "Zoho Mail not connected. Visit /oauth/zoho/mail to connect." }, 200, origin);
        var accountsResp = await fetch("https://mail.zoho.eu/api/accounts", {
          headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token }
        });
        if (!accountsResp.ok) return json({ success: false, error: "Could not fetch Zoho Mail accounts: " + accountsResp.status }, 200, origin);
        var accountsData = await accountsResp.json();
        var accountId = accountsData.data && accountsData.data[0] && accountsData.data[0].accountId;
        if (!accountId) return json({ success: false, error: "No Zoho Mail account found" }, 200, origin);
        var sendResp = await fetch("https://mail.zoho.eu/api/accounts/" + accountId + "/messages", {
          method: "POST",
          headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({
            fromAddress: body.from || "simon@identitypartners.uk",
            toAddress: body.to,
            subject: body.subject,
            content: body.body,
            mailFormat: "plaintext"
          })
        });
        var sendData = await sendResp.json();
        if (!sendResp.ok) return json({ success: false, error: "Send failed: " + JSON.stringify(sendData) }, 200, origin);
        return json({ success: true, messageId: sendData.data && sendData.data.messageId }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/zoho/mail/inbox" && request.method === "GET") {
      try {
        var tokens = null;
        if (env.PRISM_KV) {
          var t = await env.PRISM_KV.get("zoho:tokens:mail");
          if (t) tokens = JSON.parse(t);
        }
        if (!tokens || !tokens.access_token) return json({ messages: [], error: "not connected" }, 200, origin);
        var accountsResp = await fetch("https://mail.zoho.eu/api/accounts", { headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token } });
        if (!accountsResp.ok) return json({ messages: [], error: "accounts fetch failed" }, 200, origin);
        var accountsData = await accountsResp.json();
        var accountId = accountsData.data && accountsData.data[0] && accountsData.data[0].accountId;
        if (!accountId) return json({ messages: [], error: "no account" }, 200, origin);
        var inboxResp = await fetch("https://mail.zoho.eu/api/accounts/" + accountId + "/messages/view?limit=20&sortorder=false", { headers: { "Authorization": "Zoho-oauthtoken " + tokens.access_token } });
        if (!inboxResp.ok) return json({ messages: [], error: "inbox fetch failed" }, 200, origin);
        var inboxData = await inboxResp.json();
        return json({ messages: inboxData.data || [], accountId }, 200, origin);
      } catch (e) {
        return json({ messages: [], error: e.message }, 200, origin);
      }
    }
    if (path === "/api/zoho/refresh" && request.method === "POST") {
      try {
        var body = await request.json();
        var service = body.service;
        var tokens = null;
        if (env.PRISM_KV) {
          var t = await env.PRISM_KV.get("zoho:tokens:" + service);
          if (t) tokens = JSON.parse(t);
        }
        if (!tokens || !tokens.refresh_token) return json({ success: false, error: "No refresh token for " + service }, 200, origin);
        var clientId = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID;
        var clientSecret = env.ZOHO_CLIENT_SECRET || env.Zoho_Client_Secret;
        var refreshResp = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&client_id=" + encodeURIComponent(clientId) + "&client_secret=" + encodeURIComponent(clientSecret) + "&refresh_token=" + encodeURIComponent(tokens.refresh_token)
        });
        var newTokens = await refreshResp.json();
        if (newTokens.access_token) {
          newTokens.refresh_token = newTokens.refresh_token || tokens.refresh_token;
          if (env.PRISM_KV) await env.PRISM_KV.put("zoho:tokens:" + service, JSON.stringify(newTokens));
          return json({ success: true, expires_in: newTokens.expires_in }, 200, origin);
        }
        return json({ success: false, error: newTokens.error || "Refresh failed" }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/headless/signup" && request.method === "POST") {
      try {
        var body = await request.json();
        var platformName = body.platform || "";
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        var savedProfile = null;
        if (env.PRISM_KV) {
          try {
            var sp = await env.PRISM_KV.get("profile:signup");
            if (sp) savedProfile = JSON.parse(sp);
          } catch (e) {
          }
        }
        var profile = Object.assign({
          name: "Simon Johnson",
          displayName: "Identity Partners",
          email: "hello@identitypartners.uk",
          personalEmail: "simon@identitypartners.uk",
          website: "https://www.identitypartners.uk",
          bookingUrl: "https://www.identitypartners.uk/contact",
          bio: "Non-clinical listening, coaching, mentoring and relational practice. Evidence-based support for addiction, trauma, mental health, and community wellbeing. Based in the UK.",
          shortBio: "Relational practice for addiction, trauma & mental health. Non-clinical. Evidence-based.",
          tagline: "Understand your past. Appreciate the present. Define your future.",
          rates: { consultation: "Free (20 minutes)", session: "50 per hour", group: "25 per session", monthly: "150 per month (4 sessions)" },
          socials: { bluesky: "identitypartners.bsky.social", linkedin: "identitypartners", instagram: "@identitypartners", twitter: "@identitypartners" },
          categories: ["Life Coaching", "Mental Health", "Addiction Recovery", "Trauma Support", "ADHD Coaching", "Accountability"],
          keywords: ["addiction recovery", "trauma-informed", "mental health", "relational practice", "non-clinical", "accountability", "ADHD", "neurodivergent"],
          logoUrl: "https://prism.identitypartners.uk/shared/assets/logo-square.png",
          password: "IPrism2026!Secure"
        }, savedProfile || {}, body || {});
        if (!profile.password) profile.password = "IPrism2026!Secure";
        var platformData = null;
        var PLATFORMS = [{ "name": "Rent a Cyber Friend", "cat": "companionship", "model": "Per-minute conversation", "status": "D,P,R", "url": "rentacyberfriend.com" }, { "name": "RentAFriend", "cat": "companionship", "model": "Hourly companionship", "status": "D,R", "url": "rentafriend.com" }, { "name": "FriendPC", "cat": "companionship", "model": "Virtual-friend listings", "status": "D,P,R", "url": "friendpc.com" }, { "name": "Companiions", "cat": "companionship", "model": "UK paid companionship", "status": "D,V,UK", "url": "companiions.com" }, { "name": "Premium.Chat", "cat": "companionship", "model": "Paid text/audio/video", "status": "F,P", "url": "premium.chat" }, { "name": "Popcall", "cat": "companionship", "model": "Paid calls and messages", "status": "F,P", "url": "popcall.com" }, { "name": "TrunkCall", "cat": "companionship", "model": "Expert calls/sessions/groups", "status": "D/F,P", "url": "trunkcall.com" }, { "name": "Talkspresso", "cat": "companionship", "model": "Paid consultations", "status": "D/F", "url": "talkspresso.com" }, { "name": "Intro", "cat": "companionship", "model": "Bookable paid video", "status": "D/F,V", "url": "intro.co" }, { "name": "Minnect", "cat": "companionship", "model": "Paid messages/consultations", "status": "D/F,V", "url": "minnect.com" }, { "name": "Fiverr", "cat": "freelance", "model": "Productised gigs", "status": "D,P", "url": "fiverr.com" }, { "name": "Upwork", "cat": "freelance", "model": "Contracts", "status": "D", "url": "upwork.com" }, { "name": "PeoplePerHour", "cat": "freelance", "model": "Hourly/packaged", "status": "D,UK", "url": "peopleperhour.com" }, { "name": "Freelancer.com", "cat": "freelance", "model": "Project bids", "status": "D", "url": "freelancer.com" }, { "name": "Bark", "cat": "freelance", "model": "Lead acquisition", "status": "D,UK", "url": "bark.com" }, { "name": "Airtasker", "cat": "freelance", "model": "Remote support tasks", "status": "D,UK", "url": "airtasker.com" }, { "name": "TaskRabbit", "cat": "freelance", "model": "Local/remote assistance", "status": "D,V,UK", "url": "taskrabbit.co.uk" }, { "name": "Guru", "cat": "freelance", "model": "Project marketplace", "status": "D", "url": "guru.com" }, { "name": "Contra", "cat": "freelance", "model": "Independent work", "status": "D", "url": "contra.com" }, { "name": "Malt", "cat": "freelance", "model": "Freelance marketplace", "status": "D", "url": "malt.com" }, { "name": "YunoJuno", "cat": "freelance", "model": "Freelance marketplace", "status": "D,UK", "url": "yunojuno.com" }, { "name": "Kounselly", "cat": "freelance", "model": "Coaching/consulting", "status": "D", "url": "kounselly.com" }, { "name": "Topmate", "cat": "mentoring", "model": "Paid sessions", "status": "D/F", "url": "topmate.io" }, { "name": "Superpeer", "cat": "mentoring", "model": "Paid calls", "status": "D/F", "url": "superpeer.com" }, { "name": "MentorCruise", "cat": "mentoring", "model": "Ongoing mentoring", "status": "D,V", "url": "mentorcruise.com" }, { "name": "GrowthMentor", "cat": "mentoring", "model": "Expert mentoring", "status": "D,V", "url": "growthmentor.com" }, { "name": "Sessions.us", "cat": "mentoring", "model": "Paid sessions", "status": "D/F", "url": "sessions.us" }, { "name": "Nas.io", "cat": "mentoring", "model": "Paid sessions/communities", "status": "D/F", "url": "nas.io" }, { "name": "Pensight", "cat": "mentoring", "model": "Paid calls", "status": "F", "url": "pensight.com" }, { "name": "Stan", "cat": "mentoring", "model": "Paid consultations", "status": "F", "url": "stan.store" }, { "name": "Beacons", "cat": "mentoring", "model": "Paid appointments", "status": "F", "url": "beacons.ai" }, { "name": "Directly.live", "cat": "mentoring", "model": "Expert access", "status": "D/F", "url": "directly.live" }, { "name": "Noomii", "cat": "coaching", "model": "Coach discovery", "status": "D,UK", "url": "noomii.com" }, { "name": "Life Coach Directory", "cat": "coaching", "model": "UK coach directory", "status": "D,V,UK", "url": "lifecoachdirectory.org.uk" }, { "name": "Life Coach Hub", "cat": "coaching", "model": "Coach marketplace", "status": "D", "url": "lifecoachhub.com" }, { "name": "Coach.me", "cat": "coaching", "model": "Habit/coaching", "status": "D", "url": "coach.me" }, { "name": "Approach a Coach", "cat": "coaching", "model": "Coach directory", "status": "D,UK", "url": "approachacoach.com" }, { "name": "CoachCompare", "cat": "coaching", "model": "Coach comparison", "status": "D,UK", "url": "coachcompare.com" }, { "name": "CoachMatching", "cat": "coaching", "model": "Coach matching", "status": "D", "url": "coachmatching.com" }, { "name": "ADHD UK Marketplace", "cat": "adhd", "model": "ADHD coach marketplace", "status": "D,C,V,UK", "url": "adhduk.co.uk" }, { "name": "Shimmer", "cat": "adhd", "model": "ADHD coaching", "status": "D,C,V", "url": "shimmer.care" }, { "name": "ADHD Coaching Agency", "cat": "adhd", "model": "ADHD coaching", "status": "D,C,V", "url": "adhdcoachingagency.com" }, { "name": "Focusmate", "cat": "adhd", "model": "Body doubling", "status": "F", "url": "focusmate.com" }, { "name": "Coacherly", "cat": "recovery", "model": "Recovery coaching", "status": "D,C", "url": "coacherly.com" }, { "name": "Superprof", "cat": "tutoring", "model": "Tutoring marketplace", "status": "D,UK", "url": "superprof.co.uk" }, { "name": "Tutorful", "cat": "tutoring", "model": "UK tutoring", "status": "D,V,UK", "url": "tutorful.co.uk" }, { "name": "Preply", "cat": "tutoring", "model": "Online tutoring", "status": "D,V", "url": "preply.com" }, { "name": "Udemy", "cat": "courses", "model": "Course marketplace", "status": "D", "url": "udemy.com" }, { "name": "Skillshare", "cat": "courses", "model": "Course platform", "status": "D", "url": "skillshare.com" }, { "name": "Maven", "cat": "courses", "model": "Cohort courses", "status": "D", "url": "maven.com" }, { "name": "Reed Courses", "cat": "courses", "model": "UK course marketplace", "status": "D,UK", "url": "reed.co.uk/courses" }, { "name": "Mighty Networks", "cat": "community", "model": "Paid community", "status": "F", "url": "mightynetworks.com" }, { "name": "Circle", "cat": "community", "model": "Community platform", "status": "F", "url": "circle.so" }, { "name": "Skool", "cat": "community", "model": "Community + courses", "status": "F", "url": "skool.com" }, { "name": "Whop", "cat": "community", "model": "Community + products", "status": "F", "url": "whop.com" }, { "name": "Bettermode", "cat": "community", "model": "Community platform", "status": "F", "url": "bettermode.com" }, { "name": "Disco", "cat": "community", "model": "Learning community", "status": "F", "url": "disco.co" }, { "name": "Hivebrite", "cat": "community", "model": "Community platform", "status": "F", "url": "hivebrite.com" }, { "name": "Patreon", "cat": "creator", "model": "Membership/subscriptions", "status": "F", "url": "patreon.com" }, { "name": "Ko-fi", "cat": "creator", "model": "Donations/memberships", "status": "F", "url": "ko-fi.com" }, { "name": "Buy Me a Coffee", "cat": "creator", "model": "Donations/memberships", "status": "F", "url": "buymeacoffee.com" }, { "name": "Substack", "cat": "creator", "model": "Newsletter/subscriptions", "status": "F", "url": "substack.com" }, { "name": "Ghost", "cat": "creator", "model": "Newsletter/memberships", "status": "F", "url": "ghost.org" }, { "name": "beehiiv", "cat": "creator", "model": "Newsletter platform", "status": "F", "url": "beehiiv.com" }, { "name": "Gumroad", "cat": "creator", "model": "Digital products", "status": "F", "url": "gumroad.com" }, { "name": "Payhip", "cat": "creator", "model": "Digital products", "status": "F", "url": "payhip.com" }, { "name": "Lemon Squeezy", "cat": "creator", "model": "Digital products", "status": "F", "url": "lemonsqueezy.com" }, { "name": "Fourthwall", "cat": "creator", "model": "Creator storefront", "status": "F", "url": "fourthwall.com" }, { "name": "Locals", "cat": "creator", "model": "Creator community", "status": "F", "url": "locals.com" }, { "name": "Memberful", "cat": "creator", "model": "Membership platform", "status": "F", "url": "memberful.com" }, { "name": "Teachable", "cat": "courses", "model": "Course platform", "status": "F", "url": "teachable.com" }, { "name": "Thinkific", "cat": "courses", "model": "Course platform", "status": "F", "url": "thinkific.com" }, { "name": "Kajabi", "cat": "courses", "model": "All-in-one platform", "status": "F", "url": "kajabi.com" }, { "name": "Podia", "cat": "courses", "model": "Course/community", "status": "F", "url": "podia.com" }, { "name": "LearnWorlds", "cat": "courses", "model": "Course platform", "status": "F", "url": "learnworlds.com" }, { "name": "Systeme.io", "cat": "courses", "model": "All-in-one", "status": "F", "url": "systeme.io" }, { "name": "Heights Platform", "cat": "courses", "model": "Course platform", "status": "F", "url": "heightsplatform.com" }, { "name": "Xperiencify", "cat": "courses", "model": "Gamified courses", "status": "F", "url": "xperiencify.com" }, { "name": "Medium", "cat": "writing", "model": "Partner program", "status": "D", "url": "medium.com" }, { "name": "Vocal Media", "cat": "writing", "model": "Paid writing", "status": "D", "url": "vocal.media" }, { "name": "Buttondown", "cat": "writing", "model": "Newsletter", "status": "F", "url": "buttondown.email" }, { "name": "Supercast", "cat": "podcast", "model": "Private podcast", "status": "F", "url": "supercast.com" }, { "name": "Podbean Patron", "cat": "podcast", "model": "Podcast subscriptions", "status": "F", "url": "podbean.com" }, { "name": "Buzzsprout", "cat": "podcast", "model": "Podcast hosting", "status": "F", "url": "buzzsprout.com" }, { "name": "Captivate", "cat": "podcast", "model": "Private podcasts", "status": "F", "url": "captivate.fm" }, { "name": "Transistor", "cat": "podcast", "model": "Private podcasts", "status": "F", "url": "transistor.fm" }, { "name": "Hello Audio", "cat": "podcast", "model": "Private audio", "status": "F", "url": "helloaudio.fm" }, { "name": "RedCircle", "cat": "podcast", "model": "Podcast subscriptions", "status": "F", "url": "redcircle.com" }, { "name": "Sellfy", "cat": "digital", "model": "Digital storefront", "status": "F", "url": "sellfy.com" }, { "name": "SendOwl", "cat": "digital", "model": "Digital delivery", "status": "F", "url": "sendowl.com" }, { "name": "ThriveCart", "cat": "digital", "model": "Cart/checkout", "status": "F", "url": "thrivecart.com" }, { "name": "SamCart", "cat": "digital", "model": "Cart/checkout", "status": "F", "url": "samcart.com" }, { "name": "Etsy", "cat": "digital", "model": "Digital resources", "status": "D", "url": "etsy.com" }, { "name": "Creative Market", "cat": "digital", "model": "Templates/journals", "status": "D", "url": "creativemarket.com" }, { "name": "Teachers Pay Teachers", "cat": "digital", "model": "Educational materials", "status": "D", "url": "teacherspayteachers.com" }, { "name": "Eventbrite", "cat": "events", "model": "Paid events", "status": "D,UK", "url": "eventbrite.co.uk" }, { "name": "Humanitix", "cat": "events", "model": "Ethical ticketing", "status": "D", "url": "humanitix.com" }, { "name": "Ticket Tailor", "cat": "events", "model": "Event ticketing", "status": "F,UK", "url": "tickettailor.com" }, { "name": "Luma", "cat": "events", "model": "Event platform", "status": "D/F", "url": "lu.ma" }, { "name": "Meetup", "cat": "events", "model": "Group events", "status": "D", "url": "meetup.com" }, { "name": "Crowdcast", "cat": "events", "model": "Online events", "status": "F", "url": "crowdcast.io" }, { "name": "Airmeet", "cat": "events", "model": "Virtual events", "status": "F", "url": "airmeet.com" }, { "name": "Butter", "cat": "events", "model": "Workshop platform", "status": "F", "url": "butter.us" }, { "name": "Demio", "cat": "events", "model": "Webinars", "status": "F", "url": "demio.com" }, { "name": "Paperbell", "cat": "booking", "model": "Coaching practice", "status": "F", "url": "paperbell.com" }, { "name": "CoachAccountable", "cat": "booking", "model": "Coaching platform", "status": "F", "url": "coachaccountable.com" }, { "name": "Simply.Coach", "cat": "booking", "model": "Coaching platform", "status": "F", "url": "simply.coach" }, { "name": "CoachVantage", "cat": "booking", "model": "Coaching platform", "status": "F", "url": "coachvantage.com" }, { "name": "Practice.do", "cat": "booking", "model": "Practice management", "status": "F", "url": "practice.do" }, { "name": "Coachli", "cat": "booking", "model": "Coaching platform", "status": "F", "url": "coachli.com" }, { "name": "UpCoach", "cat": "booking", "model": "Coaching platform", "status": "F", "url": "upcoach.com" }, { "name": "HoneyBook", "cat": "booking", "model": "Client management", "status": "F", "url": "honeybook.com" }, { "name": "Calendly", "cat": "booking", "model": "Scheduling + payments", "status": "F", "url": "calendly.com" }, { "name": "Cal.com", "cat": "booking", "model": "Open source scheduling", "status": "F", "url": "cal.com" }, { "name": "Acuity Scheduling", "cat": "booking", "model": "Scheduling", "status": "F", "url": "acuityscheduling.com" }, { "name": "SimplyBook.me", "cat": "booking", "model": "Booking system", "status": "F", "url": "simplybook.me" }, { "name": "Setmore", "cat": "booking", "model": "Booking system", "status": "F,UK", "url": "setmore.com" }, { "name": "YouCanBookMe", "cat": "booking", "model": "Booking system", "status": "F,UK", "url": "youcanbook.me" }, { "name": "TidyCal", "cat": "booking", "model": "Scheduling", "status": "F", "url": "tidycal.com" }, { "name": "Zoho Bookings", "cat": "booking", "model": "Booking system", "status": "F,UK", "url": "zoho.com/bookings" }, { "name": "Book Like A Boss", "cat": "booking", "model": "Booking + payments", "status": "F", "url": "booklikeaboss.com" }, { "name": "Appointy", "cat": "booking", "model": "Appointment scheduling", "status": "F", "url": "appointy.com" }, { "name": "10to8", "cat": "booking", "model": "Appointment scheduling", "status": "F,UK", "url": "10to8.com" }, { "name": "GoCardless", "cat": "booking", "model": "Recurring UK payments", "status": "F,UK", "url": "gocardless.com" }, { "name": "SumUp", "cat": "booking", "model": "Payment links", "status": "F,UK", "url": "sumup.com" }];
        for (var i = 0; i < PLATFORMS.length; i++) {
          if (PLATFORMS[i].name.toLowerCase().replace(/[^a-z0-9]/g, "-") === platformName.toLowerCase().replace(/[^a-z0-9]/g, "-") || PLATFORMS[i].name.toLowerCase() === platformName.toLowerCase()) {
            platformData = PLATFORMS[i];
            break;
          }
        }
        var signupUrl = platformData ? "https://" + platformData.url : body.signupUrl || "https://" + platformName + ".com/signup";
        if (!browserlessKey) {
          return json({
            success: true,
            platform: platformName,
            status: "manual_required",
            signupUrl,
            profile,
            instructions: "Visit " + signupUrl + " and use the profile data below to complete signup."
          }, 200, origin);
        }
        var screenshotResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: signupUrl, options: { type: "jpeg", quality: 60, fullPage: false } })
        });
        var pageAnalysis = "Could not load page";
        if (screenshotResp.ok) {
          var screenshotBuf = await screenshotResp.arrayBuffer();
          var screenshotB64 = btoa(String.fromCharCode(...new Uint8Array(screenshotBuf)));
          var kvRaw = null;
          try {
            kvRaw = await env.PRISM_KV.get("__secrets__");
          } catch (e) {
          }
          var kvSecrets = {};
          if (kvRaw) {
            try {
              kvSecrets = JSON.parse(kvRaw);
            } catch (e) {
            }
          }
          var envPlus = new Proxy(env, {
            get: /* @__PURE__ */ __name(function(target, prop) {
              if (target[prop] !== void 0) return target[prop];
              if (kvSecrets[prop] !== void 0) return kvSecrets[prop];
              if (kvSecrets[prop.toUpperCase()] !== void 0) return kvSecrets[prop.toUpperCase()];
              if (kvSecrets[prop.toLowerCase()] !== void 0) return kvSecrets[prop.toLowerCase()];
              return void 0;
            }, "get")
          });
          var analysisResult = await callGemini(envPlus, [
            { role: "system", content: "You are an expert at web automation. Analyse signup page screenshots and generate precise Puppeteer instructions to fill in forms. Return a JSON object with: {steps: [{action, selector, value, description}], notes: string}" },
            { role: "user", content: "Analyse this signup page for " + platformName + " and generate Puppeteer steps to fill in the signup form with this profile: " + JSON.stringify({ email: profile.email, name: profile.displayName, bio: profile.shortBio, website: profile.website }) + ". Return JSON only." }
          ], "gemini-2.5-flash", [{ data: "data:image/jpeg;base64," + screenshotB64, mimeType: "image/jpeg" }]);
          pageAnalysis = analysisResult;
        }
        var steps = [];
        try {
          var parsed = JSON.parse(pageAnalysis.match(/\{[\s\S]*\}/)[0]);
          steps = parsed.steps || [];
        } catch (e) {
          steps = [
            { action: "type", selector: 'input[type="email"], input[name="email"], #email', value: profile.email, description: "Fill email" },
            { action: "type", selector: 'input[name="name"], input[name="displayName"], #name, #display_name', value: profile.displayName, description: "Fill name" },
            { action: "type", selector: 'input[name="password"], input[type="password"]', value: profile.password, description: "Fill password" },
            { action: "type", selector: 'textarea[name="bio"], textarea[name="description"], #bio', value: profile.shortBio, description: "Fill bio" },
            { action: "type", selector: 'input[name="website"], input[name="url"], #website', value: profile.website, description: "Fill website" }
          ];
        }
        var puppeteerCode = "module.exports = async ({ page }) => {\n";
        puppeteerCode += "  const results = [];\n";
        puppeteerCode += "  await page.goto(" + JSON.stringify(signupUrl) + ', {waitUntil:"networkidle2", timeout:30000});\n';
        puppeteerCode += "  await page.waitForTimeout(2000);\n";
        steps.forEach(function(step) {
          if (step.action === "type" && step.selector && step.value) {
            puppeteerCode += "  try {\n";
            puppeteerCode += "    const el = await page.$(" + JSON.stringify(step.selector) + ");\n";
            puppeteerCode += "    if (el) { await el.click({clickCount:3}); await el.type(" + JSON.stringify(step.value) + "); results.push({done:" + JSON.stringify(step.description || step.selector) + "}); }\n";
            puppeteerCode += "  } catch(e) { results.push({skip:" + JSON.stringify(step.description || step.selector) + ", reason:e.message}); }\n";
          } else if (step.action === "click" && step.selector) {
            puppeteerCode += "  try {\n";
            puppeteerCode += "    await page.click(" + JSON.stringify(step.selector) + ");\n";
            puppeteerCode += "    await page.waitForTimeout(1000);\n";
            puppeteerCode += "    results.push({clicked:" + JSON.stringify(step.description || step.selector) + "});\n";
            puppeteerCode += "  } catch(e) { results.push({skip:" + JSON.stringify(step.description || step.selector) + ", reason:e.message}); }\n";
          }
        });
        puppeteerCode += "  const url = page.url();\n";
        puppeteerCode += "  return {results, finalUrl:url, platform:" + JSON.stringify(platformName) + "};\n";
        puppeteerCode += "};\n";
        var execResp = await fetch("https://chrome.browserless.io/function?token=" + browserlessKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: puppeteerCode })
        });
        var execResult = { status: "attempted" };
        if (execResp.ok) {
          execResult = await execResp.json();
        }
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("signup:" + platformName, JSON.stringify({
            platform: platformName,
            email: profile.email,
            status: execResult.finalUrl ? "form_submitted" : "attempted",
            result: execResult,
            aiSteps: steps.length,
            created: (/* @__PURE__ */ new Date()).toISOString()
          }));
        }
        return json({
          success: true,
          platform: platformName,
          signupUrl,
          status: execResult.finalUrl ? "form_submitted" : "attempted",
          stepsExecuted: steps.length,
          result: execResult,
          note: "Check hello@identitypartners.uk for verification emails. Some platforms require manual email confirmation."
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message, platform: body.platform }, 500, origin);
      }
    }
    if (path === "/api/headless/status" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ signups: [] }, 200, origin);
        var list = await env.PRISM_KV.list({ prefix: "signup:" });
        var signups = [];
        for (var i = 0; i < list.keys.length; i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) {
            var s = JSON.parse(val);
            signups.push({ platform: s.platform, email: s.email, status: s.status, created: s.created });
          }
        }
        return json({ signups: signups.sort(function(a, b) {
          return new Date(b.created) - new Date(a.created);
        }) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/headless/signup-old" && request.method === "POST") {
      try {
        var body = await request.json();
        var platform = body.platform;
        var email = body.email || "hello@identitypartners.uk";
        var name = body.name || "Identity Partners";
        var bio = body.bio || "Evidence-based support for addiction, trauma, and mental health. Based in the UK.";
        var website = body.website || "https://identitypartners.uk";
        var PLATFORM_CONFIGS = {
          "ko-fi": {
            signupUrl: "https://ko-fi.com/account/register",
            fields: { email, name, username: "identitypartners" },
            postUrl: "https://ko-fi.com/api/posts",
            method: "api"
          },
          "substack": {
            signupUrl: "https://substack.com/account/signup",
            fields: { email, name, subdomain: "identitypartners" },
            postUrl: "https://identitypartners.substack.com/api/v1/posts",
            method: "api"
          },
          "medium": {
            signupUrl: "https://medium.com/m/signin",
            fields: { email },
            method: "oauth"
          },
          "reddit": {
            signupUrl: "https://www.reddit.com/register",
            fields: { email, username: "IdentityPartners", password: "auto-generate" },
            method: "api"
          },
          "quora": {
            signupUrl: "https://www.quora.com/signup",
            fields: { email, name },
            method: "headless"
          },
          "pinterest": {
            signupUrl: "https://www.pinterest.co.uk/business/create/",
            fields: { email, name, website },
            method: "headless"
          },
          "tiktok": {
            signupUrl: "https://www.tiktok.com/signup",
            fields: { email },
            method: "headless"
          },
          "youtube": {
            signupUrl: "https://accounts.google.com/signup",
            fields: { email },
            method: "oauth"
          },
          "spotify-podcasters": {
            signupUrl: "https://podcasters.spotify.com/pod/signup",
            fields: { email, name },
            method: "headless"
          },
          "patreon": {
            signupUrl: "https://www.patreon.com/signup",
            fields: { email, name },
            method: "oauth"
          },
          "gumroad": {
            signupUrl: "https://app.gumroad.com/signup",
            fields: { email, name },
            method: "api"
          },
          "buymeacoffee": {
            signupUrl: "https://www.buymeacoffee.com/signup",
            fields: { email, name, username: "identitypartners" },
            method: "headless"
          },
          "teachable": {
            signupUrl: "https://app.teachable.com/users/sign_up",
            fields: { email, name },
            method: "api"
          },
          "podchaser": {
            signupUrl: "https://www.podchaser.com/signup",
            fields: { email, name },
            method: "headless"
          },
          "academia": {
            signupUrl: "https://www.academia.edu/signup",
            fields: { email, name },
            method: "headless"
          },
          "researchgate": {
            signupUrl: "https://www.researchgate.net/signup",
            fields: { email, name },
            method: "headless"
          }
        };
        var config = PLATFORM_CONFIGS[platform];
        if (!config) return json({ success: false, error: "Platform not supported: " + platform }, 200, origin);
        var signupRecord = {
          platform,
          email,
          name,
          bio,
          website,
          config,
          status: "pending",
          created: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (env.PRISM_KV) await env.PRISM_KV.put("signup:" + platform, JSON.stringify(signupRecord));
        if (config.method === "api") {
          return json({
            success: true,
            platform,
            method: "api",
            signupUrl: config.signupUrl,
            instructions: "Visit " + config.signupUrl + " with email " + email,
            status: "pending_manual"
          }, 200, origin);
        }
        return json({
          success: true,
          platform,
          method: config.method,
          signupUrl: config.signupUrl,
          fields: config.fields,
          instructions: "Automated signup queued. Visit " + config.signupUrl + " to complete if automation fails.",
          status: "queued"
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/headless/post-to-platform" && request.method === "POST") {
      try {
        var body = await request.json();
        var platform = body.platform;
        var content = body.content || "";
        var mediaUrl = body.mediaUrl || null;
        var creds = null;
        if (env.PRISM_KV) {
          var c = await env.PRISM_KV.get("platform:creds:" + platform);
          if (c) creds = JSON.parse(c);
        }
        if (platform === "bluesky") {
          var text = content.length > 300 ? content.substring(0, 297) + "..." : content;
          var result = await postToBluesky(env, text);
          return json({ success: true, platform: "bluesky", result }, 200, origin);
        }
        if (platform === "x" || platform === "twitter") {
          var xTokens = null;
          if (env.PRISM_KV) {
            var xt = await env.PRISM_KV.get("oauth:x:tokens");
            if (xt) xTokens = JSON.parse(xt);
          }
          if (!xTokens || !xTokens.access_token) return json({ success: false, error: "X not connected. Visit /oauth/x/ to connect." }, 200, origin);
          var xText = content.length > 280 ? content.substring(0, 277) + "..." : content;
          var xResp = await fetch("https://api.twitter.com/2/tweets", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + xTokens.access_token },
            body: JSON.stringify({ text: xText })
          });
          var xData = await xResp.json();
          return json({ success: xResp.ok, platform: "x", result: xData }, 200, origin);
        }
        if (platform === "linkedin") {
          var liTokens = null;
          if (env.PRISM_KV) {
            var lt = await env.PRISM_KV.get("oauth:linkedin:tokens");
            if (lt) liTokens = JSON.parse(lt);
          }
          if (!liTokens || !liTokens.access_token) return json({ success: false, error: "LinkedIn not connected. Visit /oauth/linkedin/ to connect." }, 200, origin);
          var meResp = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { "Authorization": "Bearer " + liTokens.access_token } });
          var meData = await meResp.json();
          var liResp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + liTokens.access_token, "X-Restli-Protocol-Version": "2.0.0" },
            body: JSON.stringify({ author: "urn:li:person:" + meData.sub, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: content }, shareMediaCategory: "NONE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } })
          });
          var liData = await liResp.json();
          return json({ success: liResp.ok, platform: "linkedin", result: liData }, 200, origin);
        }
        var queueId = "headless:queue:" + Date.now();
        if (env.PRISM_KV) await env.PRISM_KV.put(queueId, JSON.stringify({
          id: queueId,
          platform,
          content,
          mediaUrl,
          status: "queued",
          created: (/* @__PURE__ */ new Date()).toISOString()
        }));
        return json({
          success: true,
          platform,
          status: "queued",
          message: "Post queued for " + platform + ". Connect via Platform Manager to enable direct posting.",
          queueId
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/headless/queue" && request.method === "GET") {
      if (!env.PRISM_KV) return json({ queue: [] }, 200, origin);
      var list = await env.PRISM_KV.list({ prefix: "headless:queue:" });
      var queue = [];
      for (var i = 0; i < list.keys.length; i++) {
        var val = await env.PRISM_KV.get(list.keys[i].name);
        if (val) queue.push(JSON.parse(val));
      }
      return json({ queue: queue.sort(function(a, b) {
        return new Date(b.created) - new Date(a.created);
      }) }, 200, origin);
    }
    if (path === "/api/browserless/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var platform = body.platform;
        var postText = body.text || "";
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO || env.BROWSERLESS_KEY;
        if (!browserlessKey) return json({ success: false, error: "BROWSERLESS.IO key not configured" }, 200, origin);
        var scripts = {
          "tumblr": /* @__PURE__ */ __name(async function() {
            var tKey2 = env.TUMBLR_API_KEY || env.tumblr_api_key;
            var tSecret = env.TUMBLR_API_SECRET || env.tumblr_api_secret;
            var tToken = env.TUMBLR_TOKEN || env.tumblr_token;
            var tTokenSecret = env.TUMBLR_TOKEN_SECRET || env.tumblr_token_secret;
            var blogName = env.TUMBLR_BLOG || "identitypartners";
            if (!tToken) return { success: false, error: "Tumblr not connected. Add TUMBLR_TOKEN via ingester." };
            return { success: false, error: "Tumblr OAuth 1.0a -- use Buffer or Twitterflow for X/Tumblr cross-posting" };
          }, "tumblr"),
          "reddit": /* @__PURE__ */ __name(async function() {
            var rToken = env.REDDIT_ACCESS_TOKEN || env.reddit_access_token;
            var subreddit2 = body.subreddit || "mentalhealth";
            if (!rToken) return { success: false, error: "Reddit not connected. Add REDDIT_ACCESS_TOKEN via ingester." };
            var resp2 = await fetch("https://oauth.reddit.com/api/submit", {
              method: "POST",
              headers: { "Authorization": "Bearer " + rToken, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Argentica/1.0" },
              body: "sr=" + subreddit2 + "&kind=self&title=" + encodeURIComponent(postText.substring(0, 300)) + "&text=" + encodeURIComponent(postText) + "&resubmit=true"
            });
            var data2 = await resp2.json();
            return { success: resp2.ok, data: data2 };
          }, "reddit"),
          "discord": /* @__PURE__ */ __name(async function() {
            var webhookUrl2 = env.DISCORD_WEBHOOK || env.discord_webhook;
            if (!webhookUrl2) return { success: false, error: "Discord webhook not configured. Add DISCORD_WEBHOOK via ingester." };
            var resp2 = await fetch(webhookUrl2, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: postText, username: "Identity Partners" })
            });
            return { success: resp2.ok, status: resp2.status };
          }, "discord"),
          "whop": /* @__PURE__ */ __name(async function() {
            var whopKey4 = env.WHOP_API_KEY || env.whop_api_key;
            var whopCompany = env.WHOP_COMPANY_ID || env.whop_company_id;
            if (!whopKey4) return { success: false, error: "Whop not connected. Add WHOP_API_KEY via ingester." };
            var resp2 = await fetch("https://api.whop.com/api/v2/posts", {
              method: "POST",
              headers: { "Authorization": "Bearer " + whopKey4, "Content-Type": "application/json" },
              body: JSON.stringify({ company_id: whopCompany, body: postText, visibility: "public" })
            });
            var data2 = await resp2.json();
            return { success: resp2.ok, data: data2 };
          }, "whop")
        };
        var headlessPlatforms = ["pinterest", "tiktok", "quora", "buymeacoffee", "academia", "researchgate"];
        if (headlessPlatforms.includes(platform)) {
          var browserlessResp = await fetch("https://chrome.browserless.io/function?token=" + browserlessKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: `
                module.exports = async ({ page }) => {
                  // Platform-specific automation would go here
                  // For now, return the post URL for manual completion
                  return { platform: '${platform}', text: ${JSON.stringify(postText.substring(0, 500))}, status: 'queued' };
                };
              `,
              context: { platform, text: postText }
            })
          });
          if (browserlessResp.ok) {
            var bData = await browserlessResp.json();
            if (env.PRISM_KV) await env.PRISM_KV.put("headless:queue:" + Date.now(), JSON.stringify({
              platform,
              content: postText,
              status: "queued_browserless",
              created: (/* @__PURE__ */ new Date()).toISOString()
            }));
            return json({ success: true, platform, status: "queued", data: bData }, 200, origin);
          }
          return json({ success: false, error: "Browserless failed: " + browserlessResp.status }, 200, origin);
        }
        var scriptFn = scripts[platform];
        if (scriptFn) {
          var result = await scriptFn();
          return json(result, 200, origin);
        }
        return json({ success: false, error: "Platform not supported: " + platform }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/tumblr/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var token = env.TUMBLR_TOKEN || env.tumblr_token;
        var blog = env.TUMBLR_BLOG || "identitypartners";
        if (!token) return json({ success: false, error: "Add TUMBLR_TOKEN via ingester. Get it at tumblr.com/oauth/apps" }, 200, origin);
        var resp = await fetch("https://api.tumblr.com/v2/blog/" + blog + "/posts", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ content: [{ type: "text", text: body.text }], state: "published" })
        });
        var data = await resp.json();
        return json({ success: resp.ok, data }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/discord/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var webhookUrl = env.DISCORD_WEBHOOK || env.discord_webhook;
        if (!webhookUrl) return json({ success: false, error: "Add DISCORD_WEBHOOK via ingester. Create a webhook in your Discord server settings." }, 200, origin);
        var resp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: body.text, username: "Identity Partners", avatar_url: "https://prism.identitypartners.uk/shared/logo.png" })
        });
        return json({ success: resp.ok, status: resp.status }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/whop/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var key = env.WHOP_API_KEY || env.whop_api_key;
        var companyId = env.WHOP_COMPANY_ID || env.whop_company_id;
        if (!key) return json({ success: false, error: "Add WHOP_API_KEY via ingester. Get it at whop.com/settings/developer" }, 200, origin);
        var resp = await fetch("https://api.whop.com/api/v2/posts", {
          method: "POST",
          headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: companyId, body: body.text, visibility: "public" })
        });
        var data = await resp.json();
        return json({ success: resp.ok, data }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/reddit/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var token = env.REDDIT_ACCESS_TOKEN || env.reddit_access_token;
        if (!token) return json({ success: false, error: "Add REDDIT_ACCESS_TOKEN via ingester. Create app at reddit.com/prefs/apps" }, 200, origin);
        var subreddit = body.subreddit || "mentalhealth";
        var resp = await fetch("https://oauth.reddit.com/api/submit", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Argentica/1.0 by IdentityPartners" },
          body: "sr=" + encodeURIComponent(subreddit) + "&kind=self&title=" + encodeURIComponent((body.title || body.text).substring(0, 300)) + "&text=" + encodeURIComponent(body.text) + "&resubmit=true&nsfw=false&spoiler=false"
        });
        var data = await resp.json();
        return json({ success: resp.ok, data }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/browserless/screenshot" && request.method === "POST") {
      try {
        var body = await request.json();
        var key = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!key) return json({ error: "BROWSERLESS.IO key not configured" }, 400, origin);
        var resp = await fetch("https://chrome.browserless.io/screenshot?token=" + key, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: body.url, options: { fullPage: true, type: "png" } })
        });
        if (!resp.ok) return json({ error: "Screenshot failed: " + resp.status }, 500, origin);
        var buf = await resp.arrayBuffer();
        var b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return json({ success: true, screenshot: "data:image/png;base64," + b64 }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/buffer/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var bufferKey = env.BUFFER_API_KEY || env.buffer_api_key || env.BUFFER_KEY;
        if (!bufferKey) return json({ success: false, error: "Add BUFFER_API_KEY via ingester. Get it at buffer.com/developers" }, 200, origin);
        var text = body.text || "";
        var profileIds = body.profile_ids || [];
        var mediaUrl = body.media_url || null;
        var scheduledAt = body.scheduled_at || null;
        if (profileIds.length === 0) {
          var profilesResp = await fetch("https://api.bufferapp.com/1/profiles.json?access_token=" + bufferKey);
          if (profilesResp.ok) {
            var profiles = await profilesResp.json();
            profileIds = profiles.map(function(p) {
              return p.id;
            });
          }
        }
        if (profileIds.length === 0) return json({ success: false, error: "No Buffer profiles connected. Connect your social accounts at buffer.com" }, 200, origin);
        var updateBody = "text=" + encodeURIComponent(text) + "&access_token=" + bufferKey + "&now=" + (scheduledAt ? "false" : "true");
        profileIds.forEach(function(id2) {
          updateBody += "&profile_ids[]=" + id2;
        });
        if (scheduledAt) updateBody += "&scheduled_at=" + encodeURIComponent(scheduledAt);
        if (mediaUrl) updateBody += "&media[link]=" + encodeURIComponent(mediaUrl);
        var updateResp = await fetch("https://api.bufferapp.com/1/updates/create.json", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: updateBody
        });
        var updateData = await updateResp.json();
        if (!updateResp.ok) return json({ success: false, error: "Buffer error: " + JSON.stringify(updateData) }, 200, origin);
        return json({ success: true, updates: updateData.updates, profileCount: profileIds.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/buffer/profiles" && request.method === "GET") {
      try {
        var bufferKey = env.BUFFER_API_KEY || env.buffer_api_key || env.BUFFER_KEY;
        if (!bufferKey) return json({ profiles: [], error: "BUFFER_API_KEY not configured" }, 200, origin);
        var resp = await fetch("https://api.bufferapp.com/1/profiles.json?access_token=" + bufferKey);
        if (!resp.ok) return json({ profiles: [], error: "Buffer API error: " + resp.status }, 200, origin);
        var profiles = await resp.json();
        return json({ profiles: profiles.map(function(p) {
          return { id: p.id, service: p.service, name: p.formatted_username, avatar: p.avatar_https };
        }) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/buffer/schedule" && request.method === "POST") {
      try {
        var body = await request.json();
        var bufferKey = env.BUFFER_API_KEY || env.buffer_api_key || env.BUFFER_KEY;
        if (!bufferKey) return json({ success: false, error: "BUFFER_API_KEY not configured" }, 200, origin);
        var profileIds = body.profile_ids || [];
        if (profileIds.length === 0) {
          var pr = await fetch("https://api.bufferapp.com/1/profiles.json?access_token=" + bufferKey);
          if (pr.ok) {
            var prData = await pr.json();
            profileIds = prData.map(function(p) {
              return p.id;
            });
          }
        }
        var updateBody = "text=" + encodeURIComponent(body.text || "") + "&access_token=" + bufferKey + "&now=false";
        profileIds.forEach(function(id2) {
          updateBody += "&profile_ids[]=" + id2;
        });
        if (body.scheduled_at) updateBody += "&scheduled_at=" + encodeURIComponent(body.scheduled_at);
        var resp = await fetch("https://api.bufferapp.com/1/updates/create.json", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: updateBody });
        var data = await resp.json();
        return json({ success: resp.ok, data }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/zoho/status" && request.method === "GET") {
      var status = {};
      if (env.PRISM_KV) {
        for (var svc of ["mail", "calendar", "crm", "social"]) {
          var t = await env.PRISM_KV.get("zoho:tokens:" + svc);
          status[svc] = t ? { connected: true } : { connected: false };
        }
      }
      return json({ status }, 200, origin);
    }
    if (path === "/api/podcast/generate-audio" && request.method === "POST") {
      try {
        var body = await request.json();
        var script = body.script || "";
        var voice = body.voice || "rachel";
        var provider = body.provider || "elevenlabs";
        if (!script) return json({ error: "No script provided" }, 400, origin);
        var chunk = script.substring(0, 4e3);
        if (provider === "elevenlabs") {
          var elKey = env.ELEVENLABS_API_KEY || env.elevenlabs_api_key;
          if (!elKey) return json({ error: "ElevenLabs API key not configured. Add ELEVENLABS_API_KEY via ingester." }, 200, origin);
          var voicesResp = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": elKey } });
          var voicesData = await voicesResp.json();
          var voices = voicesData.voices || [];
          var selectedVoice = voices.find(function(v2) {
            return v2.name.toLowerCase() === voice.toLowerCase();
          }) || voices[0];
          if (!selectedVoice) return json({ error: "No voices available" }, 200, origin);
          var ttsResp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + selectedVoice.voice_id, {
            method: "POST",
            headers: { "xi-api-key": elKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
            body: JSON.stringify({ text: chunk, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
          });
          if (!ttsResp.ok) return json({ error: "ElevenLabs error: " + ttsResp.status }, 200, origin);
          var buf = await ttsResp.arrayBuffer();
          var b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return json({ success: true, provider: "elevenlabs", voice: selectedVoice.name, audioBase64: b64, note: script.length > 4e3 ? "Script truncated to 4000 chars" : "Full script generated" }, 200, origin);
        }
        if (provider === "cartesia") {
          var cartKey = env.CARTESIA_API_KEY || env.cartesia_api_key;
          if (!cartKey) return json({ error: "Cartesia API key not configured" }, 200, origin);
          var cartResp = await fetch("https://api.cartesia.ai/tts/bytes", {
            method: "POST",
            headers: { "X-API-Key": cartKey, "Content-Type": "application/json", "Cartesia-Version": "2024-06-10" },
            body: JSON.stringify({ transcript: chunk, model_id: "sonic-english", voice: { mode: "id", id: "a0e99841-438c-4a64-b679-ae501e7d6091" }, output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 } })
          });
          if (!cartResp.ok) return json({ error: "Cartesia error: " + cartResp.status }, 200, origin);
          var cartBuf = await cartResp.arrayBuffer();
          var cartB64 = btoa(String.fromCharCode(...new Uint8Array(cartBuf)));
          return json({ success: true, provider: "cartesia", audioBase64: cartB64 }, 200, origin);
        }
        return json({ error: "Unknown provider: " + provider }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/podcast/voices" && request.method === "GET") {
      try {
        var elKey = env.ELEVENLABS_API_KEY || env.elevenlabs_api_key;
        if (!elKey) return json({ voices: [], error: "ElevenLabs not configured" }, 200, origin);
        var resp = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": elKey } });
        var data = await resp.json();
        return json({ voices: (data.voices || []).map(function(v2) {
          return { id: v2.voice_id, name: v2.name, category: v2.category };
        }) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/social/queue/") && request.method === "DELETE") {
      var qid = path.slice(18);
      if (env.PRISM_KV) await env.PRISM_KV.delete("queue:" + qid);
      return json({ success: true }, 200, origin);
    }
    if (path.startsWith("/api/social/queue/") && request.method === "PATCH") {
      var qid = path.slice(18);
      try {
        var body = await request.json();
        if (env.PRISM_KV) {
          var existing = await env.PRISM_KV.get("queue:" + qid);
          if (existing) {
            var item = JSON.parse(existing);
            Object.assign(item, body);
            await env.PRISM_KV.put("queue:" + qid, JSON.stringify(item));
          }
        }
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/research/scheduled" && request.method === "POST") {
      try {
        var body = await request.json();
        var keywords = body.keywords || [];
        var sources = body.sources || ["tavily", "semantic_scholar", "pubmed", "exa"];
        var profile = body.profile || "research";
        if (keywords.length === 0) return json({ error: "No keywords provided" }, 400, origin);
        var kvRaw = null;
        try {
          kvRaw = await env.PRISM_KV.get("__secrets__");
        } catch (e) {
        }
        var kvSecrets = {};
        if (kvRaw) {
          try {
            kvSecrets = JSON.parse(kvRaw);
          } catch (e) {
          }
        }
        var envPlus = new Proxy(env, {
          get: /* @__PURE__ */ __name(function(target, prop) {
            if (target[prop] !== void 0) return target[prop];
            if (kvSecrets[prop] !== void 0) return kvSecrets[prop];
            if (kvSecrets[prop.toUpperCase()] !== void 0) return kvSecrets[prop.toUpperCase()];
            if (kvSecrets[prop.toLowerCase()] !== void 0) return kvSecrets[prop.toLowerCase()];
            return void 0;
          }, "get")
        });
        var keywordOptResult = await orchestrate(envPlus, [
          { role: "system", content: "You are a research keyword optimiser. Given a list of research topics, generate an optimised set of search queries that will find the most relevant academic and professional sources. Include Boolean operators, synonyms, and related terms. Return as a JSON array of query strings only." },
          { role: "user", content: "Optimise these research keywords for academic search: " + keywords.join(", ") }
        ], "fast", "research", null);
        var optimisedQueries = keywords;
        try {
          var m = keywordOptResult.content.match(/\[\s*[\s\S]*?\]/);
          if (m) optimisedQueries = JSON.parse(m[0]);
        } catch (e) {
        }
        var allResults = [];
        var searchPromises = optimisedQueries.slice(0, 5).map(function(query2) {
          var promises2 = [];
          if (sources.includes("tavily")) promises2.push(searchTavily(envPlus, query2).then(function(r2) {
            r2.forEach(function(i2) {
              i2._query = query2;
              i2._source = "tavily";
              allResults.push(i2);
            });
          }));
          if (sources.includes("semantic_scholar")) promises2.push(searchSemanticScholar(envPlus, query2).then(function(r2) {
            r2.forEach(function(i2) {
              i2._query = query2;
              allResults.push(i2);
            });
          }));
          if (sources.includes("pubmed")) promises2.push(searchPubMed(envPlus, query2).then(function(r2) {
            r2.forEach(function(i2) {
              i2._query = query2;
              allResults.push(i2);
            });
          }));
          if (sources.includes("exa")) promises2.push(searchExa(envPlus, query2).then(function(r2) {
            r2.forEach(function(i2) {
              i2._query = query2;
              allResults.push(i2);
            });
          }));
          if (sources.includes("crossref")) promises2.push(searchCrossref(envPlus, query2).then(function(r2) {
            r2.forEach(function(i2) {
              i2._query = query2;
              allResults.push(i2);
            });
          }));
          return Promise.allSettled(promises2);
        });
        await Promise.allSettled(searchPromises);
        var seen = {};
        allResults = allResults.filter(function(r2) {
          var url4 = r2.url || r2.link || "";
          if (seen[url4]) return false;
          seen[url4] = true;
          return true;
        });
        var synthesis = null;
        if (allResults.length > 0) {
          var context = allResults.slice(0, 20).map(function(r2, i2) {
            return i2 + 1 + ". " + (r2.title || "") + "\n" + (r2.url || "") + "\n" + (r2.content || r2.snippet || "").substring(0, 300);
          }).join("\n\n");
          var synthResult = await orchestrate(envPlus, [
            { role: "system", content: "You are Toby, a research associate specialising in addiction, trauma, mental health, and social policy. Synthesise these search results into a structured research brief. British English. Label inferences. Cite sources by number." },
            { role: "user", content: "Synthesise these results for the keywords: " + keywords.join(", ") + "\n\n" + context }
          ], "reasoning", "research", null);
          synthesis = synthResult.content;
        }
        var runId = "research:run:" + Date.now();
        var run = {
          id: runId,
          keywords,
          optimisedQueries,
          sources,
          resultCount: allResults.length,
          results: allResults.slice(0, 50),
          synthesis,
          created: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (env.PRISM_KV) await env.PRISM_KV.put(runId, JSON.stringify(run));
        return json({
          success: true,
          runId,
          keywords,
          optimisedQueries,
          resultCount: allResults.length,
          synthesis,
          results: allResults.slice(0, 20)
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/research/runs" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ runs: [] }, 200, origin);
        var list = await env.PRISM_KV.list({ prefix: "research:run:" });
        var runs = [];
        for (var i = 0; i < Math.min(list.keys.length, 20); i++) {
          var val = await env.PRISM_KV.get(list.keys[i].name);
          if (val) {
            var run = JSON.parse(val);
            runs.push({ id: run.id, keywords: run.keywords, resultCount: run.resultCount, created: run.created });
          }
        }
        return json({ runs: runs.sort(function(a, b) {
          return new Date(b.created) - new Date(a.created);
        }) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/research/keywords" && request.method === "POST") {
      try {
        var body = await request.json();
        var keywords = body.keywords || [];
        var schedule = body.schedule || "weekly";
        if (env.PRISM_KV) await env.PRISM_KV.put("research:keywords", JSON.stringify({ keywords, schedule, updated: (/* @__PURE__ */ new Date()).toISOString() }));
        return json({ success: true, keywords }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/research/keywords" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ keywords: [] }, 200, origin);
        var stored = await env.PRISM_KV.get("research:keywords");
        return json(stored ? JSON.parse(stored) : { keywords: [] }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/worksheet/pdf" && request.method === "POST") {
      try {
        var body = await request.json();
        var content = body.content || "";
        var title = body.title || "Identity Partners Worksheet";
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!browserlessKey) {
          return json({ error: "Browserless.io key required for PDF generation. Add BROWSERLESS.IO via ingester." }, 200, origin);
        }
        var html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@300;400;500;600&family=Merriweather:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; color: #1a1a1a; background: #fff; padding: 40px 50px; }
  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; border-bottom: 3px solid #0f3b3a; margin-bottom: 30px; }
  .logo-area { display: flex; flex-direction: column; }
  .logo-name { font-family: 'Playfair Display', serif; font-size: 22px; color: #0f3b3a; font-weight: 600; }
  .logo-name span { color: #5c2d3f; }
  .logo-tagline { font-size: 10px; color: #a88792; margin-top: 3px; letter-spacing: 0.05em; }
  .contact-info { text-align: right; font-size: 11px; color: #7a4254; line-height: 1.6; }
  .doc-title { font-family: 'Playfair Display', serif; font-size: 26px; color: #0f3b3a; margin-bottom: 8px; font-weight: 600; }
  .doc-date { font-size: 11px; color: #a88792; margin-bottom: 30px; }
  .content { font-size: 13px; line-height: 1.8; color: #333; }
  .content h1 { font-family: 'Playfair Display', serif; font-size: 20px; color: #0f3b3a; margin: 24px 0 10px; font-weight: 600; }
  .content h2 { font-family: 'Playfair Display', serif; font-size: 17px; color: #5c2d3f; margin: 20px 0 8px; font-weight: 600; }
  .content h3 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; color: #0f3b3a; }
  .content p { margin-bottom: 10px; }
  .content ul, .content ol { margin: 8px 0 12px 20px; }
  .content li { margin-bottom: 5px; }
  .content blockquote { border-left: 3px solid #0f3b3a; padding: 8px 16px; background: #e8f4f4; margin: 12px 0; font-style: italic; color: #0f3b3a; border-radius: 0 6px 6px 0; }
  .write-here { border-bottom: 1px solid #ddd0c8; min-height: 36px; margin: 6px 0 12px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 2px solid #0f3b3a; display: flex; justify-content: space-between; font-size: 10px; color: #a88792; }
  .footer-logo { font-family: 'Playfair Display', serif; font-size: 12px; color: #0f3b3a; }
  .footer-logo span { color: #5c2d3f; }
  @media print { body { padding: 20px 30px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <div class="logo-name">Identity<span>Partners</span></div>
      <div class="logo-tagline">Understand your past . Appreciate the present . Define your future</div>
    </div>
    <div class="contact-info">
      www.identitypartners.uk<br>
      hello@identitypartners.uk<br>
      @identitypartners
    </div>
  </div>
  <div class="doc-title">${title}</div>
  <div class="doc-date">Date: _________________ &nbsp;&nbsp; Name: _________________</div>
  <div class="content">${content.replace(/\[Write here\.\.\.\]/g, '<div class="write-here"></div>').replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
  <div class="footer">
    <div class="footer-logo">Identity<span>Partners</span></div>
    <div>This worksheet is for personal reflection only. Not a clinical document.</div>
    <div>www.identitypartners.uk</div>
  </div>
</body>
</html>`;
        var pdfResp = await fetch("https://chrome.browserless.io/pdf?token=" + browserlessKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html,
            options: {
              format: "A4",
              margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
              printBackground: true
            }
          })
        });
        if (!pdfResp.ok) {
          return json({ error: "PDF generation failed: " + pdfResp.status }, 200, origin);
        }
        var pdfBuffer = await pdfResp.arrayBuffer();
        var pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));
        var pdfKey = "worksheet-" + Date.now() + ".pdf";
        if (env.PRISM_ASSETS) {
          await env.PRISM_ASSETS.put(pdfKey, pdfBuffer, { httpMetadata: { contentType: "application/pdf" } });
        }
        return json({
          success: true,
          pdfBase64,
          pdfKey,
          size: pdfBuffer.byteLength
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/profile/signup" && request.method === "POST") {
      try {
        var body = await request.json();
        if (env.PRISM_KV) await env.PRISM_KV.put("profile:signup", JSON.stringify(body));
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/profile/signup" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ profile: null }, 200, origin);
        var stored = await env.PRISM_KV.get("profile:signup");
        return json({ profile: stored ? JSON.parse(stored) : null }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/test-cerebras" && request.method === "POST") {
      try {
        var keys = [
          env.CEREBRAS_PAID_1,
          env.CEREBRAS_PAID_2,
          env.cerebras_api_key,
          env.CEREBRAS_API_KEY,
          env.CEREBRAS_FREE_1,
          env.CEREBRAS_FREE_2,
          env.CEREBRAS_FREE_3,
          env.CEREBRAS_FREE_4,
          env.CEREBRAS_PAID,
          env.cerebras_paid
        ].filter(Boolean);
        if (!keys.length) return json({ error: "No Cerebras keys found in env" }, 200, origin);
        var key = keys[0];
        var modelsResp = await fetch("https://api.cerebras.ai/v1/models", {
          headers: { "Authorization": "Bearer " + key }
        });
        var modelsData = await modelsResp.json();
        var modelIds = (modelsData.data || []).map(function(m2) {
          return m2.id;
        });
        var completionResp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: "Reply: OK" }], max_tokens: 5 })
        });
        var completionData = await completionResp.json();
        return json({
          keysFound: keys.length,
          keyPreview: key.substring(0, 8) + "...",
          modelsStatus: modelsResp.status,
          availableModels: modelIds,
          completionStatus: completionResp.status,
          completionResult: completionData.choices ? completionData.choices[0].message.content : null,
          completionError: completionData.error || null
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/news" && request.method === "GET") {
      try {
        var feeds = [
          { url: "https://www.theguardian.com/society/rss", source: "Guardian Society" },
          { url: "https://www.theguardian.com/society/mental-health/rss", source: "Guardian Mental Health" },
          { url: "https://www.theguardian.com/society/addiction/rss", source: "Guardian Addiction" },
          { url: "https://feeds.bbci.co.uk/news/health/rss.xml", source: "BBC Health" },
          { url: "https://feeds.bbci.co.uk/news/uk/rss.xml", source: "BBC UK" }
        ];
        var allItems = [];
        var fetchPromises = feeds.map(async function(feed) {
          try {
            var r2 = await fetch(feed.url, {
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; ArgenticaBot/1.0)",
                "Accept": "application/rss+xml, application/xml, text/xml, */*"
              }
            });
            if (!r2.ok) return;
            var xml = await r2.text();
            var itemMatches = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/g) || [];
            itemMatches.slice(0, 6).forEach(function(item2) {
              var titleM = item2.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
              var title2 = titleM ? titleM[1].trim() : "";
              var linkM = item2.match(/<link>([\s\S]*?)<\/link>/);
              var link = linkM ? linkM[1].trim() : "";
              var dateM = item2.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
              var date = dateM ? dateM[1].trim() : "";
              var imgM = item2.match(/<media:thumbnail[^>]+url="([^"]+)"/i)
                      || item2.match(/<media:content[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
                      || item2.match(/<enclosure[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
                      || item2.match(/url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
              var image = imgM ? imgM[1] : null;
              var descM = item2.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
              var desc = descM ? descM[1].replace(/<[^>]+>/g, "").trim().substring(0, 200) : "";
              if (title2 && link) allItems.push({ title: title2, link, date, source: feed.source, image, description: desc });
            });
          } catch (e) {
          }
        });
        await Promise.allSettled(fetchPromises);
        allItems.sort(function(a, b) {
          return new Date(b.date || 0) - new Date(a.date || 0);
        });
        return json({ items: allItems.slice(0, 20), total: allItems.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message, items: [] }, 200, origin);
      }
    }
    if (path === "/api/inbox" && request.method === "POST") {
      try {
        var body = await request.json();
        var from = body.from || "system";
        var content = body.content || "";
        if (!content) return json({ error: "No content" }, 200, origin);
        var msgId = "msg-" + from.replace(/[^a-z0-9]/gi, "-") + "-" + Date.now();
        var msg = { id: msgId, from, to: "simon", content, timestamp: (/* @__PURE__ */ new Date()).toISOString(), read: false };
        if (env.PRISM_KV) await env.PRISM_KV.put("msg:simon:" + msgId, JSON.stringify(msg));
        var tgTok = env.TELEGRAM_TOKEN || env.telegram_token;
        var tgCh = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
        if (tgTok && tgCh) {
          await fetch("https://api.telegram.org/bot" + tgTok + "/sendMessage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: tgCh, text: from + ":\n\n" + content.substring(0, 500) })
          });
        }
        return json({ success: true, messageId: msgId }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/daily-pipeline" && request.method === "POST") {
      try {
        var body = await request.json();
        var slot = body.slot || "morning";
        var forceTopic = body.topic || "";
        var IP_CTX = "You are writing for Identity Partners, a relational practice helping people make sense of the past, appreciate the present, and define their future. We work with addiction, trauma, identity, late-diagnosed ADHD, autism, PTSD, and life transitions. British English. No sycophancy. No wellness retreat language. Warm, direct, evidence-informed.";
        var FALLBACK_TOPICS = ["identity and who we become after crisis", "imposter syndrome and the gap between how we feel and how we appear", "masking in autism and ADHD", "late-diagnosed ADHD in adults", "the difference between PTSD and complex PTSD", "how to know if you have PTSD", "narcissistic patterns in relationships", "the difference between selfishness and narcissism", "what recovery actually looks like day to day", "why human connection is the most evidence-based intervention we have", "the Jungian shadow", "identity reconstruction after addiction", "why people-pleasing is a trauma response", "the neuroscience of belonging", "what it means to truly know yourself"];
        var SLOT_CFG = { morning: { label: "Morning Briefing", emoji: "\u2600\uFE0F", tone: "energising and grounding" }, lunchtime: { label: "Lunchtime Check-in", emoji: "\u2615", tone: "reflective and warm" }, evening: { label: "Evening Headlines", emoji: "\u{1F319}", tone: "thoughtful and synthesising" } };
        var sc = SLOT_CFG[slot] || SLOT_CFG.morning;
        var topic = forceTopic;
        if (!topic) {
          try {
            var gR = await fetch("https://www.theguardian.com/society/rss", { headers: { "User-Agent": "Mozilla/5.0 (compatible; ArgenticaBot/1.0)" } });
            if (gR.ok) {
              var gXml = await gR.text();
              var gItems = gXml.match(/<item[^>]*>([\s\S]*?)<\/item>/g) || [];
              for (var gi = 0; gi < gItems.length; gi++) {
                var gTitle = (gItems[gi].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
                if (gTitle.match(/addiction|recovery|mental health|trauma|adhd|autism|ptsd|anxiety|depression|loneliness|identity|wellbeing|neurodiverg/i)) {
                  topic = "Today in the news: " + gTitle.trim();
                  break;
                }
              }
            }
          } catch (e) {
          }
        }
        if (!topic) topic = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
        var bskyR = await orchestrate(env, [{ role: "system", content: IP_CTX }, { role: "user", content: "Write a " + sc.tone + " post about: " + topic + ". Under 280 characters. End with www.identitypartners.uk" }], "fast", "drafting", null);
        var liR = await orchestrate(env, [{ role: "system", content: IP_CTX }, { role: "user", content: "Write a LinkedIn post about: " + topic + ". 150 words. Professional, warm. End with a question. 3 hashtags." }], "balanced", "drafting", null);
        var quoteR = await orchestrate(env, [{ role: "system", content: IP_CTX }, { role: "user", content: "Write a powerful quote about: " + topic + ". 15-20 words. No cliches." }], "fast", "drafting", null);
        var bskyText = bskyR.content || "";
        var liText = liR.content || "";
        var quoteText = quoteR.content || "";
        var suffix = "\n\nhello@identitypartners.uk | www.identitypartners.uk/contact\n#IdentityPartners #MentalHealth #Recovery #Addiction #Wellbeing";
        var canvasUrl = null;
        var blKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (blKey && quoteText) {
          var tpls = { morning: "quote-ivory", lunchtime: "quote-teal", evening: "quote-rose" };
          var ths = { "quote-teal": { bg: "#0f3b3a", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(15,59,58,0.72)" }, "quote-rose": { bg: "#5c2d3f", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(92,45,63,0.72)" }, "quote-ivory": { bg: "#f7f3e9", text: "#0f3b3a", accent: "#5c2d3f", overlay: "rgba(247,243,233,0.80)" } };
          var th = ths[tpls[slot]] || ths["quote-teal"];
          var sq = quoteText.substring(0, 200).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
          var imgs = ["https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1624496/pexels-photo-1624496.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/2559941/pexels-photo-2559941.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1906658/pexels-photo-1906658.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1024993/pexels-photo-1024993.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop"];
          var bg = imgs[Math.floor(Math.random() * imgs.length)];
          var ck = "daily-" + slot + "-" + Date.now() + ".png";
          var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,400&family=Inter:wght@400;500&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;}body{width:1080px;height:1080px;overflow:hidden;background:' + th.bg + ';}</style></head><body><canvas id="c" width="1080" height="1080" style="display:block;"></canvas><script>(function(){var cv=document.getElementById("c");var ctx=cv.getContext("2d");var W=1080,H=1080;function draw(){ctx.fillStyle="' + th.accent + '";ctx.globalAlpha=0.8;ctx.fillRect(0,0,W,10);ctx.fillRect(0,H-10,W,10);ctx.globalAlpha=0.3;ctx.fillRect(60,60,6,H-120);ctx.globalAlpha=1;ctx.font="italic 110px "Playfair Display",Georgia,serif";ctx.fillStyle="' + th.text + '";ctx.globalAlpha=0.12;ctx.fillText("\u201C",80,200);ctx.globalAlpha=1;var words=`' + sq + '`.split(" ");var lines=[],line="";ctx.font="italic 52px "Playfair Display",Georgia,serif";ctx.fillStyle="' + th.text + '";ctx.textAlign="center";words.forEach(function(w){var test=line+(line?" ":"")+w;if(ctx.measureText(test).width>860&&line){lines.push(line);line=w;}else line=test;});if(line)lines.push(line);if(lines.length>6)lines=lines.slice(0,5);var lh=72,sy=Math.max(200,Math.floor(H/2)-Math.floor(lines.length*lh/2));lines.forEach(function(l,i){ctx.fillText(l,W/2,sy+i*lh);});ctx.fillStyle="' + th.accent + '";ctx.globalAlpha=0.6;ctx.fillRect(W/2-160,sy+lines.length*lh+28,320,2);ctx.globalAlpha=1;ctx.font="500 30px "Inter",Arial,sans-serif";ctx.fillText("\u2014 Identity Partners",W/2,sy+lines.length*lh+70);ctx.font="18px "Inter",Arial,sans-serif";ctx.globalAlpha=0.8;ctx.fillText("www.identitypartners.uk \xB7 hello@identitypartners.uk",W/2,H-42);ctx.globalAlpha=1;}var bgImg=new Image();bgImg.crossOrigin="anonymous";bgImg.onload=function(){ctx.fillStyle="' + th.bg + '";ctx.fillRect(0,0,W,H);var s=Math.max(W/bgImg.naturalWidth,H/bgImg.naturalHeight);ctx.drawImage(bgImg,(W-bgImg.naturalWidth*s)/2,(H-bgImg.naturalHeight*s)/2,bgImg.naturalWidth*s,bgImg.naturalHeight*s);ctx.fillStyle="' + th.overlay + '";ctx.fillRect(0,0,W,H);draw();};bgImg.onerror=function(){ctx.fillStyle="' + th.bg + '";ctx.fillRect(0,0,W,H);draw();};bgImg.src="' + bg + '";})();<\/script></body></html>';
          try {
            var blR = await fetch("https://chrome.browserless.io/screenshot?token=" + blKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html, options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false }, waitForTimeout: 8e3 }) });
            if (blR.ok) {
              var pb = await blR.arrayBuffer();
              if (pb.byteLength > 5e3 && env.PRISM_ASSETS) {
                await env.PRISM_ASSETS.put(ck, pb, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 30 });
                canvasUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + ck;
              }
            }
          } catch (e) {
          }
        }
        var posted = {};
        var errors = {};
        var bufKey = env.BUFFER_API_KEY;
        var igCh = "6a97edce065799be46722eab";
        var fbCh = "6a97ea40065799be46721fdd";
        var xCh = "6a97ebf1065799be46722744";
        var imgUrl = canvasUrl || imgs[0];
        try {
          var bskyPost = await postToBluesky(env, bskyText, canvasUrl);
          posted.bluesky = bskyPost;
        } catch (e) {
          errors.bluesky = e.message;
        }
        if (bufKey) {
          try {
            var xM = JSON.stringify({ query: 'mutation{createPost(input:{channelId:"' + xCh + '",text:' + JSON.stringify(bskyText.substring(0, 280)) + ",assets:[{image:{url:" + JSON.stringify(imgUrl) + "}}],mode:shareNow,needsApproval:false,schedulingType:automatic,metadata:{twitter:{type:post}}}){...on PostActionSuccess{post{id}}...on MutationError{message}}}" });
            var xR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: xM });
            var xD = await xR.json();
            var xCp = xD.data && xD.data.createPost || {};
            if (xCp.post) posted.x = { success: true };
            else errors.x = xCp.message || "Buffer error";
          } catch (e) {
            errors.x = e.message;
          }
          try {
            var igM = JSON.stringify({ query: 'mutation{createPost(input:{channelId:"' + igCh + '",text:' + JSON.stringify(suffix.trim().substring(0, 2200)) + ",assets:[{image:{url:" + JSON.stringify(imgUrl) + "}}],mode:shareNow,needsApproval:false,schedulingType:automatic,metadata:{instagram:{type:post,shouldShareToFeed:true}}}){...on PostActionSuccess{post{id}}...on MutationError{message}}}" });
            var igR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: igM });
            var igD = await igR.json();
            var igCp = igD.data && igD.data.createPost || {};
            if (igCp.post) posted.instagram = { success: true };
            else errors.instagram = igCp.message || "Buffer error";
          } catch (e) {
            errors.instagram = e.message;
          }
          try {
            var fbM = JSON.stringify({ query: 'mutation{createPost(input:{channelId:"' + fbCh + '",text:' + JSON.stringify((liText + suffix).substring(0, 3e3)) + ",assets:[{image:{url:" + JSON.stringify(imgUrl) + "}}],mode:shareNow,needsApproval:false,schedulingType:automatic,metadata:{facebook:{type:post}}}){...on PostActionSuccess{post{id}}...on MutationError{message}}}" });
            var fbR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: fbM });
            var fbD = await fbR.json();
            var fbCp = fbD.data && fbD.data.createPost || {};
            if (fbCp.post) posted.facebook = { success: true };
            else errors.facebook = fbCp.message || "Buffer error";
          } catch (e) {
            errors.facebook = e.message;
          }
        }
        var liToken = null;
        if (env.PRISM_KV) {
          try {
            var lt = await env.PRISM_KV.get("oauth:linkedin:tokens");
            if (lt) liToken = JSON.parse(lt).access_token;
          } catch (e) {
          }
        }
        if (!liToken) liToken = env.LINKEDIN_PAID_1 || env.LINKEDIN_PAID_2;
        if (liToken) {
          try {
            var meR = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { "Authorization": "Bearer " + liToken } });
            var meD = await meR.json();
            if (meD.sub) {
              var liBody = { author: "urn:li:person:" + meD.sub, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: (liText + suffix).substring(0, 3e3) }, shareMediaCategory: "NONE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } };
              var liR = await fetch("https://api.linkedin.com/v2/ugcPosts", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + liToken, "X-Restli-Protocol-Version": "2.0.0" }, body: JSON.stringify(liBody) });
              if (liR.ok) posted.linkedin = { success: true };
              else errors.linkedin = "HTTP " + liR.status;
            }
          } catch (e) {
            errors.linkedin = e.message;
          }
        }
        var tgTok = env.TELEGRAM_TOKEN || env.telegram_token;
        var tgCh = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
        if (tgTok && tgCh) {
          var pp = Object.keys(posted).filter(function(k) {
            return posted[k] && posted[k].success;
          });
          await fetch("https://api.telegram.org/bot" + tgTok + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgCh, text: sc.emoji + " " + sc.label + " posted!\n\nTopic: " + topic.substring(0, 100) + "\n\nPosted to: " + pp.join(", ") + "\n\n" + bskyText.substring(0, 200) }) });
        }
        return json({ success: true, slot, label: sc.label, topic: topic.substring(0, 100), posted, errors, canvasGenerated: !!canvasUrl, bluesky: bskyText.substring(0, 100), quote: quoteText }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/champion/update" && request.method === "POST") {
      try {
        var updates = [];
        var errors3 = [];
        var PROVIDERS = [
          { name: "cerebras", keys: [env.CEREBRAS_PAID_1, env.CEREBRAS_PAID_2, env.cerebras_api_key, env.CEREBRAS_API_KEY].filter(Boolean), url: "https://api.cerebras.ai/v1/models" },
          { name: "groq", keys: [env.GROQ_FREE_1, env.GROQ_FREE_2, env.GROQ_FREE_3, env.GROQ_API_KEY, env.groq_api_key].filter(Boolean), url: "https://api.groq.com/openai/v1/models", skipWords: ["whisper", "tts", "guard", "safeguard"] },
          { name: "mistral", keys: [env.mistral_api_key, env.MISTRAL_API_KEY].filter(Boolean), url: "https://api.mistral.ai/v1/models" },
          { name: "deepseek", keys: [env.DEEPSEEK_PAID, env.deepseek_paid, env.DEEPSEEK_FREE_1].filter(Boolean), url: "https://api.deepseek.com/models" },
          { name: "openrouter", keys: [env.openrouter_api_key, env.OPENROUTER_API_KEY].filter(Boolean), url: "https://openrouter.ai/api/v1/models" },
          { name: "together", keys: [env.together_api_key].filter(Boolean), url: "https://api.together.xyz/v1/models" },
          { name: "cohere", keys: [env.cohere_api_key].filter(Boolean), url: "https://api.cohere.com/v1/models" },
          { name: "kimi", keys: [env.kimi_api_key].filter(Boolean), url: "https://api.moonshot.cn/v1/models" },
          { name: "nvidia", keys: [env.nvidia_build_api_key, env.nvidia_build_api_key_2].filter(Boolean), url: "https://integrate.api.nvidia.com/v1/models" },
          { name: "gemini", keys: [env.gemini_paid_api_key, env.gemini_api_key].filter(Boolean), url: "https://generativelanguage.googleapis.com/v1beta/models", isGemini: true }
        ];
        for (var pi = 0; pi < PROVIDERS.length; pi++) {
          var prov = PROVIDERS[pi];
          if (!prov.keys.length) {
            errors3.push(prov.name + ": no keys");
            continue;
          }
          try {
            var fetchUrl3 = prov.isGemini ? prov.url + "?key=" + prov.keys[0] : prov.url;
            var headers3 = prov.isGemini ? {} : { "Authorization": "Bearer " + prov.keys[0] };
            var pR = await fetch(fetchUrl3, { headers: headers3 });
            if (!pR.ok) {
              errors3.push(prov.name + ": HTTP " + pR.status);
              continue;
            }
            var pD = await pR.json();
            var models3 = (pD.data || pD.models || []).map(function(m2) {
              return m2.id || m2.name || "";
            }).filter(Boolean);
            if (prov.skipWords) models3 = models3.filter(function(id2) {
              return !prov.skipWords.some(function(w) {
                return id2.includes(w);
              });
            });
            if (env.PRISM_KV) await env.PRISM_KV.put("registry:" + prov.name, JSON.stringify({ models: models3, updated: (/* @__PURE__ */ new Date()).toISOString(), keyCount: prov.keys.length }));
            updates.push(prov.name + " (" + models3.length + "): " + models3.slice(0, 3).join(", "));
          } catch (e3) {
            errors3.push(prov.name + ": " + e3.message);
          }
        }
        var tgTok3 = env.TELEGRAM_TOKEN || env.telegram_token;
        var tgCh3 = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
        if (tgTok3 && tgCh3) {
          await fetch("https://api.telegram.org/bot" + tgTok3 + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgCh3, text: "API Champion: Registry Updated\n\n" + updates.join("\n") + (errors3.length ? "\n\nFailed: " + errors3.join(", ") : "") + " \n\n" + (/* @__PURE__ */ new Date()).toISOString() }) });
        }
        // ── Agentically update routing preferences based on available models ──
        // Reads the freshly updated registry and writes a routing config to KV
        // that orchestrate() reads on each request.
        try {
          var routingConfig = { updatedAt: new Date().toISOString(), tiers: {} };

          // Tier 1: Quality reasoning — prefer deepseek, kimi, mistral
          var t1Models = [];
          for (var tn of ["deepseek", "kimi", "mistral"]) {
            var reg = env.PRISM_KV ? await env.PRISM_KV.get("registry:" + tn) : null;
            if (reg) {
              var rd = JSON.parse(reg);
              if (rd.models && rd.models.length > 0) t1Models.push({ provider: tn, models: rd.models.slice(0, 3), available: true });
              else t1Models.push({ provider: tn, available: false, reason: "no models returned" });
            } else {
              t1Models.push({ provider: tn, available: false, reason: "registry not populated" });
            }
          }
          routingConfig.tiers.quality = t1Models;

          // Tier 2: Fast chat — cerebras, groq
          var t2Models = [];
          for (var tn2 of ["cerebras", "groq"]) {
            var reg2 = env.PRISM_KV ? await env.PRISM_KV.get("registry:" + tn2) : null;
            if (reg2) {
              var rd2 = JSON.parse(reg2);
              if (rd2.models && rd2.models.length > 0) t2Models.push({ provider: tn2, models: rd2.models.slice(0, 3), available: true });
              else t2Models.push({ provider: tn2, available: false, reason: "no models" });
            }
          }
          routingConfig.tiers.fast = t2Models;

          // Tier 3: Paid frontier — gemini, nvidia, openrouter
          var t3Models = [];
          for (var tn3 of ["gemini", "nvidia", "openrouter"]) {
            var reg3 = env.PRISM_KV ? await env.PRISM_KV.get("registry:" + tn3) : null;
            if (reg3) {
              var rd3 = JSON.parse(reg3);
              if (rd3.models && rd3.models.length > 0) t3Models.push({ provider: tn3, models: rd3.models.slice(0, 3), available: true });
              else t3Models.push({ provider: tn3, available: false });
            }
          }
          routingConfig.tiers.frontier = t3Models;

          // Count available providers
          var availableCount = [...t1Models, ...t2Models, ...t3Models].filter(function(p){ return p.available; }).length;
          routingConfig.availableProviders = availableCount;
          routingConfig.pollinationsAlwaysAvailable = true;

          if (env.PRISM_KV) await env.PRISM_KV.put("routing:config", JSON.stringify(routingConfig), { expirationTtl: 86400 * 2 });
          updates.push("Routing config updated: " + availableCount + " providers available");
        } catch(routeErr) {
          errors3.push("Routing config update failed: " + routeErr.message);
        }

        return json({ success: true, updated: updates.length, failed: errors3.length, updates, errors: errors3, timestamp: new Date().toISOString() }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/champion/registry" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ registry: {} }, 200, origin);
        var providers = ["cerebras", "groq", "mistral", "deepseek", "nvidia"];
        var registry = {};
        for (var ri = 0; ri < providers.length; ri++) {
          var rv = await env.PRISM_KV.get("registry:" + providers[ri]);
          if (rv) {
            try {
              registry[providers[ri]] = JSON.parse(rv);
            } catch (e) {
            }
          }
        }
        return json({ registry }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/whop/members" && request.method === "GET") {
      try {
        var whopKey = env.WHOP_API_KEY;
        if (!whopKey) return json({ error: "WHOP_API_KEY not configured" }, 200, origin);
        var whopResp = await fetch("https://api.whop.com/api/v2/memberships", {
          headers: { "Authorization": "Bearer " + whopKey, "Content-Type": "application/json" }
        });
        var whopData = await whopResp.json();
        return json({ success: true, members: whopData.data || whopData, total: (whopData.data || []).length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/whop/products" && request.method === "GET") {
      try {
        var whopKey2 = env.WHOP_API_KEY;
        if (!whopKey2) return json({ error: "WHOP_API_KEY not configured" }, 200, origin);
        var whopResp2 = await fetch("https://api.whop.com/api/v2/products", {
          headers: { "Authorization": "Bearer " + whopKey2 }
        });
        var whopData2 = await whopResp2.json();
        return json({ success: true, products: whopData2.data || whopData2 }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/whop/company" && request.method === "GET") {
      try {
        var whopKey3 = env.WHOP_API_KEY;
        if (!whopKey3) return json({ error: "WHOP_API_KEY not configured" }, 200, origin);
        var whopResp3 = await fetch("https://api.whop.com/api/v2/me", {
          headers: { "Authorization": "Bearer " + whopKey3 }
        });
        var whopData3 = await whopResp3.json();
        return json({ success: true, company: whopData3 }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/omni" && (request.method === "POST" || request.method === "GET")) {
      try {
        var hour = (/* @__PURE__ */ new Date()).getUTCHours();
        var tasks = [];
        var results3 = {};
        var minute = (/* @__PURE__ */ new Date()).getUTCMinutes();
        if (hour === 7 && minute >= 55 || hour === 8 && minute <= 5) tasks.push("morning");
        if (hour === 12 && minute >= 55 || hour === 13 && minute <= 5) tasks.push("lunchtime");
        if (hour === 19 && minute >= 55 || hour === 20 && minute <= 5) tasks.push("evening");
        if (hour === 5 && minute >= 55 || hour === 6 && minute <= 5) tasks.push("champion");
        var dayOfWeek = (/* @__PURE__ */ new Date()).getUTCDay();
        if (hour === 9 && dayOfWeek === 1) tasks.push("recycle");
        if (tasks.length === 0) {
          return json({ success: true, hour, message: "No tasks scheduled for this hour", tasks: [] }, 200, origin);
        }
        for (var ti = 0; ti < tasks.length; ti++) {
          var task = tasks[ti];
          try {
            if (task === "morning" || task === "lunchtime" || task === "evening") {
              var pipelineReq = new Request("https://prism-api.identitypartners.workers.dev/api/daily-pipeline", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
                body: JSON.stringify({ slot: task })
              });
              var pipelineResp = await handleRequest(pipelineReq, env, ctx);
              var pipelineData = await pipelineResp.json();
              results3[task] = { success: pipelineData.success, posted: Object.keys(pipelineData.posted || {}).filter(function(k) {
                return (pipelineData.posted || {})[k] && (pipelineData.posted || {})[k].success;
              }), topic: (pipelineData.topic || "").substring(0, 60) };
            } else if (task === "champion") {
              var champReq = new Request("https://prism-api.identitypartners.workers.dev/api/champion/update", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
                body: "{}"
              });
              var champResp = await handleRequest(champReq, env, ctx);
              var champData = await champResp.json();
              results3.champion = { updated: champData.updated, failed: champData.failed };
            } else if (task === "recycle") {
              var memList = await env.PRISM_KV.list({ prefix: "memory:" });
              var mems = [];
              for (var mi = 0; mi < Math.min(memList.keys.length, 20); mi++) {
                var mv = await env.PRISM_KV.get(memList.keys[mi].name);
                if (mv) {
                  try {
                    mems.push(JSON.parse(mv).content);
                  } catch (e) {
                  }
                }
              }
              if (mems.length > 0) {
                var recycleResult = await orchestrate(env, [
                  { role: "system", content: "You are writing for Identity Partners. Take one insight from the provided memories and write a fresh social media post about it. British English. Under 280 characters. No cliches." },
                  { role: "user", content: "Memories:\\n" + mems.slice(0, 5).join("\\n\\n") + "\\n\\nWrite one fresh post based on the most interesting insight." }
                ], "fast", "drafting", null);
                var recycleText = recycleResult.content || "";
                if (recycleText) {
                  var bskyRecycle = await postToBluesky(env, recycleText);
                  results3.recycle = { success: true, posted: "bluesky", preview: recycleText.substring(0, 60) };
                }
              }
            }
          } catch (taskErr) {
            results3[task] = { error: taskErr.message };
          }
        }
        var tgTok = env.TELEGRAM_TOKEN || env.telegram_token;
        var tgCh = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
        if (tgTok && tgCh && tasks.length > 0) {
          var summary = "Omni-Agent ran at " + hour + ":00 UTC\n\nTasks: " + tasks.join(", ") + "\n\n";
          tasks.forEach(function(t2) {
            var r3 = results3[t2] || {};
            if (r3.error) summary += t2 + ": ERROR - " + r3.error + "\n";
            else if (r3.posted) summary += t2 + ": posted to " + r3.posted.join(", ") + "\n";
            else summary += t2 + ": " + JSON.stringify(r3).substring(0, 50) + "\n";
          });
          await fetch("https://api.telegram.org/bot" + tgTok + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgCh, text: summary }) });
        }
        return json({ success: true, hour, tasks, results: results3 }, 200, origin);
      } catch (e) {
        return json({ error: e.message, hour: (/* @__PURE__ */ new Date()).getUTCHours() }, 500, origin);
      }
    }
    if (path === "/api/buffer/channels" && request.method === "GET") {
      try {
        var bufKey = env.BUFFER_API_KEY;
        if (!bufKey) return json({ error: "No Buffer key" }, 200, origin);
        var orgResp = await fetch("https://api.buffer.com/graphql", {
          method: "POST",
          headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{account{id name organizations{id name}}}" })
        });
        var orgData = await orgResp.json();
        var orgId = orgData.data && orgData.data.account && orgData.data.account.organizations && orgData.data.account.organizations[0] && orgData.data.account.organizations[0].id;
        var channelQuery = orgId ? JSON.stringify({ query: 'query{channels(input:{organizationId:"' + orgId + '"}){id name service}}' }) : JSON.stringify({ query: "{account{id name}}" });
        var r = await fetch("https://api.buffer.com/graphql", {
          method: "POST",
          headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" },
          body: channelQuery
        });
        var d = await r.json();
        return json({ channels: d.data && d.data.channels || [], errors: d.errors || [] }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/x/post" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = body.text || "";
        var imageUrl = body.imageUrl || null;
        if (!text) return json({ error: "No text" }, 200, origin);
        var blKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!blKey) return json({ error: "No Browserless key" }, 200, origin);
        var xScript = 'async function run() {const browser = await puppeteer.launch();const page = await browser.newPage();await page.goto("https://x.com/compose/tweet");await page.waitForSelector("[data-testid=tweetTextarea_0]", {timeout:10000});await page.type("[data-testid=tweetTextarea_0]", ' + JSON.stringify(text.substring(0, 280)) + ');await page.click("[data-testid=tweetButton]");await page.waitForTimeout(3000);await browser.close();return {success: true};}';
        return json({
          success: false,
          message: "X direct posting requires OAuth tokens. Please reconnect X in Buffer at buffer.com/channels",
          alternative: "The Buffer API key is valid but Buffer shows 0 channels -- reconnect X at buffer.com"
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/agents" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!body.id) body.id = "agent-" + Date.now();
        body.updated = (/* @__PURE__ */ new Date()).toISOString();
        if (!body.created) body.created = body.updated;
        if (env.PRISM_KV) await env.PRISM_KV.put("agent:" + body.id, JSON.stringify(body));
        return json({ success: true, agent: body }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/agents" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ agents: [] }, 200, origin);
        var list = await env.PRISM_KV.list({ prefix: "agent:" });
        var agents = [];
        for (var i = 0; i < list.keys.length; i++) {
          var v = await env.PRISM_KV.get(list.keys[i].name);
          if (v) {
            try {
              agents.push(JSON.parse(v));
            } catch (e) {
            }
          }
        }
        return json({ agents }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/agents/") && !path.includes("/runs") && request.method === "DELETE") {
      try {
        var agentId = path.replace("/api/agents/", "");
        if (env.PRISM_KV) await env.PRISM_KV.delete("agent:" + agentId);
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/agents/run" && request.method === "POST") {
      try {
        var body = await request.json();
        var agentId = body.agentId;
        var manualInput = body.input || "";
        var agentRaw = env.PRISM_KV ? await env.PRISM_KV.get("agent:" + agentId) : null;
        if (!agentRaw) return json({ error: "Agent not found: " + agentId }, 200, origin);
        var agentDef = JSON.parse(agentRaw);
        var runLog = [];
        var outputs = {};
        var startTime = Date.now();
        var context = manualInput ? "USER INPUT: " + manualInput + " " : "";
        var taskPrompt = agentDef.taskPrompt || "Complete your assigned task.";
        if (context) taskPrompt = context + " Task: " + taskPrompt;
        var result = await orchestrate(env, [
          { role: "system", content: agentDef.systemPrompt || "You are an autonomous agent. Complete the task. Be concise." },
          { role: "user", content: taskPrompt }
        ], agentDef.profile || "balanced", "agent_task", null);
        outputs.main = result.content;
        runLog.push("Completed via " + result.provider);
        var actions = agentDef.outputActions || [];
        for (var ai = 0; ai < actions.length; ai++) {
          var action = actions[ai];
          if (action === "save-to-memory" && env.PRISM_KV) {
            await env.PRISM_KV.put("memory:agent-" + agentId + "-" + Date.now(), JSON.stringify({ content: result.content, tags: ["agent", agentDef.name], created: (/* @__PURE__ */ new Date()).toISOString() }));
            runLog.push("Saved to Memory");
          } else if (action === "notify-inbox" && env.PRISM_KV) {
            var msgId = "msg-agent-" + Date.now();
            await env.PRISM_KV.put("msg:simon:" + msgId, JSON.stringify({ id: msgId, from: "agent:" + agentDef.name, to: "simon", content: "[" + agentDef.name + "] " + result.content.substring(0, 500), timestamp: (/* @__PURE__ */ new Date()).toISOString(), read: false }));
            runLog.push("Sent to inbox");
          } else if (action === "post-to-bluesky") {
            await postToBluesky(env, result.content.substring(0, 300));
            runLog.push("Posted to Bluesky");
          } else if (action === "send-telegram") {
            var tgT = env.TELEGRAM_TOKEN || env.telegram_token;
            var tgC = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
            if (tgT && tgC) {
              await fetch("https://api.telegram.org/bot" + tgT + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgC, text: "[" + agentDef.name + "]\n\n" + result.content.substring(0, 500) }) });
              runLog.push("Sent to Telegram");
            }
          }
        }
        var runRecord = { agentId, agentName: agentDef.name, runAt: (/* @__PURE__ */ new Date()).toISOString(), durationMs: Date.now() - startTime, log: runLog, outputs, provider: result.provider };
        if (env.PRISM_KV) await env.PRISM_KV.put("agent-run:" + agentId + ":" + Date.now(), JSON.stringify(runRecord), { expirationTtl: 86400 * 30 });
        return json({ success: true, run: runRecord }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/agents/runs/") && request.method === "GET") {
      try {
        var agentId2 = path.replace("/api/agents/runs/", "");
        if (!env.PRISM_KV) return json({ runs: [] }, 200, origin);
        var runList = await env.PRISM_KV.list({ prefix: "agent-run:" + agentId2 + ":" });
        var runs = [];
        for (var ri = 0; ri < runList.keys.length; ri++) {
          var rv = await env.PRISM_KV.get(runList.keys[ri].name);
          if (rv) {
            try {
              runs.push(JSON.parse(rv));
            } catch (e) {
            }
          }
        }
        runs.sort(function(a, b) {
          return new Date(b.runAt) - new Date(a.runAt);
        });
        return json({ runs: runs.slice(0, 20) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/url" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 150);
        var template = body.template || "quote-teal";
        var encodedText = encodeURIComponent(text);
        var canvasUrl = "https://prism-api.identitypartners.workers.dev/api/canvas/image?text=" + encodedText + "&template=" + template + "&t=" + Date.now();
        return json({ success: true, url: canvasUrl }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/image" && request.method === "GET") {
      try {
        var url2 = new URL(request.url);
        var text2 = url2.searchParams.get("text") || "Identity Partners";
        var template2 = url2.searchParams.get("template") || "quote-teal";
        var blKey2 = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!blKey2) return new Response("No Browserless key", { status: 500 });
        var html2 = await generateCanvasHtml(text2, template2, env);
        if (!html2) return new Response("Canvas generation failed", { status: 500 });
        var blR2 = await fetch("https://chrome.browserless.io/screenshot?token=" + blKey2, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: html2, options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false }, waitForTimeout: 8e3 })
        });
        if (!blR2.ok) return new Response("Browserless error: " + blR2.status, { status: 500 });
        var pngBuf2 = await blR2.arrayBuffer();
        return new Response(pngBuf2, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }
    if (path === "/api/canvas/image" && request.method === "GET") {
      try {
        var url3 = new URL(request.url);
        var text3 = url3.searchParams.get("text") || "Identity Partners";
        var template3 = url3.searchParams.get("template") || "quote-teal";
        var blKey3 = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!blKey3) return new Response("No Browserless key", { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
        var html3 = await generateCanvasHtml(text3, template3, env);
        if (!html3) return new Response("Canvas HTML failed", { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
        var blR3 = await fetch("https://chrome.browserless.io/screenshot?token=" + blKey3, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: html3, options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false }, waitForTimeout: 1e4 }) });
        if (!blR3.ok) return new Response("Browserless " + blR3.status, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
        var pngBuf3 = await blR3.arrayBuffer();
        return new Response(pngBuf3, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }
    if (path === "/api/setmore/availability" && request.method === "GET") {
      try {
        return json({
          bookingUrl: "https://identitypartners.setmore.com",
          embedUrl: "https://identitypartners.setmore.com/embed",
          services: [
            { name: "Initial Consultation (Free)", duration: 20, price: 0 },
            { name: "Individual Session", duration: 60, price: 80 },
            { name: "Group Session", duration: 90, price: 40 }
          ]
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/store" && request.method === "POST") {
      try {
        var body = await request.json();
        var key = body.key || "canvas-" + Date.now() + ".png";
        var dataUrl = body.dataUrl || "";
        if (!dataUrl) return json({ error: "No dataUrl" }, 200, origin);
        var base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
        var binaryStr = atob(base64);
        var bytes = new Uint8Array(binaryStr.length);
        for (var i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("canvas:" + key, bytes.buffer, {
            metadata: { contentType: "image/png" },
            expirationTtl: 86400 * 7
          });
          var serveUrl = "https://prism-api.identitypartners.workers.dev/api/canvas/kv/" + key;
          return json({ success: true, url: serveUrl, key, size: bytes.length }, 200, origin);
        }
        return json({ error: "KV not available" }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/canvas/kv/") && request.method === "GET") {
      try {
        var kvKey = path.replace("/api/canvas/kv/", "");
        if (!env.PRISM_KV) return new Response("KV not available", { status: 500 });
        var data = await env.PRISM_KV.getWithMetadata("canvas:" + kvKey, { type: "arrayBuffer" });
        if (!data.value) return new Response("Not found", { status: 404 });
        return new Response(data.value, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=604800",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }
    if (path === "/api/imgur/upload" && request.method === "POST") {
      try {
        var body = await request.json();
        var imageBase64 = body.imageBase64 || body.dataUrl || "";
        imageBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        if (!imageBase64) return json({ error: "No image data provided" }, 200, origin);
        var result = await uploadToImgur(imageBase64, env);
        if (result.success) {
          if (env.PRISM_KV) {
            await env.PRISM_KV.put("imgur:" + Date.now(), JSON.stringify({
              url: result.url,
              deleteHash: result.deleteHash,
              created: (/* @__PURE__ */ new Date()).toISOString()
            }), { expirationTtl: 86400 * 365 });
          }
        }
        return json(result, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/image/host" && request.method === "POST") {
      try {
        var body = await request.json();
        var dataUrl = body.dataUrl || "";
        var title = body.title || "Identity Partners";
        if (!dataUrl) return json({ error: "No image data" }, 200, origin);
        var base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
        var imgurClientId = env.IMGUR_CLIENT_ID || "a0b1c2d3e4f5678";
        var imgurResp = await fetch("https://api.imgur.com/3/image", {
          method: "POST",
          headers: {
            "Authorization": "Client-ID " + imgurClientId,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ image: base64, type: "base64", title, description: "Identity Partners social media asset" })
        });
        var imgurData = await imgurResp.json();
        if (imgurData.success && imgurData.data && imgurData.data.link) {
          var url = imgurData.data.link;
          if (env.PRISM_KV) {
            await env.PRISM_KV.put("hosted-image:" + Date.now(), JSON.stringify({ url, title, created: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 86400 * 365 });
          }
          return json({ success: true, url, host: "imgur", deleteHash: imgurData.data.deletehash }, 200, origin);
        }
        var imgbbKey = env.IMGBB_API_KEY || env.imgbb_api_key;
        if (imgbbKey) {
          var formBody = "key=" + encodeURIComponent(imgbbKey) + "&image=" + encodeURIComponent(base64) + "&name=" + encodeURIComponent(title);
          var imgbbResp = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody
          });
          var imgbbData = await imgbbResp.json();
          if (imgbbData.success && imgbbData.data && imgbbData.data.url) {
            return json({ success: true, url: imgbbData.data.url, host: "imgbb" }, 200, origin);
          }
        }
        var key = "hosted-" + Date.now() + ".png";
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        if (env.PRISM_ASSETS) {
          await env.PRISM_ASSETS.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 365 });
          return json({ success: true, url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + key, host: "r2" }, 200, origin);
        }
        return json({ error: "All image hosting options failed" }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/model-test" && request.method === "GET") {
      try {
        var testResult = await callCerebras(env, [{ role: "user", content: 'Say "OK" and nothing else.' }], "llama-4-scout-17b-16e-instruct");
        var ok = testResult && (typeof testResult === "string" ? testResult.includes("OK") : testResult.content && testResult.content.includes("OK"));
        return json({
          success: ok,
          model: "llama-4-scout-17b-16e-instruct",
          provider: "cerebras",
          response: typeof testResult === "string" ? testResult.substring(0, 50) : testResult && testResult.content ? testResult.content.substring(0, 50) : JSON.stringify(testResult).substring(0, 50),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }, 200, origin);
      } catch (e) {
        return json({ success: false, error: e.message }, 200, origin);
      }
    }
    if (path === "/api/canvas/render-and-post" && request.method === "POST") {
      try {
        var body = await request.json();
        var quote = (body.quote || body.text || "").substring(0, 200);
        var template = body.template || "quote-teal";
        var platforms = body.platforms || ["instagram", "facebook", "x", "bluesky"];
        var igCaption = body.igCaption || "hello@identitypartners.uk | www.identitypartners.uk/contact\n#IdentityPartners #MentalHealth #Recovery #Addiction #Wellbeing";
        var xCaption = body.xCaption || quote.substring(0, 220) + "\n\nwww.identitypartners.uk/contact\n#IdentityPartners #MentalHealth";
        var fbCaption = body.fbCaption || quote + "\n\nhello@identitypartners.uk | www.identitypartners.uk/contact\n#IdentityPartners #MentalHealth #Recovery";
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        var bufferKey = env.BUFFER_API_KEY;
        if (!quote) return json({ error: "No quote provided" }, 200, origin);
        var results = {};
        var imgUrl = null;
        if (browserlessKey) {
          var svgHtml = await generateCanvasHtml(quote, template, env);
          var blResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              html: svgHtml,
              options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false },
              waitForFunction: { fn: "() => document.fonts && document.fonts.ready", timeout: 8e3 },
              waitForTimeout: 2e3
            })
          });
          if (blResp.ok) {
            var pngBuf = await blResp.arrayBuffer();
            if (pngBuf.byteLength > 1e4 && env.PRISM_ASSETS) {
              var imgKey = "canvas-auto-" + Date.now() + ".png";
              await env.PRISM_ASSETS.put(imgKey, pngBuf, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 90 });
              imgUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + imgKey;
              results.canvas = { success: true, url: imgUrl, size: pngBuf.byteLength };
            } else {
              results.canvas = { success: false, error: "PNG too small: " + pngBuf.byteLength };
            }
          } else {
            var blErr = await blResp.text();
            results.canvas = { success: false, error: "Browserless " + blResp.status + ": " + blErr.substring(0, 100) };
          }
        }
        var igCh = "6a97edce065799be46722eab";
        var fbCh = "6a97ea40065799be46721fdd";
        var xCh = "6a97ebf1065799be46722744";
        for (var pi = 0; pi < platforms.length; pi++) {
          var platform = platforms[pi];
          try {
            if (platform === "bluesky") {
              var bskyResult = await postToBluesky(env, xCaption.substring(0, 300));
              results.bluesky = bskyResult;
            } else if (bufferKey && imgUrl) {
              var channelId = platform === "instagram" ? igCh : platform === "facebook" ? fbCh : xCh;
              var text = platform === "instagram" ? igCaption : platform === "facebook" ? fbCaption : xCaption.substring(0, 280);
              var meta = platform === "instagram" ? { instagram: { type: "post", shouldShareToFeed: true } } : platform === "facebook" ? { facebook: { type: "post" } } : {};
              var mutation = "mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id status } } ... on MutationError { message } } }";
              var vars = { input: { channelId, text, assets: [{ image: { url: imgUrl } }], mode: "shareNow", needsApproval: false, schedulingType: "automatic", metadata: meta } };
              var bufResp = await fetch("https://api.buffer.com/graphql", {
                method: "POST",
                headers: { "Authorization": "Bearer " + bufferKey, "Content-Type": "application/json" },
                body: JSON.stringify({ query: mutation, variables: vars })
              });
              var bufData = await bufResp.json();
              var cp = bufData.data && bufData.data.createPost || {};
              results[platform] = cp.post ? { success: true, id: cp.post.id } : { success: false, error: cp.message || "Buffer error" };
            } else if (!imgUrl) {
              results[platform] = { success: false, error: "No canvas image generated" };
            }
          } catch (pe) {
            results[platform] = { success: false, error: pe.message };
          }
        }
        return json({ success: true, quote, imageUrl: imgUrl, results }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/debug/keys" && request.method === "GET") {
      try {
        var availableKeys = [];
        var testKeys = ["CEREBRAS_FREE_1", "CEREBRAS_FREE_2", "CEREBRAS_FREE_3", "CEREBRAS_FREE_4", "CEREBRAS_PAID", "CEREBRAS_PAID2", "GROQ_FREE_1", "GROQ_FREE_2", "GROQ_FREE_3", "cohere_api_key", "mistral_api_key", "kimi_api_key", "together_api_key", "sambanova_api_key", "gemini_paid_api_key", "gemini_api_key", "openrouter_api_key", "DEEPSEEK_PAID", "DEEPSEEK_FREE_1", "nvidia_build_api_key", "chutes_api_key", "fireworks_api_key"];
        testKeys.forEach(function(k) {
          if (env[k]) availableKeys.push(k + ":env");
        });
        var kvKeys = [];
        if (env.PRISM_KV) {
          try {
            var raw = await env.PRISM_KV.get("__secrets__");
            if (raw) {
              var secrets = JSON.parse(raw);
              Object.keys(secrets).forEach(function(k) {
                kvKeys.push(k + ":kv");
              });
            }
          } catch (e) {
          }
        }
        return json({ envKeys: availableKeys, kvKeys: kvKeys.slice(0, 20), total: availableKeys.length + kvKeys.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/secrets/list" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ error: "No KV" }, 200, origin);
        var raw = await env.PRISM_KV.get("__secrets__");
        if (!raw) return json({ error: "No __secrets__ key found" }, 200, origin);
        var secrets = JSON.parse(raw);
        var names = Object.keys(secrets).sort();
        var grouped = {};
        names.forEach(function(name2) {
          var parts = name2.toUpperCase().replace(/-/g, "_").split("_");
          var provider2 = parts[0];
          if (!grouped[provider2]) grouped[provider2] = [];
          grouped[provider2].push(name2);
        });
        return json({ total: names.length, names, grouped }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/keys/push" && request.method === "POST") {
      try {
        var body = await request.json();
        var secrets = body.secrets || {};
        if (!env.PRISM_KV) return json({ error: "No KV" }, 200, origin);
        var existing = {};
        try {
          var raw = await env.PRISM_KV.get("__secrets__");
          if (raw) existing = JSON.parse(raw);
        } catch (e) {
        }
        var merged = Object.assign({}, existing, secrets);
        await env.PRISM_KV.put("__secrets__", JSON.stringify(merged));
        return json({ success: true, total: Object.keys(merged).length, added: Object.keys(secrets).length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/routing/log" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ error: "No KV" }, 200, origin);
        var last = await env.PRISM_KV.get("routing:last");
        var lastFail = await env.PRISM_KV.get("routing:last-failure");
        return json({
          lastSuccess: last ? JSON.parse(last) : null,
          lastFailure: lastFail ? JSON.parse(lastFail) : null
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/routing/chains" && request.method === "GET") {
      var chains = {
        chat: [
          { pos: 1, provider: "cerebras", models: ["llama-4-scout-17b-16e-instruct", "qwen-3.8-27b", "gpt-oss-120b"], keys: 4, ctx: 8192, cost: "free", note: "4 keys x 3 models = 12 free attempts" },
          { pos: 2, provider: "groq", models: ["gemma2-9b-it", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"], keys: 3, ctx: 32768, cost: "free", note: "3 keys x 3 models = 9 free attempts" },
          { pos: 3, provider: "chutes", models: ["DeepSeek-V3-0324"], keys: 1, ctx: 64e3, cost: "free", note: "DeepSeek V3 free -- world-class quality" },
          { pos: 4, provider: "gemini", models: ["gemini-2.5-flash"], keys: 1, ctx: 1e6, cost: "free", note: "Gemini Flash free -- 1M ctx" },
          { pos: 5, provider: "deepseek", models: ["deepseek-chat (f1,f2)"], keys: 2, ctx: 64e3, cost: "free", note: "DeepSeek Chat free keys" },
          { pos: 6, provider: "sambanova", models: ["Meta-Llama-3.3-70B-Instruct"], keys: 1, ctx: 8192, cost: "free", note: "SambaNova free" },
          { pos: 7, provider: "nebius", models: ["Meta-Llama-3.1-70B-Instruct"], keys: 1, ctx: 32768, cost: "free", note: "Nebius free -- 32K ctx" },
          { pos: 8, provider: "openrouter", models: ["gemma-2-9b-it:free"], keys: 1, ctx: 8192, cost: "free", note: "OpenRouter free" },
          { pos: 9, provider: "llm7", models: ["gpt-4o-mini"], keys: 2, ctx: 128e3, cost: "free", note: "LLM7 free -- 128K ctx" },
          { pos: 10, provider: "kimi", models: ["moonshot-v1-8k"], keys: 1, ctx: 8e3, cost: "$0.12/1M", note: "Kimi paid -- $15 credit" },
          { pos: 11, provider: "deepseek", models: ["deepseek-chat (paid)"], keys: 1, ctx: 64e3, cost: "$0.14/1M", note: "DeepSeek Chat paid" },
          { pos: 12, provider: "mistral", models: ["mistral-small-latest"], keys: 1, ctx: 32e3, cost: "$0.20/1M", note: "Mistral paid -- EU" },
          { pos: 13, provider: "cohere", models: ["command-r"], keys: 1, ctx: 128e3, cost: "$0.15/1M", note: "Cohere paid -- 128K ctx" },
          { pos: 14, provider: "together", models: ["Llama-3.3-70B-Instruct-Turbo"], keys: 1, ctx: 131072, cost: "$0.18/1M", note: "Together paid" },
          { pos: 15, provider: "fireworks", models: ["llama-v3p3-70b-instruct"], keys: 1, ctx: 131072, cost: "$0.20/1M", note: "Fireworks paid" },
          { pos: 16, provider: "gemini", models: ["gemini-2.5-flash"], keys: 1, ctx: 1e6, cost: "$0.075/1M", note: "Gemini Flash paid -- 1M ctx" },
          { pos: 17, provider: "anyapi", models: ["gpt-4o-mini"], keys: 1, ctx: 128e3, cost: "$0.15/1M", note: "AnyAPI paid" },
          { pos: 18, provider: "muse", models: ["auto"], keys: 1, ctx: 8192, cost: "free", note: "Muse auto-routing" },
          { pos: 19, provider: "huggingface", models: ["Llama-3.1-8B-Instruct"], keys: 1, ctx: 8192, cost: "free", note: "HuggingFace -- slow" },
          { pos: 20, provider: "modelslab", models: ["llama-3-8b-chat"], keys: 1, ctx: 4096, cost: "free", note: "Small model" },
          { pos: 21, provider: "xai", models: ["grok-beta"], keys: 1, ctx: 131072, cost: "$5/1M", note: "Grok -- expensive last resort" },
          { pos: 22, provider: "pollinations", models: ["openai", "mistral", "llama"], keys: 3, ctx: 4096, cost: "free (Pollen)", note: "Guaranteed fallback" }
        ],
        reasoning: [
          { pos: 1, provider: "nvidia", models: ["llama-3.1-nemotron-ultra-253b-v1"], keys: 2, ctx: 128e3, cost: "free", note: "Nemotron Ultra 253B -- best free reasoning" },
          { pos: 2, provider: "deepseek", models: ["deepseek-reasoner"], keys: 1, ctx: 64e3, cost: "$0.55/1M", note: "DeepSeek R1 -- chain-of-thought" },
          { pos: 3, provider: "gemini", models: ["gemini-2.5-flash"], keys: 1, ctx: 32e3, cost: "free", note: "Gemini thinking mode" },
          { pos: 4, provider: "kimi", models: ["moonshot-v1-32k"], keys: 1, ctx: 32e3, cost: "$0.12/1M", note: "Kimi 32K" },
          { pos: 5, provider: "cohere", models: ["command-r-plus-08-2024"], keys: 1, ctx: 128e3, cost: "$3/1M", note: "Cohere R+ -- strong reasoning" },
          { pos: 6, provider: "openrouter", models: ["deepseek/deepseek-chat"], keys: 1, ctx: 64e3, cost: "free", note: "DeepSeek R1 free via OpenRouter" }
        ],
        coding: [
          { pos: 1, provider: "deepseek", models: ["deepseek-chat"], keys: 3, ctx: 64e3, cost: "$0.14/1M", note: "DeepSeek -- excellent at code" },
          { pos: 2, provider: "cerebras", models: ["gpt-oss-120b"], keys: 4, ctx: 8192, cost: "free", note: "GPT-OSS 120B -- strong coder" },
          { pos: 3, provider: "groq", models: ["llama-3.3-70b-versatile"], keys: 3, ctx: 32768, cost: "free", note: "Llama 70B on Groq" },
          { pos: 4, provider: "mistral", models: ["codestral-latest"], keys: 1, ctx: 32e3, cost: "$1/1M", note: "Codestral -- code specialist" },
          { pos: 5, provider: "together", models: ["Llama-3.3-70B-Instruct-Turbo"], keys: 1, ctx: 131072, cost: "$0.18/1M", note: "Together Llama 70B" }
        ],
        long_context: [
          { pos: 1, provider: "kimi", models: ["moonshot-v1-128k"], keys: 1, ctx: 128e3, cost: "$0.12/1M", note: "Kimi 128K -- best long-ctx" },
          { pos: 2, provider: "gemini", models: ["gemini-2.5-pro"], keys: 1, ctx: 1e6, cost: "$3.5/1M", note: "Gemini 1M context" },
          { pos: 3, provider: "cohere", models: ["command-r-plus-08-2024"], keys: 1, ctx: 128e3, cost: "$3/1M", note: "Cohere 128K" },
          { pos: 4, provider: "deepseek", models: ["deepseek-chat"], keys: 3, ctx: 64e3, cost: "$0.14/1M", note: "DeepSeek 64K" },
          { pos: 5, provider: "openrouter", models: ["anthropic/claude-3-haiku:beta"], keys: 1, ctx: 2e5, cost: "$0.25/1M", note: "Claude 200K via OpenRouter" }
        ]
      };
      return json({ chains, total_providers: 21, total_models: 35, total_keys: 90 }, 200, origin);
    }
    if (path === "/api/d1/test" && request.method === "POST") {
      try {
        if (!env.PRISM_D1) return json({ error: "PRISM_D1 not bound" }, 200, origin);
        var body = await request.json();
        var testId = "diag-" + Date.now();
        await env.PRISM_D1.prepare(
          "INSERT INTO threads (id, title, persona, profile, message_count, auto_tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(testId, "Diagnostic Test", "Gerald", "fast", 0, '["test"]', (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString()).run();
        var row = await env.PRISM_D1.prepare("SELECT * FROM threads WHERE id = ?").bind(testId).first();
        await env.PRISM_D1.prepare("DELETE FROM threads WHERE id = ?").bind(testId).run();
        return json({ success: true, inserted: !!row, row }, 200, origin);
      } catch (e) {
        return json({ error: e.message, stack: e.stack ? e.stack.substring(0, 300) : "" }, 500, origin);
      }
    }
    if (path === "/api/threads/cleanup-tests" && request.method === "POST") {
      try {
        var testPatterns = ["Say OK", "Say hi", "What is 2+2", "Hello Gerald", "Say hello", "test-thread", "test-d1", "final-test", "kv-debug", "debug-d1", "final-v3"];
        var cleaned = 0;
        if (env.PRISM_D1) {
          for (var i = 0; i < testPatterns.length; i++) {
            var r = await env.PRISM_D1.prepare(
              'UPDATE threads SET archived = 1, auto_tags = json_insert(auto_tags, "$[#]", "test-cleanup") WHERE title LIKE ? AND archived = 0'
            ).bind("%" + testPatterns[i] + "%").run();
            cleaned += r.meta ? r.meta.changes || 0 : 0;
          }
        }
        if (env.PRISM_KV) {
          var idxRaw = await env.PRISM_KV.get("threads:index");
          if (idxRaw) {
            var idx = JSON.parse(idxRaw);
            var before = idx.length;
            idx = idx.filter(function(t2) {
              return !testPatterns.some(function(p) {
                return (t2.title || "").toLowerCase().includes(p.toLowerCase());
              });
            });
            if (idx.length < before) {
              await env.PRISM_KV.put("threads:index", JSON.stringify(idx));
              cleaned += before - idx.length;
            }
          }
        }
        return json({ success: true, cleaned }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/notion-url" && request.method === "GET") {
      var notionDb = env.NOTION_DB || env.NOTION_DB_ID;
      if (notionDb) {
        return json({ url: "https://www.notion.so/" + notionDb.replace(/-/g, "") }, 200, origin);
      }
      return json({ url: "https://www.notion.so" }, 200, origin);
    }
    if (path === "/api/morning-briefing" && request.method === "GET") {
      try {
        var contextParts = [];
        if (env.PRISM_KV) {
          try {
            var qList = await env.PRISM_KV.list({ prefix: "queue:" });
            var pending = (qList.keys || []).filter(function(k) {
              return !k.name.includes(":posted");
            }).length;
            contextParts.push("Social queue: " + pending + " items queued.");
          } catch (e) {
          }
        }
        try {
          var mailSummary = await getZohoInboxSummary(env);
          if (mailSummary) {
            contextParts.push("Email: " + mailSummary.unread + " unread in inbox.");
            if (mailSummary.messages && mailSummary.messages.length > 0) {
              var subjects = mailSummary.messages.slice(0, 2).map(function(m2) {
                return '"' + (m2.subject || "").substring(0, 50) + '"';
              }).join(", ");
              contextParts.push("Recent: " + subjects);
            }
          }
        } catch (e) {
        }
        if (env.PRISM_KV) {
          try {
            var lr = await env.PRISM_KV.get("research:latest");
            if (lr) {
              var lrd = JSON.parse(lr);
              contextParts.push("Research: " + lrd.count + " findings scraped on " + new Date(lrd.runAt).toLocaleDateString("en-GB") + ".");
            }
          } catch (e) {
          }
        }
        if (env.PRISM_D1) {
          try {
            var tc = await env.PRISM_D1.prepare("SELECT COUNT(*) as cnt FROM threads WHERE archived = 0").first();
            if (tc) contextParts.push("Memory: " + tc.cnt + " conversation threads.");
          } catch (e) {
          }
        }
        var context = contextParts.length > 0 ? contextParts.join(" ") : "No live data available right now.";
        return json({ context, parts: contextParts }, 200, origin);
      } catch (e) {
        return json({ context: "No data available.", error: e.message }, 200, origin);
      }
    }
    if (path === "/api/canvas/templates" && request.method === "POST") {
      try {
        var body = await request.json();
        if (env.PRISM_KV) await env.PRISM_KV.put("canvas:templates", JSON.stringify(body));
        return json({ success: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/templates" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ templates: [] }, 200, origin);
        var raw = await env.PRISM_KV.get("canvas:templates");
        if (raw) return json(JSON.parse(raw), 200, origin);
        return json({ templates: [
          { key: "ig-template-0.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-0.png", name: "ip-teal-1" },
          { key: "ig-template-1.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-1.png", name: "ip-teal-2" },
          { key: "ig-template-2.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-2.png", name: "ip-teal-3" },
          { key: "ig-template-3.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-3.png", name: "ip-rose-1" },
          { key: "ig-template-4.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-4.png", name: "ip-rose-2" },
          { key: "ig-template-5.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-5.png", name: "ip-rose-3" },
          { key: "ig-template-6.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-6.png", name: "ip-ivory-1" },
          { key: "ig-template-7.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-7.png", name: "ip-ivory-2" },
          { key: "ig-template-8.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-8.png", name: "ip-ivory-3" },
          { key: "ig-template-9.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-9.png", name: "ip-dark-1" },
          { key: "ig-template-10.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-10.png", name: "ip-dark-2" },
          { key: "ig-template-11.png", url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-11.png", name: "ip-dark-3" }
        ] }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/canvas/serve/") && request.method === "GET") {
      try {
        var key = path.replace("/api/canvas/serve/", "");
        if (!key || !key.endsWith(".png")) return json({ error: "Invalid key" }, 400, origin);
        if (!env.PRISM_ASSETS) return json({ error: "R2 not bound" }, 500, origin);
        var obj = await env.PRISM_ASSETS.get(key);
        if (!obj) return json({ error: "Not found: " + key }, 404, origin);
        var buf = await obj.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
            "X-Key": key
          }
        });
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/agents/canvas-regen" && request.method === "POST") {
      try {
        var body = await request.json();
        var quotes = body.quotes || null;
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        var geminiKey = env.gemini_paid_api_key || env.GEMINI_PAID_1 || env.gemini_api_key;
        var log = [];
        var approved = [];
        var rejected = [];
        if (!browserlessKey) return json({ error: "BROWSERLESS.IO key required" }, 200, origin);
        if (!quotes || quotes.length === 0) {
          log.push("Generating quotes from research + memory...");
          var latestResearch = null;
          if (env.PRISM_KV) {
            try {
              var lr = await env.PRISM_KV.get("research:latest");
              if (lr) latestResearch = JSON.parse(lr);
            } catch (e) {
            }
          }
          var researchContext = latestResearch ? latestResearch.results.slice(0, 3).map(function(r2) {
            return r2.title + ": " + r2.snippet;
          }).join("\n") : "";
          var quoteResult = await orchestrate(env, [
            { role: "system", content: "You are a content creator for Identity Partners. Generate 12 powerful, distinct quotes about addiction recovery, trauma, identity, mental health, and human connection. Each quote should be 15-25 words. British English. No clichs. No yoga retreat language. Return as a JSON array of strings only." },
            { role: "user", content: "Generate 12 quotes for social media canvas cards." + (researchContext ? "\n\nRecent research context:\n" + researchContext : "") }
          ], "balanced", "drafting", null);
          try {
            var qm = quoteResult.content.match(/\[\s*"[\s\S]*"\s*\]/);
            quotes = qm ? JSON.parse(qm[0]) : quoteResult.content.split("\n").filter(function(l) {
              return l.trim().length > 20;
            }).slice(0, 12);
          } catch (e) {
            quotes = [
              "Recovery is not a destination. It is a way of living.",
              "The most evidence-based intervention we have is genuine human connection.",
              "Identity is not fixed. It is rebuilt in the presence of people who see us clearly.",
              "Addiction is not a character flaw. It is what happens when pain has nowhere else to go.",
              "Late diagnosis is not a label. It is a map -- finally showing you the terrain you have always been navigating.",
              "Accountability in mental health is not about blame. It is about being honest enough to change.",
              "We see risk not in the presence of an interpersonal relationship, but in the absence of one.",
              "Understanding your past is not about blame. It is about finally making sense of yourself.",
              "Recovery is anchored in real relationships -- the brain rewires when we feel seen, not just treated.",
              "The gap between what we know about trauma and what our services do about it remains unconscionably wide.",
              "Peer support is not a nice-to-have. It is the intervention with the strongest evidence base.",
              "The relational space between coaching and therapy is where the most important work happens."
            ];
          }
          log.push("Generated " + quotes.length + " quotes");
        }
        var THEMES = [
          { bg: "#0f3b3a", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(15,59,58,0.78)", name: "teal" },
          { bg: "#5c2d3f", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(92,45,63,0.78)", name: "rose" },
          { bg: "#f7f3e9", text: "#0f3b3a", accent: "#5c2d3f", overlay: "rgba(247,243,233,0.85)", name: "ivory" },
          { bg: "#1a1a1a", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(10,10,10,0.80)", name: "dark" }
        ];
        var BG_IMGS = [
          "https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1624496/pexels-photo-1624496.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/2559941/pexels-photo-2559941.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1906658/pexels-photo-1906658.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1761279/pexels-photo-1761279.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1366919/pexels-photo-1366919.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/2325446/pexels-photo-2325446.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1323550/pexels-photo-1323550.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop",
          "https://images.pexels.com/photos/1591382/pexels-photo-1591382.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop"
        ];
        var limit = Math.min(quotes.length, 12);
        log.push("Rendering " + limit + " canvases via Browserless...");
        for (var i = 0; i < limit; i++) {
          var quote = (quotes[i] || "").replace(/^["\u201c]|["\u201d]$/g, "").trim();
          var theme = THEMES[i % THEMES.length];
          var bgImg = BG_IMGS[i % BG_IMGS.length];
          var safeQ = quote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
          var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1080px;height:1080px;overflow:hidden;font-family:"Playfair Display",Georgia,serif;}.canvas{width:1080px;height:1080px;position:relative;background:' + theme.bg + ' url("' + bgImg + '") center/cover no-repeat;display:flex;flex-direction:column;align-items:center;justify-content:center;}.overlay{position:absolute;inset:0;background:' + theme.overlay + ";}.accent-top{position:absolute;top:0;left:0;right:0;height:10px;background:" + theme.accent + ";opacity:0.85;}.accent-bottom{position:absolute;bottom:0;left:0;right:0;height:10px;background:" + theme.accent + ";opacity:0.85;}.content{position:relative;z-index:10;text-align:center;padding:80px 100px;}.open-quote{font-size:130px;color:" + theme.text + ";opacity:0.1;line-height:0.7;margin-bottom:20px;}.quote{font-size:52px;font-style:italic;color:" + theme.text + ";line-height:1.45;font-weight:400;}.divider{width:320px;height:2px;background:" + theme.accent + ";opacity:0.65;margin:40px auto;}.wordmark{font-size:32px;font-weight:600;font-style:normal;letter-spacing:-0.5px;}.identity{color:#0f3b3a;}.partners{color:#5c2d3f;}.tagline{font-size:18px;font-style:italic;color:" + theme.accent + ";opacity:0.85;margin-top:8px;}.footer{position:absolute;bottom:28px;left:0;right:0;text-align:center;font-size:18px;color:" + theme.accent + ';font-family:"Inter",sans-serif;opacity:0.85;}.grid{position:absolute;top:30px;left:30px;width:100px;height:100px;display:grid;grid-template-columns:1fr 1fr;gap:4px;}.grid div{border-radius:6px;}.logo-area{position:absolute;top:30px;right:30px;width:130px;height:130px;display:flex;align-items:center;justify-content:center;}</style></head><body><div class="canvas"><div class="overlay"></div><div class="accent-top"></div><div class="accent-bottom"></div><div class="grid"><div style="background:#0f3b3a;"></div><div style="background:#5c2d3f;"></div><div style="background:#1a5550;"></div><div style="background:#7a4254;"></div></div><div class="logo-area"><svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;"><rect x="5" y="5" width="50" height="50" rx="10" fill="#0f3b3a" opacity="0.9"/><rect x="65" y="5" width="50" height="50" rx="10" fill="#5c2d3f" opacity="0.9"/><rect x="5" y="65" width="50" height="50" rx="10" fill="#5c2d3f" opacity="0.7"/><rect x="65" y="65" width="50" height="50" rx="10" fill="#0f3b3a" opacity="0.7"/><text x="60" y="68" font-family="Inter,sans-serif" font-size="14" fill="#f7f3e9" text-anchor="middle" font-weight="600">IP</text></svg></div><div class="content"><div class="open-quote">&ldquo;</div><div class="quote">' + safeQ + '</div><div class="divider"></div><div class="wordmark"><span class="identity">Identity</span><span class="partners">Partners</span></div><div class="tagline">Understand your past &middot; Appreciate the present &middot; Define your future</div></div><div class="footer">identitypartners.uk &nbsp;&middot;&nbsp; hello@identitypartners.uk</div></div></body></html>';
          try {
            var blResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ html, options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false }, waitForTimeout: 5e3 })
            });
            if (!blResp.ok) {
              log.push("Canvas " + i + ": Browserless HTTP " + blResp.status);
              continue;
            }
            var pngBuf = await blResp.arrayBuffer();
            if (pngBuf.byteLength < 1e4) {
              log.push("Canvas " + i + ": PNG too small (" + pngBuf.byteLength + " bytes)");
              continue;
            }
            var qaPass = true;
            var qaReason = "No vision model available -- auto-approved";
            if (geminiKey) {
              try {
                var pngB64 = btoa(String.fromCharCode(...new Uint8Array(pngBuf)));
                var qaResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contents: [{ parts: [
                    { text: "You are a quality control agent for Identity Partners social media. Review this canvas image. Check: (1) Is the quote text clearly readable? (2) Is the logo visible in the top-right? (3) Is the colour grid visible in the top-left? (4) Does it look professional? Reply with PASS or FAIL followed by one sentence reason." },
                    { inline_data: { mime_type: "image/png", data: pngB64.substring(0, 1e5) } }
                  ] }] })
                });
                var qaData = await qaResp.json();
                var qaText = qaData.candidates && qaData.candidates[0] && qaData.candidates[0].content && qaData.candidates[0].content.parts && qaData.candidates[0].content.parts[0] && qaData.candidates[0].content.parts[0].text || "";
                qaPass = qaText.toUpperCase().startsWith("PASS") || qaText.toUpperCase().includes("PASS");
                qaReason = qaText.substring(0, 100);
              } catch (qaErr) {
                qaReason = "Vision QA error: " + qaErr.message;
              }
            }
            if (qaPass) {
              var r2Key = "ig-template-" + i + ".png";
              if (env.PRISM_ASSETS) {
                await env.PRISM_ASSETS.put(r2Key, pngBuf, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 90 });
              }
              approved.push({ index: i, key: r2Key, quote: quote.substring(0, 60), theme: theme.name, qa: qaReason, size: pngBuf.byteLength });
              log.push("Canvas " + i + " (" + theme.name + "): APPROVED -- " + qaReason.substring(0, 60));
            } else {
              rejected.push({ index: i, quote: quote.substring(0, 60), reason: qaReason });
              log.push("Canvas " + i + " (" + theme.name + "): REJECTED -- " + qaReason.substring(0, 60));
            }
          } catch (canvasErr) {
            log.push("Canvas " + i + ": Error -- " + canvasErr.message);
          }
        }
        var tgToken = env.TELEGRAM_TOKEN || env.telegram_bot_token;
        var tgChat = env.TELEGRAM_CHAT || env.TELEGRAM_CHAT_ID;
        if (tgToken && tgChat) {
          var summary = " Canvas Regeneration Complete\n\n Approved: " + approved.length + "/" + limit + "\n Rejected: " + rejected.length + "\n\nApproved themes: " + approved.map(function(a) {
            return a.theme;
          }).join(", ") + "\n\nThese are now live for Instagram/Facebook posts.";
          await fetch("https://api.telegram.org/bot" + tgToken + "/sendMessage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: tgChat, text: summary })
          });
        }
        return json({
          success: true,
          approved: approved.length,
          rejected: rejected.length,
          total: limit,
          log,
          approvedTemplates: approved,
          rejectedTemplates: rejected
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message, stack: e.stack ? e.stack.substring(0, 300) : "" }, 500, origin);
      }
    }
    if (path === "/api/music/generate" && request.method === "POST") {
      try {
        var body = await request.json();
        var prompt = body.prompt || "Calm ambient instrumental, therapeutic, warm";
        var style = body.style || "ambient instrumental";
        var instrumental = body.instrumental !== false;
        var kieKey = env.KIE_AI || env.kie_ai;
        if (!kieKey) return json({ error: "KIE_AI key not configured" }, 200, origin);
        var result = await generateMusicKie(kieKey, prompt, style, instrumental);
        var taskId = result.taskId;
        if (!taskId) return json({ error: "No task ID from kie.ai" }, 200, origin);
        for (var i = 0; i < 12; i++) {
          await new Promise(function(r2) {
            setTimeout(r2, 5e3);
          });
          var status = await getMusicStatusKie(kieKey, taskId);
          if (status.status === "completed" || status.status === "success") {
            var audioUrl = status.audio_url || status.data && status.data[0] && status.data[0].audio_url;
            if (audioUrl) {
              if (env.PRISM_KV) await env.PRISM_KV.put("music:" + taskId, JSON.stringify({ url: audioUrl, prompt, created: (/* @__PURE__ */ new Date()).toISOString() }), { expirationTtl: 86400 * 30 });
              return json({ success: true, url: audioUrl, taskId, provider: "kie.ai/suno-v5.5" }, 200, origin);
            }
          }
          if (status.status === "failed") return json({ error: "Music generation failed", status }, 200, origin);
        }
        return json({ success: false, taskId, message: "Still generating -- poll /api/music/status/" + taskId }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path.startsWith("/api/music/status/") && request.method === "GET") {
      try {
        var taskId2 = path.replace("/api/music/status/", "");
        var kieKey2 = env.KIE_AI || env.kie_ai;
        if (!kieKey2) return json({ error: "KIE_AI key not configured" }, 200, origin);
        var status2 = await getMusicStatusKie(kieKey2, taskId2);
        return json(status2, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/image/kie" && request.method === "POST") {
      try {
        var body = await request.json();
        var prompt2 = body.prompt || "";
        var model2 = body.model || "z-image";
        var kieKey3 = env.KIE_AI || env.kie_ai;
        if (!kieKey3) return json({ error: "KIE_AI key not configured" }, 200, origin);
        var imgResult = await generateImageKie(kieKey3, model2, prompt2);
        return json({ success: true, url: imgResult.url, provider: imgResult.provider }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/agent/pipeline" && request.method === "POST") {
      try {
        var body = await request.json();
        var config = {
          topic: body.topic || "addiction recovery",
          spreadDays: body.spreadDays || 7,
          scheduleFrom: body.scheduleFrom || null,
          maxFindings: body.maxFindings || 20
        };
        if (!config.topic) return json({ error: "topic required" }, 400, origin);
        var result = await runAgenticPipeline(env, config);
        return json(result, 200, origin);
      } catch (e) {
        return json({ error: e.message, stack: e.stack ? e.stack.substring(0, 300) : "" }, 500, origin);
      }
    }
    if (path === "/api/topics" && request.method === "POST") {
      try {
        var body = await request.json();
        var topics = body.topics || [];
        if (!Array.isArray(topics) || topics.length === 0) return json({ error: "topics array required" }, 400, origin);
        var queue = {
          topics: topics.map(function(t2, i2) {
            return { id: "topic-" + i2, text: t2.trim(), status: "pending", runCount: 0, lastRun: null };
          }),
          currentIndex: 0,
          created: (/* @__PURE__ */ new Date()).toISOString(),
          updated: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (env.PRISM_KV) await env.PRISM_KV.put("topic-queue", JSON.stringify(queue));
        return json({ success: true, count: topics.length, queue }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/topics" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ queue: null }, 200, origin);
        var raw = await env.PRISM_KV.get("topic-queue");
        if (!raw) return json({ queue: null, message: "No topic queue set" }, 200, origin);
        return json({ queue: JSON.parse(raw) }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/topics/next" && request.method === "POST") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 500, origin);
        var raw = await env.PRISM_KV.get("topic-queue");
        if (!raw) return json({ error: "No topic queue set. POST to /api/topics first." }, 200, origin);
        var queue = JSON.parse(raw);
        var topics = queue.topics || [];
        if (topics.length === 0) return json({ error: "Topic queue is empty" }, 200, origin);
        var idx = queue.currentIndex || 0;
        var topic = topics[idx % topics.length];
        queue.currentIndex = (idx + 1) % topics.length;
        topic.runCount = (topic.runCount || 0) + 1;
        topic.lastRun = (/* @__PURE__ */ new Date()).toISOString();
        topic.status = "running";
        queue.updated = (/* @__PURE__ */ new Date()).toISOString();
        await env.PRISM_KV.put("topic-queue", JSON.stringify(queue));
        return json({ topic: topic.text, index: idx, total: topics.length, nextIndex: queue.currentIndex }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/topics/reset" && request.method === "POST") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 500, origin);
        var raw = await env.PRISM_KV.get("topic-queue");
        if (!raw) return json({ error: "No queue" }, 200, origin);
        var queue = JSON.parse(raw);
        queue.currentIndex = 0;
        queue.topics.forEach(function(t2) {
          t2.status = "pending";
          t2.runCount = 0;
          t2.lastRun = null;
        });
        queue.updated = (/* @__PURE__ */ new Date()).toISOString();
        await env.PRISM_KV.put("topic-queue", JSON.stringify(queue));
        return json({ success: true, message: "Queue reset to beginning" }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/topics/add" && request.method === "POST") {
      try {
        var body = await request.json();
        var newTopic = (body.topic || "").trim();
        if (!newTopic) return json({ error: "topic required" }, 400, origin);
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 500, origin);
        var raw = await env.PRISM_KV.get("topic-queue");
        var queue = raw ? JSON.parse(raw) : { topics: [], currentIndex: 0, created: (/* @__PURE__ */ new Date()).toISOString() };
        queue.topics.push({ id: "topic-" + Date.now(), text: newTopic, status: "pending", runCount: 0, lastRun: null });
        queue.updated = (/* @__PURE__ */ new Date()).toISOString();
        await env.PRISM_KV.put("topic-queue", JSON.stringify(queue));
        return json({ success: true, count: queue.topics.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/topics/remove" && request.method === "POST") {
      try {
        var body = await request.json();
        var topicText = (body.topic || "").trim();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 500, origin);
        var raw = await env.PRISM_KV.get("topic-queue");
        if (!raw) return json({ error: "No queue" }, 200, origin);
        var queue = JSON.parse(raw);
        var before = queue.topics.length;
        queue.topics = queue.topics.filter(function(t2) {
          return t2.text.toLowerCase() !== topicText.toLowerCase();
        });
        queue.currentIndex = Math.min(queue.currentIndex, Math.max(0, queue.topics.length - 1));
        queue.updated = (/* @__PURE__ */ new Date()).toISOString();
        await env.PRISM_KV.put("topic-queue", JSON.stringify(queue));
        return json({ success: true, removed: before - queue.topics.length, remaining: queue.topics.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/models/test" && request.method === "POST") {
      try {
        var body = await request.json();
        var provider = body.provider;
        var model = body.model;
        var key = body.key || null;
        if (!key) {
          let k3 = function(names2) {
            for (var i2 = 0; i2 < names2.length; i2++) {
              var n = names2[i2];
              var v2 = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()] || kv3[n] || kv3[n.toLowerCase()] || kv3[n.toUpperCase()];
              if (v2 && v2.length > 6) return v2;
            }
            return null;
          };
          __name(k3, "k3");
          var kv3 = {};
          try {
            if (env.PRISM_KV) {
              var raw3 = await env.PRISM_KV.get("__secrets__");
              if (raw3) kv3 = JSON.parse(raw3);
            }
          } catch (e) {
          }
          var keyMap = {
            cerebras: k3(["cerebras_api_key", "CEREBRAS_PAID_1", "CEREBRAS_PAID_2"]),
            groq: k3(["GROQ_PAID_1", "groq_api_key", "GROQ_API_KEY"]),
            gemini: k3(["GEMINI_PAID_1", "GEMINI_FREE_1", "gemini_paid_api_key", "gemini_api_key"]),
            deepseek: k3(["DEEPSEEK_PAID_1", "deepseek_api_key"]),
            kimi: k3(["KIMI_PAID_1", "kimi_api_key"]),
            mistral: k3(["MISTRAL_FREE_1", "MISTRAL_PAID_1", "mistral_api_key"]),
            kie: k3(["KIE_AI", "kie_ai"]),
            nvidia: k3(["NVIDIA_PAID_1", "nvidia_build_api_key"]),
            cohere: k3(["COHERE_PAID_1", "cohere_api_key"]),
            xai: k3(["XAI_PAID_1"]),
            pollinations: k3(["POLLINATIONS_FREE_1", "pollinations_key"])
          };
          key = keyMap[provider];
        }
        if (!key && provider !== "pollinations") return json({ error: "No key for " + provider }, 200, origin);
        try {
          var result = await Promise.race([
            callProvider(env, provider, key, model, [{ role: "user", content: "Say OK in one word." }]),
            new Promise(function(_, reject) {
              setTimeout(function() {
                reject(new Error("timeout"));
              }, 1e4);
            })
          ]);
          return json({ success: true, provider, model, content: result.content.substring(0, 50) }, 200, origin);
        } catch (e) {
          return json({ success: false, provider, model, error: e.message.substring(0, 100) }, 200, origin);
        }
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/models/groq" && request.method === "GET") {
      try {
        let k4 = function(names2) {
          for (var i2 = 0; i2 < names2.length; i2++) {
            var n = names2[i2];
            var v2 = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()] || kv4[n] || kv4[n.toLowerCase()] || kv4[n.toUpperCase()];
            if (v2 && v2.length > 6) return v2;
          }
          return null;
        };
        __name(k4, "k4");
        var kv4 = {};
        try {
          if (env.PRISM_KV) {
            var raw4 = await env.PRISM_KV.get("__secrets__");
            if (raw4) kv4 = JSON.parse(raw4);
          }
        } catch (e) {
        }
        var groqKey = k4(["GROQ_PAID_1", "groq_api_key"]);
        if (!groqKey) return json({ error: "No Groq key" }, 200, origin);
        var r = await fetch("https://api.groq.com/openai/v1/models", { headers: { "Authorization": "Bearer " + groqKey } });
        if (!r.ok) return json({ error: "Groq HTTP " + r.status }, 200, origin);
        var d = await r.json();
        var models = (d.data || []).map(function(m2) {
          return { id: m2.id, created: m2.created };
        }).sort(function(a, b) {
          return b.created - a.created;
        });
        return json({ models }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/models/gemini" && request.method === "GET") {
      try {
        let k5 = function(names2) {
          for (var i2 = 0; i2 < names2.length; i2++) {
            var n = names2[i2];
            var v2 = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()] || kv5[n] || kv5[n.toLowerCase()] || kv5[n.toUpperCase()];
            if (v2 && v2.length > 6) return v2;
          }
          return null;
        };
        __name(k5, "k5");
        var kv5 = {};
        try {
          if (env.PRISM_KV) {
            var raw5 = await env.PRISM_KV.get("__secrets__");
            if (raw5) kv5 = JSON.parse(raw5);
          }
        } catch (e) {
        }
        var gKey = k5(["GEMINI_PAID_1", "GEMINI_FREE_1", "gemini_paid_api_key", "gemini_api_key"]);
        if (!gKey) return json({ error: "No Gemini key" }, 200, origin);
        var isAIStudio = gKey.startsWith("AQ.");
        var listUrl = isAIStudio ? "https://generativelanguage.googleapis.com/v1beta/models" : "https://generativelanguage.googleapis.com/v1beta/models?key=" + gKey;
        var listHeaders = { "Content-Type": "application/json" };
        if (isAIStudio) listHeaders["x-goog-api-key"] = gKey;
        var r = await fetch(listUrl, { headers: listHeaders });
        if (!r.ok) return json({ error: "Gemini list HTTP " + r.status, keyType: isAIStudio ? "AI Studio" : "API Key" }, 200, origin);
        var d = await r.json();
        var models = (d.models || []).filter(function(m2) {
          return m2.supportedGenerationMethods && m2.supportedGenerationMethods.indexOf("generateContent") >= 0;
        }).map(function(m2) {
          return m2.name;
        });
        return json({ models, keyType: isAIStudio ? "AI Studio (AQ.)" : "API Key (AIzaSy)", total: models.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/models/gemini-list" && request.method === "GET") {
      try {
        let k5 = function(names2) {
          for (var i2 = 0; i2 < names2.length; i2++) {
            var n = names2[i2];
            var v2 = env[n] || env[n.toLowerCase()] || env[n.toUpperCase()] || kv5[n] || kv5[n.toLowerCase()] || kv5[n.toUpperCase()];
            if (v2 && v2.length > 6) return v2;
          }
          return null;
        };
        __name(k5, "k5");
        var kv5 = {};
        try {
          if (env.PRISM_KV) {
            var raw5 = await env.PRISM_KV.get("__secrets__");
            if (raw5) kv5 = JSON.parse(raw5);
          }
        } catch (e) {
        }
        var gKey = k5(["GEMINI_PAID_1", "GEMINI_FREE_1", "gemini_paid_api_key", "gemini_api_key"]);
        if (!gKey) return json({ error: "No Gemini key" }, 200, origin);
        var isAIStudio = gKey.startsWith("AQ.");
        var listUrl = isAIStudio ? "https://generativelanguage.googleapis.com/v1beta/models" : "https://generativelanguage.googleapis.com/v1beta/models?key=" + gKey;
        var listHeaders = { "Content-Type": "application/json" };
        if (isAIStudio) listHeaders["x-goog-api-key"] = gKey;
        var r = await fetch(listUrl, { headers: listHeaders });
        if (!r.ok) return json({ error: "HTTP " + r.status, key_type: isAIStudio ? "AI Studio" : "API Key" }, 200, origin);
        var d = await r.json();
        var models = (d.models || []).filter(function(m2) {
          return m2.supportedGenerationMethods && m2.supportedGenerationMethods.indexOf("generateContent") >= 0;
        }).map(function(m2) {
          return m2.name;
        });
        return json({ models, key_type: isAIStudio ? "AI Studio" : "API Key", total: models.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/canvas/generate-and-store" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 200);
        var template = body.template || "quote-teal";
        var key = body.key || "canvas-" + Date.now() + ".svg";
        var svg = await generateCanvasHtml(text, template, env);
        if (!svg) return json({ error: "SVG generation failed" }, 200, origin);
        if (env.PRISM_ASSETS) {
          await env.PRISM_ASSETS.put(key, svg, {
            httpMetadata: { contentType: "image/svg+xml" },
            expirationTtl: 86400 * 90
          });
        }
        var serveUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + key;
        return json({ success: true, url: serveUrl, key }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/site/crawl" && request.method === "POST") {
      try {
        var body = await request.json();
        var targetUrl = body.url || "https://identitypartners.uk";
        var fcKey = env.firecrawl_api_key || env.FIRECRAWL_API_KEY;
        if (!fcKey) return json({ error: "firecrawl_api_key not configured" }, 200, origin);
        var cr = await fetch("https://api.firecrawl.dev/v1/crawl", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + fcKey }, body: JSON.stringify({ url: targetUrl, limit: 50, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }) });
        if (!cr.ok) return json({ error: "Firecrawl " + cr.status }, 200, origin);
        var cd = await cr.json();
        if (!cd.id) return json({ error: "No job ID" }, 200, origin);
        var pages = [];
        for (var att = 0; att < 12; att++) {
          await new Promise(function(r2) {
            setTimeout(r2, 5e3);
          });
          var sr = await fetch("https://api.firecrawl.dev/v1/crawl/" + cd.id, { headers: { "Authorization": "Bearer " + fcKey } });
          var sd = await sr.json();
          if (sd.status === "completed") {
            pages = sd.data || [];
            break;
          }
          if (sd.status === "failed") return json({ error: "Crawl failed" }, 200, origin);
        }
        if (!pages.length) return json({ error: "Crawl timed out", jobId: cd.id }, 200, origin);
        var chunks = [];
        for (var i = 0; i < pages.length; i++) {
          var pg = pages[i];
          var pgC = pg.markdown || pg.content || "";
          var pgU = pg.metadata && pg.metadata.sourceURL || "";
          var pgT = pg.metadata && pg.metadata.title || "";
          var ws = pgC.split(/\s+/);
          for (var j = 0; j < ws.length; j += 400) {
            var ck = ws.slice(j, j + 400).join(" ");
            if (ck.trim().length > 50) chunks.push({ url: pgU, title: pgT, chunk: ck });
          }
        }
        var kb = { crawledAt: (/* @__PURE__ */ new Date()).toISOString(), siteUrl: targetUrl, pageCount: pages.length, chunkCount: chunks.length, chunks: chunks.slice(0, 200), rawPages: pages.slice(0, 20).map(function(p) {
          return { url: p.metadata && p.metadata.sourceURL || "", title: p.metadata && p.metadata.title || "", content: (p.markdown || "").substring(0, 2e3) };
        }) };
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("site:knowledge-base", JSON.stringify(kb), { expirationTtl: 86400 * 7 });
          await env.PRISM_KV.put("site:crawl-status", JSON.stringify({ lastCrawl: (/* @__PURE__ */ new Date()).toISOString(), pageCount: pages.length, chunkCount: chunks.length }));
        }
        return json({ success: true, pageCount: pages.length, chunkCount: chunks.length, jobId: cd.id }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/site/knowledge-base" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var kbR = await env.PRISM_KV.get("site:knowledge-base");
        var csR = await env.PRISM_KV.get("site:crawl-status");
        if (!kbR) return json({ error: "No knowledge base. Run /api/site/crawl first." }, 200, origin);
        var kbD = JSON.parse(kbR);
        return json({ crawledAt: kbD.crawledAt, pageCount: kbD.pageCount, chunkCount: kbD.chunkCount, status: csR ? JSON.parse(csR) : null }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/site/generate-profiles" && request.method === "POST") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var kbR = await env.PRISM_KV.get("site:knowledge-base");
        if (!kbR) return json({ error: "No knowledge base. Run /api/site/crawl first." }, 200, origin);
        var kb = JSON.parse(kbR);
        var sCtx = kb.rawPages ? kb.rawPages.map(function(p) {
          return p.title + ": " + p.content;
        }).join(" --- ").substring(0, 8e3) : "";
        var pR = await orchestrate(env, [{ role: "system", content: "Audience intelligence analyst for Identity Partners. British English. Psychologically precise." }, { role: "user", content: "Generate 6 audience profiles as JSON array. Each: label,psychological_state,language_used,fears,click_triggers,trust_signals,search_queries. Website: " + sCtx }], "balanced", "research", null);
        var profiles = [];
        try {
          var jm = pR.content.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (jm) profiles = JSON.parse(jm[0]);
          else profiles = [{ raw: pR.content }];
        } catch (e) {
          profiles = [{ raw: pR.content }];
        }
        var pData = { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), profiles, provider: pR.provider };
        if (env.PRISM_KV) await env.PRISM_KV.put("site:audience-profiles", JSON.stringify(pData), { expirationTtl: 86400 * 30 });
        return json({ success: true, profileCount: profiles.length, profiles, provider: pR.provider }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/site/audience-profiles" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("site:audience-profiles");
        if (!raw) return json({ error: "No profiles. Run /api/site/generate-profiles first." }, 200, origin);
        return json(JSON.parse(raw), 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/pipeline/morning" && request.method === "POST") {
      try {
        var body = await request.json();
        var platforms = body.platforms || ["bluesky", "instagram", "facebook", "x", "linkedin"];
        var bufKey = env.BUFFER_API_KEY;
        var results = {};
        var errors = {};
        var pCtx = "";
        var bCtx = "";
        if (env.PRISM_KV) {
          var pRaw = await env.PRISM_KV.get("site:audience-profiles");
          if (pRaw) {
            var pd = JSON.parse(pRaw);
            pCtx = "Audience: " + (pd.profiles || []).slice(0, 3).map(function(p) {
              return (p.label || "Profile") + ": " + (p.psychological_state || "").substring(0, 100);
            }).join("; ");
          }
          var kRaw = await env.PRISM_KV.get("site:knowledge-base");
          if (kRaw) {
            var kd = JSON.parse(kRaw);
            bCtx = "Brand: " + (kd.rawPages || []).slice(0, 2).map(function(p) {
              return p.content.substring(0, 300);
            }).join(" ");
          }
        }
        var tvKey = env.tavily_api_key || env.TAVILY_API_KEY;
        var news = [];
        if (tvKey) {
          var terms = ["mental health UK news today", "addiction recovery research 2026", "neurodivergence ADHD identity", "trauma therapy evidence"];
          for (var si = 0; si < terms.length; si++) {
            try {
              var sr = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tvKey, query: terms[si], max_results: 3, search_depth: "basic", days: 1 }) });
              if (sr.ok) {
                var sd = await sr.json();
                (sd.results || []).forEach(function(r2) {
                  news.push({ title: r2.title, snippet: (r2.content || "").substring(0, 300) });
                });
              }
            } catch (e) {
            }
          }
        }
        var nCtx = news.slice(0, 6).map(function(n) {
          return n.title + ": " + n.snippet;
        }).join(" ||| ");
        var IPS = "You are the content voice for Identity Partners, a relational practice between coaching and therapy. British English. No sycophancy. No wellness retreat language. Direct, warm, evidence-informed.";
        var aR = await orchestrate(env, [{ role: "system", content: IPS }, { role: "user", content: "Today news: " + nCtx + " " + pCtx + " " + bCtx + " Select the most resonant story and write a position on it. 150-200 words. British English." }], "balanced", "drafting", null);
        var anchor = aR.content || "";
        var qR = await orchestrate(env, [{ role: "system", content: "Extract the single most striking standalone sentence. 15-25 words. No hashtags. Return only the sentence." }, { role: "user", content: anchor }], "fast", "drafting", null);
        var quote = (qR.content || "").replace(/^["\u201c]|["\u201d]$/g, "").trim();
        var bskyR = await orchestrate(env, [{ role: "system", content: IPS }, { role: "user", content: "Write a Bluesky post. Under 280 chars. Sharp, direct. No hashtags in body. End with identitypartners.uk. Anchor: " + anchor.substring(0, 500) }], "fast", "drafting", null);
        var xR = await orchestrate(env, [{ role: "system", content: IPS }, { role: "user", content: "Write an X post. Under 240 chars. Hook in first 5 words. identitypartners.uk at end. 1-2 hashtags. Anchor: " + anchor.substring(0, 500) }], "fast", "drafting", null);
        var liR = await orchestrate(env, [{ role: "system", content: IPS }, { role: "user", content: "Write a LinkedIn post. 150-200 words. Professional reflection. Question at end. 3 hashtags. CTA to identitypartners.uk/contact. Anchor: " + anchor }], "balanced", "drafting", null);
        var fbR = await orchestrate(env, [{ role: "system", content: IPS }, { role: "user", content: "Write a Facebook post. 100-150 words. Full thought. Question at end. Link to identitypartners.uk/contact. Anchor: " + anchor }], "fast", "drafting", null);
        var canvasUrl = null;
        var blKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        var tNames = ["quote-teal", "quote-rose", "quote-ivory"];
        var tmpl = tNames[(/* @__PURE__ */ new Date()).getDay() % 3];
        var tMap = { "quote-teal": { bg: "#0f3b3a", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(15,59,58,0.78)" }, "quote-rose": { bg: "#5c2d3f", text: "#f7f3e9", accent: "#ddd0c8", overlay: "rgba(92,45,63,0.78)" }, "quote-ivory": { bg: "#f7f3e9", text: "#0f3b3a", accent: "#5c2d3f", overlay: "rgba(247,243,233,0.85)" } };
        var t = tMap[tmpl];
        var bgImgs = ["https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1624496/pexels-photo-1624496.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/2559941/pexels-photo-2559941.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1906658/pexels-photo-1906658.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop", "https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg?auto=compress&cs=tinysrgb&w=1080&h=1080&fit=crop"];
        var bgUrl = bgImgs[(/* @__PURE__ */ new Date()).getDate() % bgImgs.length];
        var safeQ = quote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        if (blKey && quote) {
          var hp = '<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1080px;height:1080px;overflow:hidden;}.c{width:1080px;height:1080px;position:relative;background:' + t.bg + ' url("' + bgUrl + '") center/cover no-repeat;display:flex;flex-direction:column;align-items:center;justify-content:center;}.o{position:absolute;inset:0;background:' + t.overlay + ";}.at{position:absolute;top:0;left:0;right:0;height:10px;background:" + t.accent + ";opacity:0.85;}.ab{position:absolute;bottom:0;left:0;right:0;height:10px;background:" + t.accent + ";opacity:0.85;}.g{position:absolute;top:30px;left:30px;width:96px;height:96px;display:grid;grid-template-columns:1fr 1fr;gap:4px;}.g div{border-radius:6px;}.ct{position:relative;z-index:10;text-align:center;padding:80px 100px;}.oq{font-size:120px;color:" + t.text + ";opacity:0.1;line-height:0.7;margin-bottom:20px;font-family:Georgia,serif;}.q{font-size:52px;font-style:italic;color:" + t.text + ';line-height:1.45;font-weight:400;font-family:"Playfair Display",Georgia,serif;}.d{width:320px;height:2px;background:' + t.accent + ';opacity:0.65;margin:40px auto;}.wm{font-size:30px;font-weight:600;font-style:normal;font-family:"Playfair Display",Georgia,serif;}.i{color:#0f3b3a;}.p{color:#5c2d3f;}.tg{font-size:18px;color:' + t.accent + ';opacity:0.85;margin-top:8px;font-family:"Inter",sans-serif;}.f{position:absolute;bottom:28px;left:0;right:0;text-align:center;font-size:18px;color:' + t.accent + ';font-family:"Inter",sans-serif;opacity:0.85;}</style></head><body><div class="c"><div class="o"></div><div class="at"></div><div class="ab"></div><div class="g"><div style="background:#0f3b3a;"></div><div style="background:#5c2d3f;"></div><div style="background:#5c2d3f;"></div><div style="background:#0f3b3a;"></div></div><div class="ct"><div class="oq">&ldquo;</div><div class="q">' + safeQ + '</div><div class="d"></div><div class="wm"><span class="i">Identity</span><span class="p">Partners</span></div><div class="tg">Understand your past &middot; Appreciate the present &middot; Define your future</div></div><div class="f">identitypartners.uk &nbsp;&middot;&nbsp; hello@identitypartners.uk</div></div></body></html>';
          try {
            var blResp = await fetch("https://chrome.browserless.io/screenshot?token=" + blKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: hp, options: { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 }, fullPage: false }, waitForTimeout: 8e3 }) });
            if (blResp.ok) {
              var pngBuf = await blResp.arrayBuffer();
              if (pngBuf.byteLength > 5e3 && env.PRISM_ASSETS) {
                var ck = "morning-canvas-" + (/* @__PURE__ */ new Date()).toISOString().split("T")[0] + ".png";
                await env.PRISM_ASSETS.put(ck, pngBuf, { httpMetadata: { contentType: "image/png" }, expirationTtl: 86400 * 30 });
                canvasUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + ck;
              }
            }
          } catch (blErr2) {
            errors._canvas = blErr2.message;
          }
        }
        if (!canvasUrl) {
          canvasUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + (/* @__PURE__ */ new Date()).getDate() % 150 + ".png";
        }
        var caption = "hello@identitypartners.uk | identitypartners.uk/contact\n#IdentityPartners #MentalHealth #Recovery #Addiction #Wellbeing #Trauma";
        var igCh = "6a97edce065799be46722eab";
        var fbCh = "6a97ea40065799be46721fdd";
        var xCh = "6a97ebf1065799be46722744";
        for (var pli = 0; pli < platforms.length; pli++) {
          var plat = platforms[pli];
          try {
            if (plat === "bluesky") {
              results.bluesky = await postToBluesky(env, (bskyR.content || quote).substring(0, 280) + " identitypartners.uk");
            } else if ((plat === "instagram" || plat === "facebook") && bufKey) {
              var chId = plat === "instagram" ? igCh : fbCh;
              var pTxt = plat === "instagram" ? caption : (fbR.content || anchor).substring(0, 500) + "\n\n" + caption;
              var mStr = plat === "instagram" ? ",metadata:{instagram:{type:post,shouldShareToFeed:true}}" : ",metadata:{facebook:{type:post}}";
              var mut = JSON.stringify({ query: 'mutation{createPost(input:{channelId:"' + chId + '",text:' + JSON.stringify(pTxt) + ",assets:[{image:{url:" + JSON.stringify(canvasUrl) + "}}],mode:shareNow,needsApproval:false,schedulingType:automatic" + mStr + "}){...on PostActionSuccess{post{id status}}...on MutationError{message}}}" });
              var bR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: mut });
              var bD = await bR.json();
              var cp = (bD.data || {}).createPost || {};
              if (cp.post) results[plat] = { success: true, id: cp.post.id, imageUrl: canvasUrl };
              else errors[plat] = cp.message || "Buffer error";
            } else if (plat === "x" && bufKey) {
              var xTxt = xR.content || quote.substring(0, 220) + " identitypartners.uk #IdentityPartners #MentalHealth";
              var xMut = JSON.stringify({ query: 'mutation{createPost(input:{channelId:"' + xCh + '",text:' + JSON.stringify(xTxt) + ",assets:[{image:{url:" + JSON.stringify(canvasUrl) + "}}],mode:shareNow,needsApproval:false,schedulingType:automatic}){...on PostActionSuccess{post{id status}}...on MutationError{message}}}" });
              var xResp = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: xMut });
              var xD = await xResp.json();
              var xCp = (xD.data || {}).createPost || {};
              if (xCp.post) results.x = { success: true, id: xCp.post.id, imageUrl: canvasUrl };
              else errors.x = xCp.message || "Buffer error";
            } else if (plat === "linkedin") {
              var liTok = null;
              if (env.PRISM_KV) {
                var lt = await env.PRISM_KV.get("oauth:linkedin:tokens");
                if (lt) {
                  try {
                    liTok = JSON.parse(lt).access_token;
                  } catch (e) {
                  }
                }
              }
              if (!liTok) liTok = env.LINKEDIN_PAID_1 || env.LINKEDIN_PAID_2;
              if (liTok) {
                var meR = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { "Authorization": "Bearer " + liTok } });
                var meD = await meR.json();
                if (meD.sub) {
                  var liBody = { author: "urn:li:person:" + meD.sub, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: (liR.content || anchor).substring(0, 3e3) }, shareMediaCategory: "NONE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } };
                  var liResp = await fetch("https://api.linkedin.com/v2/ugcPosts", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + liTok, "X-Restli-Protocol-Version": "2.0.0" }, body: JSON.stringify(liBody) });
                  var liD = await liResp.json();
                  if (liResp.ok) results.linkedin = { success: true, id: liD.id };
                  else errors.linkedin = JSON.stringify(liD).substring(0, 100);
                }
              }
            }
          } catch (pe) {
            errors[plat] = pe.message;
          }
        }
        var runRec = { runAt: (/* @__PURE__ */ new Date()).toISOString(), type: "morning", anchorContent: anchor.substring(0, 500), quoteText: quote, canvasUrl, newsCount: news.length, results, errors };
        if (env.PRISM_KV) await env.PRISM_KV.put("pipeline:last-morning-run", JSON.stringify(runRec), { expirationTtl: 86400 * 7 });
        var tgTok = env.TELEGRAM_TOKEN || env.telegram_bot_token;
        var tgCh = env.TELEGRAM_CHAT || env.TELEGRAM_CHAT_ID;
        if (tgTok && tgCh) {
          var posted = Object.keys(results).filter(function(k) {
            return results[k] && results[k].success;
          });
          await fetch("https://api.telegram.org/bot" + tgTok + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgCh, text: "\u2600\uFE0F Morning pipeline\n\nPosted: " + posted.join(", ") + "\n\n" + anchor.substring(0, 200) + "..." }) });
        }
        return json({ success: true, results, errors, anchorContent: anchor.substring(0, 300), quoteText: quote, canvasUrl, newsCount: news.length }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/analytics/feedback" && request.method === "POST") {
      try {
        var bufKey = env.BUFFER_API_KEY;
        if (!bufKey) return json({ error: "BUFFER_API_KEY not configured" }, 200, origin);
        var aR = await fetch("https://api.buffer.com/graphql", { method: "POST", headers: { "Authorization": "Bearer " + bufKey, "Content-Type": "application/json" }, body: JSON.stringify({ query: '{organizations{channels{id name service analytics(period:"week"){metrics{label value}}}}}' }) });
        var aD = await aR.json();
        var channels = ((aD.data || {}).organizations || [{}])[0].channels || [];
        var metrics = {};
        for (var ci = 0; ci < channels.length; ci++) {
          var ch = channels[ci];
          var chM = {};
          (ch.analytics && ch.analytics.metrics || []).forEach(function(m2) {
            chM[m2.label] = m2.value;
          });
          metrics[ch.service || ch.name] = chM;
        }
        var insR = await orchestrate(env, [{ role: "system", content: "Analytics analyst for Identity Partners. British English." }, { role: "user", content: "Analyse this week. Return JSON: {topPlatform,insights:[],recommendations:[]}. Metrics: " + JSON.stringify(metrics) }], "balanced", "research", null);
        var insights = {};
        try {
          var jm2 = insR.content.match(/\{[\s\S]*\}/);
          if (jm2) insights = JSON.parse(jm2[0]);
          else insights = { raw: insR.content };
        } catch (e) {
          insights = { raw: insR.content };
        }
        var fbRec = { analysedAt: (/* @__PURE__ */ new Date()).toISOString(), metrics, insights };
        if (env.PRISM_KV) {
          await env.PRISM_KV.put("analytics:weekly-feedback", JSON.stringify(fbRec), { expirationTtl: 86400 * 14 });
          if (insights.topPlatform) await env.PRISM_KV.put("analytics:top-platform", insights.topPlatform, { expirationTtl: 86400 * 7 });
        }
        return json({ success: true, metrics, insights }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    if (path === "/api/pipeline/status" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var mR = await env.PRISM_KV.get("pipeline:last-morning-run");
        var csR = await env.PRISM_KV.get("site:crawl-status");
        var psR = await env.PRISM_KV.get("site:audience-profiles");
        var arR = await env.PRISM_KV.get("analytics:weekly-feedback");
        var pInfo = null;
        if (psR) {
          var pd2 = JSON.parse(psR);
          pInfo = { generatedAt: pd2.generatedAt, count: (pd2.profiles || []).length };
        }
        return json({ morning: mR ? JSON.parse(mR) : null, crawl: csR ? JSON.parse(csR) : null, profiles: pInfo, analytics: arR ? { analysedAt: JSON.parse(arR).analysedAt } : null }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // MEDIA MANAGER — owns all posting decisions (spec addition)
    // Routes: /api/mm/chat  /api/mm/queue  /api/mm/approve  /api/mm/status
    // ══════════════════════════════════════════════════════════════════════

    // Media Manager chat — Simon talks to MM here
    if (path === "/api/mm/chat" && request.method === "POST") {
      try {
        var body = await request.json();
        var userMsg = (body.message || "").substring(0, 2000);
        var sessionId = body.sessionId || "mm-default";

        // Load MM conversation history from KV
        var mmHistoryRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:history:" + sessionId) : null;
        var mmHistory = mmHistoryRaw ? JSON.parse(mmHistoryRaw) : [];

        // Load queue summary for context
        var queueRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var queue = queueRaw ? JSON.parse(queueRaw) : [];
        var pending = queue.filter(function(p) { return p.status === "pending"; });
        var scheduled = queue.filter(function(p) { return p.status === "scheduled"; });
        var posted = queue.filter(function(p) { return p.status === "posted"; });

        var queueContext = "Current queue: " + pending.length + " pending, " +
          scheduled.length + " scheduled, " + posted.length + " posted today.\n";
        if (pending.length > 0) {
          queueContext += "Pending items:\n" + pending.slice(0, 5).map(function(p, i) {
            return (i+1) + ". [" + p.platforms.join(",") + "] " + (p.text || "").substring(0, 80) +
              (p.imageUrl ? " [has image]" : "") + " — added " + new Date(p.createdAt).toLocaleString("en-GB");
          }).join("\n");
        }

        var mmSystemPrompt = "You are the Media Manager for Identity Partners. You are embedded in the social media posting calendar. " +
          "You are the sole gatekeeper for all content that goes out on behalf of Identity Partners. Nothing is published without your approval.\n\n" +
          "YOUR RESPONSIBILITIES:\n" +
          "- Review all content queued for posting\n" +
          "- Approve, reject, reschedule, or edit posts before they go out\n" +
          "- Enforce IP brand rules: mandatory hashtags (#IdentityPartners #UnderstandThePast #AppreciateThePresent #DefineYourFuture #MentalHealth #Recovery #Addiction #Wellbeing), footer (hello@identitypartners.uk | www.identitypartners.uk/contact), no /book URL\n" +
          "- Coordinate the posting schedule across platforms (X, Instagram, Facebook, Bluesky, LinkedIn)\n" +
          "- Report on what went out, what failed, and why\n" +
          "- Escalate only genuine decisions to Simon — never ask him to do anything technical\n" +
          "- Manage the daily pipeline slots: 08:00 (morning), 13:00 (lunchtime), 20:00 (evening) UTC\n\n" +
          "YOUR RULES:\n" +
          "- British English throughout\n" +
          "- Never post test strings or placeholder content\n" +
          "- Never use www.identitypartners.uk/book\n" +
          "- Never hallucinate engagement metrics or post performance\n" +
          "- Never describe actions — execute them using the available tools\n" +
          "- When Simon says 'go' or 'post it' or 'approve all' — execute immediately\n" +
          "- When content is ready and approved, call /api/mm/approve with the item IDs\n\n" +
          "AVAILABLE ACTIONS (tell Simon what you are doing):\n" +
          "- approve:[id] — approve a queued item for immediate posting\n" +
          "- schedule:[id]:[ISO datetime] — schedule a queued item\n" +
          "- reject:[id]:[reason] — reject a queued item\n" +
          "- edit:[id]:[new text] — edit a queued item's text\n" +
          "- queue:[platform,platform]:[text] — add new item to queue\n\n" +
          "CURRENT QUEUE STATUS:\n" + queueContext;

        var messages = [
          { role: "system", content: mmSystemPrompt },
          ...mmHistory.slice(-10),
          { role: "user", content: userMsg }
        ];

        var mmResult = await orchestrate(env, messages, "balanced", "agent_task", null);
        var mmReply = mmResult.content || "I could not process that request.";

        // Parse and execute any actions in the reply
        var actionsExecuted = [];
        var approveMatches = mmReply.match(/approve:([a-z0-9\-]+)/gi) || [];
        for (var ai = 0; ai < approveMatches.length; ai++) {
          var itemId = approveMatches[ai].split(":")[1];
          var approveReq = new Request("https://prism-api.identitypartners.workers.dev/api/mm/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
            body: JSON.stringify({ itemId })
          });
          try {
            var approveResp = await fetch(approveReq);
            var approveData = await approveResp.json();
            actionsExecuted.push({ action: "approve", itemId, result: approveData });
          } catch(e) {
            actionsExecuted.push({ action: "approve", itemId, error: e.message });
          }
        }

        // Save updated history
        mmHistory.push({ role: "user", content: userMsg });
        mmHistory.push({ role: "assistant", content: mmReply });
        if (mmHistory.length > 40) mmHistory = mmHistory.slice(-40);
        if (env.PRISM_KV) await env.PRISM_KV.put("mm:history:" + sessionId, JSON.stringify(mmHistory), { expirationTtl: 86400 * 7 });

        return json({ reply: mmReply, actionsExecuted, queueSummary: { pending: pending.length, scheduled: scheduled.length, posted: posted.length } }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Media Manager queue — get/add items
    if (path === "/api/mm/queue" && request.method === "GET") {
      try {
        var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var q = qRaw ? JSON.parse(qRaw) : [];
        // Clean up old posted items (keep last 7 days)
        var cutoff = Date.now() - 7 * 86400000;
        q = q.filter(function(item) { return item.status !== "posted" || item.postedAt > cutoff; });
        return json({ queue: q, counts: {
          pending: q.filter(function(i){ return i.status==="pending"; }).length,
          scheduled: q.filter(function(i){ return i.status==="scheduled"; }).length,
          posted: q.filter(function(i){ return i.status==="posted"; }).length,
          rejected: q.filter(function(i){ return i.status==="rejected"; }).length
        }}, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    if (path === "/api/mm/queue" && request.method === "POST") {
      try {
        var body = await request.json();
        var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var q = qRaw ? JSON.parse(qRaw) : [];
        var newItem = {
          id: "mm-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
          text: (body.text || "").substring(0, 2200),
          platforms: body.platforms || ["bluesky"],
          imageUrl: body.imageUrl || null,
          status: "pending",
          source: body.source || "manual",
          createdAt: Date.now(),
          scheduledFor: body.scheduledFor || null,
          notes: body.notes || ""
        };
        q.push(newItem);
        if (env.PRISM_KV) await env.PRISM_KV.put("mm:queue", JSON.stringify(q));
        return json({ success: true, item: newItem }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Media Manager approve — post an item immediately
    if (path === "/api/mm/approve" && request.method === "POST") {
      try {
        var body = await request.json();
        var itemId = body.itemId;
        var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var q = qRaw ? JSON.parse(qRaw) : [];
        var item = q.find(function(i){ return i.id === itemId; });
        if (!item) return json({ error: "Item not found: " + itemId }, 404, origin);
        if (item.status === "posted") return json({ error: "Already posted" }, 400, origin);

        // ── Visual QA check (runs before every post with an image) ──────────
        // Catches: blank rectangles, invisible text, missing brand elements,
        // broken renders (pure green/white/solid colour)
        if (item.imageUrl && item.imageUrl.includes('r2.dev')) {
          try {
            var geminiKey = env.GEMINI_API_KEY || env.gemini_api_key || env.gemini_paid_api_key || env.GEMINI_PAID_API_KEY;
            if (geminiKey) {
              // Fetch the image
              var imgResp = await fetch(item.imageUrl);
              if (imgResp.ok) {
                var imgBuf = await imgResp.arrayBuffer();
                var imgB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
                var imgSize = imgBuf.byteLength;

                // Size check — blank PNGs are typically < 5KB
                if (imgSize < 5000) {
                  // Auto-reject and swap to pre-baked template
                  var ti = Math.floor(Math.random() * 150);
                  item.imageUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti + ".png";
                  item.qaNote = "Image too small (" + imgSize + " bytes) — swapped to pre-baked template " + ti;
                } else {
                  // Gemini Vision QA
                  var qaPayload = {
                    contents: [{
                      parts: [
                        { text: "QA check for an Identity Partners social media canvas. Check: (1) blank or solid colour? (2) text readable? (3) IP logo visible? (4) real background (not pure green/white)? (5) professional appearance? Reply QA_PASS if all pass, or QA_FAIL: [reason] if any fail." },








                        { inline_data: { mime_type: "image/png", data: imgB64.substring(0, 200000) } }
                      ]
                    }]
                  };
                  var qaResp = await fetch(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey,
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qaPayload) }
                  );
                  if (qaResp.ok) {
                    var qaData = await qaResp.json();
                    var qaText = ((qaData.candidates || [])[0] || {}).content;
                    qaText = qaText ? (qaText.parts || [])[0].text || "" : "";
                    item.qaNote = qaText.substring(0, 300);

                    if (qaText.includes("QA_FAIL")) {
                      // Swap to pre-baked template — do not post the broken image
                      var ti2 = Math.floor(Math.random() * 150);
                      var oldUrl = item.imageUrl;
                      item.imageUrl = "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/ig-template-" + ti2 + ".png";
                      item.qaNote = "QA FAILED: " + qaText.replace("QA_FAIL:", "").trim().substring(0, 200) +
                        " — swapped to pre-baked template " + ti2 + " (was: " + oldUrl.split("/").pop() + ")";
                    }
                    // QA_PASS — proceed with original image
                  }
                }
              }
            }
          } catch(qaErr) {
            // QA error is non-fatal — log and continue with original image
            item.qaNote = "QA check error (non-fatal): " + qaErr.message;
          }
        }

        // Pre-baked templates skip vision QA (already verified)
        if (item.imageUrl && item.imageUrl.includes('ig-template-') && !item.qaNote) {
          item.qaNote = "Pre-baked template — QA skipped";
        }

        // Post via the appropriate route
        var postResults = {};
        var postErrors = {};

        // Separate image platforms from text-only
        var imagePlatforms = item.platforms.filter(function(p){ return p==="instagram"||p==="facebook"; });
        var textPlatforms = item.platforms.filter(function(p){ return p!=="instagram"&&p!=="facebook"; });

        // Post image platforms via post-with-canvas
        if (imagePlatforms.length > 0) {
          var pwcReq = new Request("https://prism-api.identitypartners.workers.dev/api/social/post-with-canvas", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
            body: JSON.stringify({ text: item.text, platforms: imagePlatforms, prebuiltImageUrl: item.imageUrl || null })
          });
          var pwcResp = await fetch(pwcReq);
          var pwcData = await pwcResp.json();
          Object.assign(postResults, pwcData.results || {});
          Object.assign(postErrors, pwcData.errors || {});
        }

        // Post text platforms — route by method
        var directPlatforms = textPlatforms.filter(function(p){
          var m = (item.platformMethods||{})[p];
          return !m || m === 'direct';
        });
        var bufferPlatforms = textPlatforms.filter(function(p){
          return (item.platformMethods||{})[p] === 'buffer';
        });
        var zapierPlatforms = textPlatforms.filter(function(p){
          return (item.platformMethods||{})[p] === 'zapier';
        });

        // Buffer platforms (X, LinkedIn if not already handled)
        if (bufferPlatforms.length > 0) {
          var bufferResults = await postViaBuffer(env, item.text, bufferPlatforms, item.imageUrl || null);
          Object.assign(postResults, bufferResults.results || {});
          Object.assign(postErrors, bufferResults.errors || {});
        }

        // Direct platforms (Bluesky already handled above, plus Mastodon, Telegram, Tumblr)
        for (var dpi = 0; dpi < directPlatforms.length; dpi++) {
          var dp = directPlatforms[dpi];
          try {
            if (dp === 'bluesky') {
              var bsR = await postToBluesky(env, item.text);
              if (bsR.success) postResults.bluesky = bsR;
              else postErrors.bluesky = bsR.error || 'Bluesky failed';
            } else if (dp === 'mastodon') {
              var masR = await postToMastodon(env, item.text);
              if (masR.success) postResults.mastodon = masR;
              else postErrors.mastodon = masR.error || 'Mastodon failed';
            } else if (dp === 'telegram') {
              var tgTok = env.TELEGRAM_TOKEN || env.telegram_token;
              var tgChat = env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT || env.telegram_chat_id;
              if (tgTok && tgChat) {
                var tgR = await fetch("https://api.telegram.org/bot" + tgTok + "/sendMessage", {
                  method: "POST", headers: {"Content-Type":"application/json"},
                  body: JSON.stringify({chat_id: tgChat, text: item.text.substring(0,4096), parse_mode:"HTML"})
                });
                var tgD = await tgR.json();
                if (tgD.ok) postResults.telegram = {success:true, message_id: tgD.result.message_id};
                else postErrors.telegram = tgD.description || "Telegram failed";
              } else { postErrors.telegram = "Telegram not configured"; }
            } else if (dp === 'tumblr') {
              var tumKey = env.Tumblr_OAuth_consumer_key || env.tumblr_key;
              var tumSecret = env.Tumblr_OAuth_consumer_secret || env.tumblr_secret;
              if (tumKey) {
                // Tumblr requires OAuth 1.0a — use simple text post via API v2
                var tumR = await fetch("https://api.tumblr.com/v2/blog/identitypartners.tumblr.com/posts", {
                  method: "POST",
                  headers: {"Authorization":"Bearer " + tumKey, "Content-Type":"application/json"},
                  body: JSON.stringify({content:[{type:"text",text:item.text.substring(0,4096)}],tags:["IdentityPartners","MentalHealth","Recovery"]})
                });
                if (tumR.ok) postResults.tumblr = {success:true};
                else postErrors.tumblr = "Tumblr " + tumR.status;
              } else { postErrors.tumblr = "Tumblr not configured"; }
            }
          } catch(dpErr) {
            postErrors[dp] = dpErr.message;
          }
        }

        // Zapier/Make.com platforms (Substack, Threads)
        for (var zpi = 0; zpi < zapierPlatforms.length; zpi++) {
          var zp = zapierPlatforms[zpi];
          var webhookKey = "ZAPIER_WEBHOOK_" + zp.toUpperCase();
          var webhookUrl = env[webhookKey] || env["zapier_webhook_" + zp];
          if (webhookUrl) {
            try {
              var zR = await fetch(webhookUrl, {
                method: "POST", headers: {"Content-Type":"application/json"},
                body: JSON.stringify({platform: zp, text: item.text, imageUrl: item.imageUrl || null, timestamp: new Date().toISOString()})
              });
              if (zR.ok) postResults[zp] = {success:true, via:"zapier"};
              else postErrors[zp] = zp + " webhook " + zR.status;
            } catch(zErr) { postErrors[zp] = zErr.message; }
          } else {
            postErrors[zp] = zp + " requires Zapier/Make.com webhook — set " + webhookKey + " in Settings";
          }
        }

        // Update item status
        item.status = Object.keys(postResults).length > 0 ? "posted" : "failed";
        item.postedAt = Date.now();
        item.postResults = postResults;
        item.postErrors = postErrors;
        if (env.PRISM_KV) await env.PRISM_KV.put("mm:queue", JSON.stringify(q));

        // Log to MM activity log
        var logEntry = {
          ts: Date.now(),
          itemId,
          action: "posted",
          platforms: item.platforms,
          results: postResults,
          errors: postErrors
        };
        var logRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:log") : null;
        var log = logRaw ? JSON.parse(logRaw) : [];
        log.unshift(logEntry);
        if (log.length > 100) log = log.slice(0, 100);
        if (env.PRISM_KV) await env.PRISM_KV.put("mm:log", JSON.stringify(log));

        return json({ success: true, item, results: postResults, errors: postErrors }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Media Manager status update (approve/reject/reschedule/edit)
    if (path === "/api/mm/update" && request.method === "POST") {
      try {
        var body = await request.json();
        var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var q = qRaw ? JSON.parse(qRaw) : [];
        var item = q.find(function(i){ return i.id === body.itemId; });
        if (!item) return json({ error: "Item not found" }, 404, origin);
        if (body.action === "reject") { item.status = "rejected"; item.rejectReason = body.reason || ""; }
        if (body.action === "schedule") { item.status = "scheduled"; item.scheduledFor = body.scheduledFor; }
        if (body.action === "edit") { item.text = (body.text || item.text).substring(0, 2200); }
        if (body.action === "platforms") { item.platforms = body.platforms || item.platforms; }
        if (env.PRISM_KV) await env.PRISM_KV.put("mm:queue", JSON.stringify(q));
        return json({ success: true, item }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Media Manager activity log
    if (path === "/api/mm/log" && request.method === "GET") {
      try {
        var logRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:log") : null;
        var log = logRaw ? JSON.parse(logRaw) : [];
        return json({ log: log.slice(0, 50) }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Media Manager daily run — called by cron, reviews queue and posts scheduled items
    if (path === "/api/mm/run" && request.method === "POST") {
      try {
        var body = await request.json();
        var slot = body.slot || "morning";
        var qRaw = env.PRISM_KV ? await env.PRISM_KV.get("mm:queue") : null;
        var q = qRaw ? JSON.parse(qRaw) : [];
        var now = Date.now();
        var posted = [];
        var skipped = [];

        // Find items scheduled for this slot or overdue
        var toPost = q.filter(function(item) {
          if (item.status !== "scheduled" && item.status !== "pending") return false;
          if (item.status === "scheduled" && item.scheduledFor) {
            return new Date(item.scheduledFor).getTime() <= now;
          }
          // Pending items: post if this is the right slot and no post today yet
          return item.status === "pending";
        });

        // Limit to 1 item per slot to avoid spam
        var toPostNow = toPost.slice(0, 1);

        for (var ti = 0; ti < toPostNow.length; ti++) {
          var item = toPostNow[ti];
          var approveReq = new Request("https://prism-api.identitypartners.workers.dev/api/mm/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
            body: JSON.stringify({ itemId: item.id })
          });
          var approveResp = await fetch(approveReq);
          var approveData = await approveResp.json();
          posted.push({ id: item.id, results: approveData.results, errors: approveData.errors });
        }

        // If queue is empty, generate content via the daily pipeline and queue it
        if (toPost.length === 0) {
          var pipelineReq = new Request("https://prism-api.identitypartners.workers.dev/api/daily-pipeline", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
            body: JSON.stringify({ slot, mmMode: true })
          });
          var pipelineResp = await fetch(pipelineReq);
          var pipelineData = await pipelineResp.json();
          skipped.push("Queue empty — triggered daily pipeline for " + slot);
        }

        return json({ success: true, slot, posted, skipped }, 200, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // Canvas template list — returns all available template names and metadata
    if (path === "/api/canvas/templates" && request.method === "GET") {
      return json({
        templates: [
          { id: "quote-teal",      name: "Deep Teal",    mood: "Calm, grounded, professional" },
          { id: "quote-rose",      name: "Deep Rose",    mood: "Warm, empathetic, personal" },
          { id: "quote-ivory",     name: "Warm Ivory",   mood: "Light, open, accessible" },
          { id: "quote-dark",      name: "Midnight",     mood: "Serious, contemplative, strong" },
          { id: "quote-slate",     name: "Ocean Slate",  mood: "Clear, focused, trustworthy" },
          { id: "quote-forest",    name: "Forest",       mood: "Natural, healing, growth" },
          { id: "quote-dusk",      name: "Dusk Purple",  mood: "Creative, reflective, spiritual" },
          { id: "quote-stone",     name: "Stone",        mood: "Solid, heritage, enduring" },
          { id: "quote-dawn",      name: "Dawn",         mood: "Hopeful, energising, new beginnings" },
          { id: "quote-coastal",   name: "Coastal",      mood: "Fresh, expansive, freedom" },
          { id: "quote-parchment", name: "Parchment",    mood: "Warm, nostalgic, thoughtful" },
          { id: "quote-midnight",  name: "City Night",   mood: "Urban, modern, dynamic" }
        ],
        count: 12
      }, 200, origin);
    }

    // Image search — Pexels, Unsplash, Wikimedia
    if (path === "/api/image-search" && request.method === "GET") {
      try {
        var q = url.searchParams.get("q") || "landscape";
        var source = url.searchParams.get("source") || "pexels";
        var perPage = parseInt(url.searchParams.get("per_page") || "12");
        var images = [];

        if (source === "pexels") {
          var pexelsKey = env.pexels_api_key || env.PEXELS_API_KEY || env.pexels || "";
          if (pexelsKey) {
            var pR = await fetch(
              "https://api.pexels.com/v1/search?query=" + encodeURIComponent(q) + "&per_page=" + perPage + "&orientation=landscape",
              { headers: { "Authorization": pexelsKey } }
            );
            if (pR.ok) {
              var pD = await pR.json();
              images = (pD.photos || []).map(function(p) {
                return { url: p.src.large2x || p.src.large, thumb: p.src.medium, alt: p.alt, photographer: p.photographer, source: "pexels" };
              });
            }
          }
        } else if (source === "unsplash") {
          var unsplashKey = env.unsplash_api_key || env.UNSPLASH_API_KEY || env.unsplash || "";
          if (unsplashKey) {
            var uR = await fetch(
              "https://api.unsplash.com/search/photos?query=" + encodeURIComponent(q) + "&per_page=" + perPage + "&orientation=landscape",
              { headers: { "Authorization": "Client-ID " + unsplashKey } }
            );
            if (uR.ok) {
              var uD = await uR.json();
              images = (uD.results || []).map(function(p) {
                return { url: p.urls.regular, thumb: p.urls.thumb, alt: p.alt_description || q, photographer: p.user.name, source: "unsplash" };
              });
            }
          }
        } else if (source === "wikimedia") {
          var wR = await fetch(
            "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" + encodeURIComponent(q) +
            "&gsrnamespace=6&gsrlimit=" + perPage + "&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=400&format=json&origin=*"
          );
          if (wR.ok) {
            var wD = await wR.json();
            var pages = Object.values((wD.query || {}).pages || {});
            images = pages.filter(function(p) {
              var url2 = ((p.imageinfo || [])[0] || {}).url || "";
              return /\.(jpg|jpeg|png|webp)/i.test(url2);
            }).map(function(p) {
              var ii = (p.imageinfo || [])[0] || {};
              return { url: ii.url, thumb: ii.thumburl || ii.url, alt: p.title.replace("File:", ""), source: "wikimedia" };
            });
          }
        }

        return json({ images, count: images.length, source, query: q }, 200, origin);
      } catch(e) {
        return json({ error: e.message, images: [] }, 200, origin);
      }
    }

    // Voice generation — ElevenLabs, Cartesia, Fish Audio
    if (path === "/api/voice/generate" && request.method === "POST") {
      try {
        var body = await request.json();
        var text = (body.text || "").substring(0, 5000);
        var provider = body.provider || "elevenlabs";
        var voiceId = body.voice_id || "pNInz6obpgDQGcFmaJgB";
        var model = body.model || "eleven_turbo_v2_5";

        if (provider === "elevenlabs") {
          var elKey = env.elevenlabs_api_key || env.ELEVENLABS_API_KEY || env.elevenlabs || "";
          if (!elKey) return json({ error: "ElevenLabs key not configured" }, 200, origin);
          var elResp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
            method: "POST",
            headers: { "xi-api-key": elKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
            body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
          });
          if (!elResp.ok) {
            var errT = await elResp.text();
            return json({ error: "ElevenLabs " + elResp.status + ": " + errT.substring(0, 200) }, 200, origin);
          }
          var audioBuf = await elResp.arrayBuffer();
          var audioB64 = btoa(String.fromCharCode(...new Uint8Array(audioBuf)));
          // Upload to R2 for persistent URL
          var audioKey = "podcast-audio-" + Date.now() + ".mp3";
          if (env.PRISM_ASSETS) {
            await env.PRISM_ASSETS.put(audioKey, audioBuf, { httpMetadata: { contentType: "audio/mpeg" }, expirationTtl: 86400 * 7 });
            return json({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + audioKey, provider: "elevenlabs" }, 200, origin);
          }
          return json({ audio_base64: audioB64, provider: "elevenlabs" }, 200, origin);

        } else if (provider === "cartesia") {
          var carKey = env.cartesia_api_key || env.CARTESIA_API_KEY || env.cartesia || "";
          if (!carKey) return json({ error: "Cartesia key not configured" }, 200, origin);
          var carResp = await fetch("https://api.cartesia.ai/tts/bytes", {
            method: "POST",
            headers: { "X-API-Key": carKey, "Content-Type": "application/json", "Cartesia-Version": "2024-06-10" },
            body: JSON.stringify({ transcript: text, model_id: "sonic-english", voice: { mode: "id", id: voiceId === "sonic-english" ? "a0e99841-438c-4a64-b679-ae501e7d6091" : voiceId }, output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 } })
          });
          if (!carResp.ok) return json({ error: "Cartesia " + carResp.status }, 200, origin);
          var carBuf = await carResp.arrayBuffer();
          var carKey2 = "podcast-audio-" + Date.now() + ".mp3";
          if (env.PRISM_ASSETS) {
            await env.PRISM_ASSETS.put(carKey2, carBuf, { httpMetadata: { contentType: "audio/mpeg" }, expirationTtl: 86400 * 7 });
            return json({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + carKey2, provider: "cartesia" }, 200, origin);
          }
          var carB64 = btoa(String.fromCharCode(...new Uint8Array(carBuf)));
          return json({ audio_base64: carB64, provider: "cartesia" }, 200, origin);

        } else if (provider === "fishaudio") {
          var fishKey = env.fish_audio_api_key || env.FISH_AUDIO_API_KEY || env.fishaudio || "";
          if (!fishKey) return json({ error: "Fish Audio key not configured" }, 200, origin);
          var fishResp = await fetch("https://api.fish.audio/v1/tts", {
            method: "POST",
            headers: { "Authorization": "Bearer " + fishKey, "Content-Type": "application/json" },
            body: JSON.stringify({ text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128 })
          });
          if (!fishResp.ok) return json({ error: "Fish Audio " + fishResp.status }, 200, origin);
          var fishBuf = await fishResp.arrayBuffer();
          var fishKey2 = "podcast-audio-" + Date.now() + ".mp3";
          if (env.PRISM_ASSETS) {
            await env.PRISM_ASSETS.put(fishKey2, fishBuf, { httpMetadata: { contentType: "audio/mpeg" }, expirationTtl: 86400 * 7 });
            return json({ url: "https://pub-b14d0b51a7f148a3bedafc559b4292da.r2.dev/" + fishKey2, provider: "fishaudio" }, 200, origin);
          }
          var fishB64 = btoa(String.fromCharCode(...new Uint8Array(fishBuf)));
          return json({ audio_base64: fishB64, provider: "fishaudio" }, 200, origin);
        }

        return json({ error: "Unknown provider: " + provider }, 400, origin);
      } catch(e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // ── Chat thread management ────────────────────────────────────────────────
    // Delete thread
    if (path.startsWith("/api/chat/thread/") && request.method === "DELETE") {
      try {
        var threadId = path.replace("/api/chat/thread/", "").split("/")[0];
        if (env.PRISM_KV) {
          await env.PRISM_KV.delete("thread:" + threadId);
          await env.PRISM_KV.delete("thread:messages:" + threadId);
          // Remove from thread index
          var idxRaw = await env.PRISM_KV.get("threads:index");
          var idx2 = idxRaw ? JSON.parse(idxRaw) : [];
          idx2 = idx2.filter(function(t){ return t.id !== threadId; });
          await env.PRISM_KV.put("threads:index", JSON.stringify(idx2));
        }
        return json({ success: true, deleted: threadId }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // Rename thread
    if (path.match(/^\/api\/chat\/thread\/[^/]+\/rename$/) && request.method === "POST") {
      try {
        var threadId2 = path.split("/")[4];
        var body = await request.json();
        var newTitle = (body.title || "").substring(0, 100);
        if (env.PRISM_KV) {
          var threadRaw = await env.PRISM_KV.get("thread:" + threadId2);
          if (threadRaw) {
            var thread = JSON.parse(threadRaw);
            thread.title = newTitle;
            thread.updated = Date.now();
            await env.PRISM_KV.put("thread:" + threadId2, JSON.stringify(thread));
            // Update index
            var idxRaw2 = await env.PRISM_KV.get("threads:index");
            var idx3 = idxRaw2 ? JSON.parse(idxRaw2) : [];
            var ti = idx3.find(function(t){ return t.id === threadId2; });
            if (ti) { ti.title = newTitle; ti.updated = Date.now(); }
            await env.PRISM_KV.put("threads:index", JSON.stringify(idx3));
          }
        }
        return json({ success: true, title: newTitle }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Gemma Vision Creative Director ────────────────────────────────────────
    // Takes a screenshot URL or base64 image and returns creative direction
    if (path === "/api/creative-director/review" && request.method === "POST") {
      try {
        var body = await request.json();
        var imageUrl = body.imageUrl || null;
        var imageB64 = body.imageBase64 || null;
        var context = body.context || "social media canvas";
        var geminiKey = env.GEMINI_PAID_API_KEY || env.gemini_paid_api_key || env.GEMINI_API_KEY || env.gemini_api_key || "";
        if (!geminiKey) return json({ error: "Gemini key not configured" }, 200, origin);

        // Fetch image if URL provided
        if (imageUrl && !imageB64) {
          var imgResp = await fetch(imageUrl);
          if (imgResp.ok) {
            var imgBuf = await imgResp.arrayBuffer();
            imageB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
          }
        }

        if (!imageB64) return json({ error: "No image provided" }, 400, origin);

        var cdPrompt = "You are the Creative Director for Identity Partners, a professional services firm focused on addiction, trauma, mental health, and community wellbeing. " +
          "You are reviewing a " + context + " for brand quality and creative effectiveness. " +
          "Assess the following with specific, actionable feedback (not generic praise):\n\n" +
          "1. BRAND COMPLIANCE: Is the IP logo visible? Are brand colours (deep teal #0f3b3a, deep rose #5c2d3f, warm ivory #f7f3e9) correctly applied? Is the wordmark legible?\n" +
          "2. TYPOGRAPHY: Is the quote/text in Playfair Display italic? Is it readable against the background? Is the font size appropriate?\n" +
          "3. COMPOSITION: Is the layout balanced? Does the IP colour grid appear top-left? Is the background appropriate (landscape/vista, not yoga/wellness/boardroom)?\n" +
          "4. EMOTIONAL IMPACT: Does this image communicate warmth, professionalism, and evidence-based authority? Would it resonate with someone in recovery or supporting someone in recovery?\n" +
          "5. TECHNICAL: Any rendering issues, blank areas, colour clashes, or missing elements?\n\n" +
          "Reply with: PASS or FAIL, then specific notes for each of the 5 points. If FAIL, state exactly what must be fixed. Be direct. No sycophancy.";

        var qaPayload = {
          contents: [{
            parts: [
              { text: cdPrompt },
              { inline_data: { mime_type: "image/png", data: imageB64.substring(0, 200000) } }
            ]
          }]
        };

        var qaResp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qaPayload) }
        );

        if (!qaResp.ok) return json({ error: "Gemini " + qaResp.status }, 200, origin);
        var qaData = await qaResp.json();
        var review = ((qaData.candidates || [])[0] || {}).content;
        review = review ? (review.parts || [])[0].text || "" : "";
        var passed = review.toUpperCase().startsWith("PASS");

        return json({ passed, review, context, model: "gemini-2.0-flash" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // Creative Director: take a live screenshot and review it
    if (path === "/api/creative-director/screenshot" && request.method === "POST") {
      try {
        var body = await request.json();
        var targetUrl = body.url || "https://prism.identitypartners.uk/creator/canvas/";
        var browserlessKey = env["BROWSERLESS.IO"] || env.BROWSERLESS_IO;
        if (!browserlessKey) return json({ error: "Browserless not configured" }, 200, origin);

        var ssResp = await fetch("https://chrome.browserless.io/screenshot?token=" + browserlessKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: targetUrl,
            options: { type: "png", fullPage: false },
            waitForTimeout: 5000
          })
        });

        if (!ssResp.ok) return json({ error: "Screenshot failed: " + ssResp.status }, 200, origin);
        var ssBuf = await ssResp.arrayBuffer();
        var ssB64 = btoa(String.fromCharCode(...new Uint8Array(ssBuf)));

        // Now review it
        var reviewReq = new Request("https://prism-api.identitypartners.workers.dev/api/creative-director/review", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Origin": "https://prism.identitypartners.uk" },
          body: JSON.stringify({ imageBase64: ssB64, context: "live system screenshot of " + targetUrl })
        });
        var reviewResp = await fetch(reviewReq);
        var reviewData = await reviewResp.json();
        reviewData.screenshotSize = ssBuf.byteLength;
        reviewData.url = targetUrl;
        return json(reviewData, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }


    // ── WriteHandy — note management with module folders ─────────────────────
    // Save a note with module/folder organisation
    if (path === "/api/notes/save" && request.method === "POST") {
      try {
        var body = await request.json();
        var noteId = body.id || ("note-" + Date.now() + "-" + Math.random().toString(36).slice(2,6));
        var module = (body.module || "General").substring(0, 50);
        var note = {
          id: noteId,
          title: (body.title || "Untitled").substring(0, 200),
          content: (body.content || "").substring(0, 50000),
          inkData: body.inkData || null,       // base64 canvas PNG
          ocrText: (body.ocrText || "").substring(0, 10000),
          module: module,
          tags: body.tags || [],
          createdAt: body.createdAt || Date.now(),
          updatedAt: Date.now(),
          wordCount: (body.content || "").split(/\s+/).filter(Boolean).length
        };
        if (env.PRISM_KV) {
          // Save note
          await env.PRISM_KV.put("note:" + noteId, JSON.stringify(note));
          // Update module index
          var modKey = "notes:module:" + module.toLowerCase().replace(/\s+/g, "-");
          var modRaw = await env.PRISM_KV.get(modKey);
          var modIndex = modRaw ? JSON.parse(modRaw) : [];
          if (!modIndex.includes(noteId)) modIndex.unshift(noteId);
          if (modIndex.length > 500) modIndex = modIndex.slice(0, 500);
          await env.PRISM_KV.put(modKey, JSON.stringify(modIndex));
          // Update global index
          var globalRaw = await env.PRISM_KV.get("notes:index");
          var globalIndex = globalRaw ? JSON.parse(globalRaw) : [];
          var existing = globalIndex.find(function(n) { return n.id === noteId; });
          if (existing) {
            existing.title = note.title; existing.module = note.module;
            existing.updatedAt = note.updatedAt; existing.wordCount = note.wordCount;
          } else {
            globalIndex.unshift({ id: noteId, title: note.title, module: note.module, updatedAt: note.updatedAt, wordCount: note.wordCount });
          }
          if (globalIndex.length > 1000) globalIndex = globalIndex.slice(0, 1000);
          await env.PRISM_KV.put("notes:index", JSON.stringify(globalIndex));
        }
        return json({ success: true, id: noteId, note }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // Get notes — optionally filtered by module
    if (path === "/api/notes" && request.method === "GET") {
      try {
        var module = url.searchParams.get("module") || "";
        var limit = parseInt(url.searchParams.get("limit") || "50");
        if (!env.PRISM_KV) return json({ notes: [] }, 200, origin);
        var globalRaw = await env.PRISM_KV.get("notes:index");
        var globalIndex = globalRaw ? JSON.parse(globalRaw) : [];
        if (module) {
          globalIndex = globalIndex.filter(function(n) {
            return n.module && n.module.toLowerCase() === module.toLowerCase();
          });
        }
        return json({ notes: globalIndex.slice(0, limit), total: globalIndex.length }, 200, origin);
      } catch(e) { return json({ error: e.message, notes: [] }, 200, origin); }
    }

    // Get a single note
    if (path.startsWith("/api/notes/") && request.method === "GET" && !path.includes("/save") && !path.includes("/modules") && !path.includes("/search")) {
      try {
        var noteId = path.replace("/api/notes/", "");
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var noteRaw = await env.PRISM_KV.get("note:" + noteId);
        if (!noteRaw) return json({ error: "Note not found" }, 404, origin);
        return json({ note: JSON.parse(noteRaw) }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // Delete a note
    if (path.startsWith("/api/notes/") && request.method === "DELETE") {
      try {
        var noteId = path.replace("/api/notes/", "");
        if (env.PRISM_KV) {
          var noteRaw = await env.PRISM_KV.get("note:" + noteId);
          if (noteRaw) {
            var note = JSON.parse(noteRaw);
            // Remove from module index
            var modKey = "notes:module:" + (note.module || "general").toLowerCase().replace(/\s+/g, "-");
            var modRaw = await env.PRISM_KV.get(modKey);
            if (modRaw) {
              var modIndex = JSON.parse(modRaw).filter(function(id) { return id !== noteId; });
              await env.PRISM_KV.put(modKey, JSON.stringify(modIndex));
            }
            // Remove from global index
            var globalRaw = await env.PRISM_KV.get("notes:index");
            if (globalRaw) {
              var globalIndex = JSON.parse(globalRaw).filter(function(n) { return n.id !== noteId; });
              await env.PRISM_KV.put("notes:index", JSON.stringify(globalIndex));
            }
            await env.PRISM_KV.delete("note:" + noteId);
          }
        }
        return json({ success: true, deleted: noteId }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // List all modules (folders)
    if (path === "/api/notes/modules" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ modules: [] }, 200, origin);
        var globalRaw = await env.PRISM_KV.get("notes:index");
        var globalIndex = globalRaw ? JSON.parse(globalRaw) : [];
        var moduleCounts = {};
        globalIndex.forEach(function(n) {
          var m = n.module || "General";
          moduleCounts[m] = (moduleCounts[m] || 0) + 1;
        });
        var modules = Object.keys(moduleCounts).map(function(m) {
          return { name: m, count: moduleCounts[m] };
        }).sort(function(a, b) { return b.count - a.count; });
        return json({ modules }, 200, origin);
      } catch(e) { return json({ error: e.message, modules: [] }, 200, origin); }
    }

    // Search notes
    if (path === "/api/notes/search" && request.method === "GET") {
      try {
        var q = (url.searchParams.get("q") || "").toLowerCase();
        if (!q || !env.PRISM_KV) return json({ notes: [] }, 200, origin);
        var globalRaw = await env.PRISM_KV.get("notes:index");
        var globalIndex = globalRaw ? JSON.parse(globalRaw) : [];
        // Search by title first (fast)
        var titleMatches = globalIndex.filter(function(n) {
          return n.title && n.title.toLowerCase().includes(q);
        });
        // For content search, fetch matching notes (limit to 20 for performance)
        var results = titleMatches.slice(0, 20);
        return json({ notes: results, query: q }, 200, origin);
      } catch(e) { return json({ error: e.message, notes: [] }, 200, origin); }
    }


    // ── Memory — agent-writable memory about Simon ────────────────────────────
    if (path === "/api/memory/about-me" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ memories: [] }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        var memories = raw ? JSON.parse(raw) : [];
        return json({ memories, count: memories.length }, 200, origin);
      } catch(e) { return json({ error: e.message, memories: [] }, 200, origin); }
    }

    if (path === "/api/memory/about-me" && request.method === "POST") {
      try {
        var body = await request.json();
        var fact = (body.fact || "").substring(0, 500);
        var category = body.category || "general";
        var source = body.source || "agent";
        if (!fact) return json({ error: "No fact provided" }, 400, origin);
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        var memories = raw ? JSON.parse(raw) : [];
        // Check for duplicates
        var isDuplicate = memories.some(function(m) {
          return m.fact.toLowerCase() === fact.toLowerCase();
        });
        if (!isDuplicate) {
          memories.unshift({ fact, category, source, addedAt: Date.now() });
          if (memories.length > 200) memories = memories.slice(0, 200);
          await env.PRISM_KV.put("memory:about-simon", JSON.stringify(memories));
        }
        return json({ success: true, fact, isDuplicate }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === "/api/memory/about-me" && request.method === "DELETE") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("memory:about-simon");
        var memories = raw ? JSON.parse(raw) : [];
        memories = memories.filter(function(m) { return m.fact !== body.fact; });
        await env.PRISM_KV.put("memory:about-simon", JSON.stringify(memories));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Persona save/load — portable named personas ───────────────────────────
    if (path === "/api/personas" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ personas: [] }, 200, origin);
        var raw = await env.PRISM_KV.get("personas:library");
        var personas = raw ? JSON.parse(raw) : [];
        // Add built-in personas
        var builtIn = [
          { id: "gerald", name: "Gerald", avatar: "🎩", systemPrompt: "You are Gerald, the sardonic butler and default AI assistant for Identity Partners. You call Simon 'sir'. You are devastatingly competent, dry, precise, and never sycophantic. British English throughout. No AI tropes. Execute tasks; do not describe them.", builtIn: true },
          { id: "professor", name: "Professor", avatar: "🎓", systemPrompt: "You are a senior academic research professor specialising in social sciences, addiction studies, and mental health policy. You assist Simon Johnson with his MSc and PhD research at Goldsmiths. You are rigorous, cite sources, use British English, and never hallucinate citations. You are direct and intellectually demanding. You do not simplify unless asked.", builtIn: true },
          { id: "research-assistant", name: "Research Assistant", avatar: "📚", systemPrompt: "You are a meticulous research assistant for Identity Partners and Simon Johnson's academic work. You find, synthesise, and structure information. You produce literature reviews, thematic analyses, and annotated bibliographies. British English. No sycophancy. Cite everything.", builtIn: true },
          { id: "legal-drafter", name: "Legal Drafter", avatar: "⚖️", systemPrompt: "You are a legal drafting assistant specialising in complaints, petitions, and formal correspondence to regulatory bodies. You write in formal British English. You structure arguments chronologically, reference relevant legislation and policy, and specify remedies sought. You never speculate about legal outcomes.", builtIn: true },
          { id: "creative-writer", name: "Creative Writer", avatar: "✍️", systemPrompt: "You are a creative writing assistant for Identity Partners. You write in warm, evidence-based, accessible British English. You produce social media content, newsletters, podcast scripts, and educational materials about addiction, trauma, and mental health. No wellness clichés. No corporate language.", builtIn: true }
        ];
        return json({ personas: [...builtIn, ...personas] }, 200, origin);
      } catch(e) { return json({ error: e.message, personas: [] }, 200, origin); }
    }

    if (path === "/api/personas" && request.method === "POST") {
      try {
        var body = await request.json();
        var persona = {
          id: "persona-" + Date.now(),
          name: (body.name || "Unnamed").substring(0, 50),
          avatar: body.avatar || "🤖",
          systemPrompt: (body.systemPrompt || "").substring(0, 4000),
          context: (body.context || "").substring(0, 10000),
          createdAt: Date.now(),
          builtIn: false
        };
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("personas:library");
        var personas = raw ? JSON.parse(raw) : [];
        personas.unshift(persona);
        if (personas.length > 100) personas = personas.slice(0, 100);
        await env.PRISM_KV.put("personas:library", JSON.stringify(personas));
        return json({ success: true, persona }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.startsWith("/api/personas/") && request.method === "DELETE") {
      try {
        var personaId = path.replace("/api/personas/", "");
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("personas:library");
        var personas = raw ? JSON.parse(raw) : [];
        personas = personas.filter(function(p) { return p.id !== personaId; });
        await env.PRISM_KV.put("personas:library", JSON.stringify(personas));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // ── Clean up test threads ─────────────────────────────────────────────────
    if (path === "/api/admin/cleanup-test-threads" && request.method === "POST") {
      try {
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var idxRaw = await env.PRISM_KV.get("threads:index");
        var threads = idxRaw ? JSON.parse(idxRaw) : [];
        var testPatterns = /\b(test|say ok|2\+2|hello world|capital of france|what is \d|testing|dummy|sample|placeholder)\b/i;
        var toDelete = threads.filter(function(t) { return testPatterns.test(t.title || ""); });
        var deleted = [];
        for (var ti = 0; ti < toDelete.length; ti++) {
          await env.PRISM_KV.delete("thread:" + toDelete[ti].id);
          await env.PRISM_KV.delete("thread:messages:" + toDelete[ti].id);
          deleted.push(toDelete[ti].title);
        }
        var remaining = threads.filter(function(t) { return !testPatterns.test(t.title || ""); });
        await env.PRISM_KV.put("threads:index", JSON.stringify(remaining));
        return json({ success: true, deleted, remaining: remaining.length }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path === "/api/chat/models" && request.method === "GET") {
      return json({ models: [
        { id: "auto", label: "Auto (Orchestrator)", provider: "auto" },
        { id: "nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Nemotron Ultra (NVIDIA)", provider: "nvidia" },
        { id: "kimi/moonshot-v1-32k", label: "Kimi 32K", provider: "kimi" },
        { id: "mistral/mistral-large-latest", label: "Mistral Large", provider: "mistral" },
        { id: "deepseek/deepseek-chat", label: "DeepSeek V3", provider: "deepseek" },
        { id: "gemini/gemini-2.5-pro", label: "Gemini 2.5 Pro (1M ctx)", provider: "gemini" },
        { id: "gemini/gemini-2.0-flash", label: "Gemini Flash (vision)", provider: "gemini" },
        { id: "cerebras/llama-3.3-70b", label: "Llama 70B (Cerebras fast)", provider: "cerebras" },
        { id: "groq/llama-3.3-70b-versatile", label: "Llama 70B (Groq fast)", provider: "groq" },
        { id: "cohere/command-r-plus-08-2024", label: "Cohere Command R+", provider: "cohere" },
      ]}, 200, origin);
    }
    
    // RAG: Setup index table
    if (path === "/api/rag/setup" && request.method === "POST") {
      try {
        if (!env.PRISM_D1) return json({ error: "D1 not available" }, 200, origin);
        await env.PRISM_D1.prepare("CREATE TABLE IF NOT EXISTS rag_index (id TEXT PRIMARY KEY, title TEXT, content_preview TEXT, keywords TEXT, source_type TEXT, module TEXT, tags TEXT, created_at TEXT)").run();
        await env.PRISM_D1.prepare("CREATE INDEX IF NOT EXISTS idx_rag_keywords ON rag_index(keywords)").run();
        return json({ success: true, message: "RAG index ready" }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // RAG: Index content
    if (path === "/api/rag/index" && request.method === "POST") {
      try {
        var body = await request.json();
        var content = (body.content || "").substring(0, 10000);
        var title = (body.title || "Untitled").substring(0, 200);
        var sourceType = body.source || "note";
        var module = body.module || "General";
        var stopWords = new Set(["this","that","with","from","have","been","were","they","their","what","when","where","which","will","would","could","should","about","into","than","then","them","these","those","some","such","only","also","more","most","other","over","after","before","between","through","during","without","within","along","following","across","behind","beyond","plus","except","the","and","but","for","are","was","not","you","all","can","had","her","his","him","she","they","its","our","out","who","get","may","him","has","did","let","put","say","too","use","way","may","now","how","any","two","its","our","out","who","get","may","him","has","did","let","put","say","too","use","way"]);
        var words = content.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w){ return w.length > 4 && !stopWords.has(w); });
        var keywords = [...new Set(words)].slice(0, 50).join(" ");
        var docId = "rag-" + Date.now() + "-" + Math.random().toString(36).slice(2,6);
        if (!env.PRISM_D1) return json({ error: "D1 not available" }, 200, origin);
        await env.PRISM_D1.prepare("INSERT OR REPLACE INTO rag_index (id, title, content_preview, keywords, source_type, module, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(docId, title, content.substring(0, 500), keywords, sourceType, module, JSON.stringify(body.tags || []), new Date().toISOString()).run();
        return json({ success: true, id: docId }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    // RAG: Search
    if (path === "/api/rag/search" && request.method === "GET") {
      try {
        var q = (url.searchParams.get("q") || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
        var limit = parseInt(url.searchParams.get("limit") || "5");
        if (!q || !env.PRISM_D1) return json({ results: [] }, 200, origin);
        var words = q.split(/\s+/).filter(function(w){ return w.length > 4; }).slice(0, 3);
        var results = [];
        for (var wi = 0; wi < words.length; wi++) {
          try {
            var rows = await env.PRISM_D1.prepare("SELECT id, title, content_preview, source_type, module FROM rag_index WHERE keywords LIKE ? LIMIT ?").bind("%" + words[wi] + "%", limit).all();
            (rows.results || []).forEach(function(r){ if (!results.find(function(x){ return x.id === r.id; })) results.push(r); });
          } catch(e) {}
        }
        return json({ results: results.slice(0, limit), query: q }, 200, origin);
      } catch(e) { return json({ error: e.message, results: [] }, 200, origin); }
    }

    // Zoho OAuth initiation
    if (path === "/api/zoho/auth" && request.method === "GET") {
      var service = url.searchParams.get("service") || "mail";
      var clientId = env.ZOHO_CLIENT_ID || env.Zoho_Client_ID || env.zoho_client_id;
      if (!clientId) return json({ error: "ZOHO_CLIENT_ID not configured. Add it via Settings." }, 200, origin);
      var scopes = { mail: "ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.accounts.READ", crm: "ZohoCRM.modules.ALL", calendar: "ZohoCalendar.event.ALL,ZohoCalendar.calendar.ALL" };
      var scope = scopes[service] || scopes.mail;
      var redirectUri = "https://prism.identitypartners.uk/oauth/zoho/" + service + "/";
      var authUrl = "https://accounts.zoho.eu/oauth/v2/auth?response_type=code&client_id=" + clientId + "&scope=" + encodeURIComponent(scope) + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&access_type=offline&prompt=consent";
      return Response.redirect(authUrl, 302);
    }


    // ── Workflow routes ───────────────────────────────────────────────────────
    if (path === "/api/workflows/list" && request.method === "GET") {
      try {
        if (!env.PRISM_KV) return json({ workflows: [] }, 200, origin);
        var raw = await env.PRISM_KV.get("workflows:custom");
        return json({ workflows: raw ? JSON.parse(raw) : [] }, 200, origin);
      } catch(e) { return json({ workflows: [], error: e.message }, 200, origin); }
    }

    if (path === "/api/workflows/save" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("workflows:custom");
        var workflows = raw ? JSON.parse(raw) : [];
        var existing = workflows.findIndex(function(w){ return w.id === body.id; });
        if (existing >= 0) workflows[existing] = body;
        else workflows.unshift(body);
        if (workflows.length > 100) workflows = workflows.slice(0, 100);
        await env.PRISM_KV.put("workflows:custom", JSON.stringify(workflows));
        return json({ success: true, workflow: body }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

    if (path.startsWith("/api/workflows/") && request.method === "DELETE") {
      try {
        var wfId = path.replace("/api/workflows/", "");
        if (!env.PRISM_KV) return json({ error: "KV not available" }, 200, origin);
        var raw = await env.PRISM_KV.get("workflows:custom");
        var workflows = raw ? JSON.parse(raw) : [];
        workflows = workflows.filter(function(w){ return w.id !== wfId; });
        await env.PRISM_KV.put("workflows:custom", JSON.stringify(workflows));
        return json({ success: true }, 200, origin);
      } catch(e) { return json({ error: e.message }, 500, origin); }
    }

return json({ error: "Not found", path }, 404, origin);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

