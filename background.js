// ─── Configuration ───────────────────────────────────────────────────────────
const GEMINI_API_KEY = "<YOUR_GEMINI_API_KEY>";

// Option B (production proxy) — set your endpoint and uncomment
// const PROXY_URL = "https://your-proxy.com/summarize";

// ─── URL Allowlist (for proxy option B — add host here before enabling) ──────
// const ALLOWED_HOSTS = new Set(["your-proxy.com"]);

// ─── API key pre-flight check ─────────────────────────────────────────────────
function assertKeyConfigured() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "<YOUR_GEMINI_API_KEY>") {
    throw new Error(
      "No API key set. Open background.js and replace <YOUR_GEMINI_API_KEY> " +
      "with your key from https://aistudio.google.com/app/apikey"
    );
  }
}

// ─── Rate Limiter (token bucket) ─────────────────────────────────────────────
const RATE_LIMIT = { MAX_REQUESTS: 5, WINDOW_MS: 60_000 };
const rateBucket = { tokens: RATE_LIMIT.MAX_REQUESTS, lastRefill: Date.now() };

function checkRateLimit() {
  const now = Date.now();
  const elapsed = now - rateBucket.lastRefill;
  if (elapsed >= RATE_LIMIT.WINDOW_MS) {
    rateBucket.tokens = RATE_LIMIT.MAX_REQUESTS;
    rateBucket.lastRefill = now;
  }
  if (rateBucket.tokens <= 0) {
    const waitSec = Math.ceil((RATE_LIMIT.WINDOW_MS - elapsed) / 1000);
    throw new Error(`Rate limit reached. Try again in ${waitSec}s.`);
  }
  rateBucket.tokens--;
}

// ─── HTTP helpers — hardcoded URLs, no variable reaches fetch() ──────────────
async function fetchGemini(prompt) {
  // URL is a compile-time constant — not derived from any external input
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if (res.ok) return res;

    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt === 3) {
      throw new Error(
        res.status === 400 ? "Bad request (400). Your API key may be invalid or the prompt was rejected." :
        res.status === 401 ? "Invalid API key (401). Check your GEMINI_API_KEY in background.js." :
        res.status === 403 ? "API key does not have permission (403). Check your key at https://aistudio.google.com/app/apikey" :
        res.status === 404 ? "Model not found (404). The Gemini model endpoint may have changed — check background.js." :
        res.status === 429 ? "AI API rate limit hit. Please wait and try again." :
        res.status === 503 ? "AI service temporarily unavailable. Try again shortly." :
        `API error ${res.status}.`
      );
    }
    await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
  }
}

/* ── Option B: proxy fetch (uncomment when using a proxy backend) ────────────
async function fetchProxy(text, bulletMode) {
  // URL is a compile-time constant — not derived from any external input
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, bulletMode })
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt === 3) throw new Error(`Proxy error ${res.status}.`);
    await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
  }
}
*/

// ─── Prompts ──────────────────────────────────────────────────────────────────
function buildPrompt(text, bulletMode) {
  const content = `\n\nContent:\n${text.slice(0, 8000)}`;
  if (bulletMode) {
    return `Summarize the following webpage content in exactly 3 concise bullet points.
Respond ONLY in this exact format — no intro, no extra text:
• [bullet 1]
• [bullet 2]
• [bullet 3]${content}`;
  }
  return `Summarize the following webpage content.
Respond ONLY in this exact format — do not add any extra text outside these sections:

OVERVIEW
[2-3 sentence summary of the page]

KEY INSIGHTS
• [insight 1]
• [insight 2]
• [insight 3]
• [insight 4]
• [insight 5]

READING TIME
[e.g. "Estimated reading time: 4 minutes"]${content}`;
}

// ─── AI Call ─────────────────────────────────────────────────────────────────
async function callAI(text, bulletMode) {
  const prompt = buildPrompt(text, bulletMode);

  /* ── Option B: use proxy (uncomment, delete Option A block) ──
  const res = await fetchProxy(text, bulletMode);
  const data = await res.json();
  if (!data?.summary) throw new Error("Proxy returned an empty response.");
  return data.summary;
  */

  // ── Option A: direct Gemini ──
  const res = await fetchGemini(prompt);
  const data = await res.json();
  const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!summary) throw new Error("AI returned an empty response. Try again.");
  return summary;
}

// ─── Message validation ───────────────────────────────────────────────────────
function validateSummarizeMsg(msg) {
  if (!msg || typeof msg !== "object") throw new Error("Invalid message.");
  if (msg.action !== "summarize") throw new Error("Unknown action.");
  return { bulletMode: msg.bulletMode === true }; // coerce — never trust caller type
}

// ─── Message Listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  let validated;
  try {
    validated = validateSummarizeMsg(msg);
  } catch {
    return false; // not our message — release listener
  }

  (async () => {
    try {
      assertKeyConfigured(); // fail fast if placeholder key is still set
      checkRateLimit();

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");

      // Validate the tab URL is reachable before messaging
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
        throw new Error("Cannot summarize browser internal pages.");
      }

      const contentResponse = await chrome.tabs.sendMessage(tab.id, { action: "extractContent" })
        .catch(() => { throw new Error("Could not read page content. Try reloading the tab."); });

      const pageText = contentResponse?.content?.trim();
      if (typeof pageText !== "string" || pageText.length < 50) {
        throw new Error("Not enough readable content on this page to summarize.");
      }

      const summary = await callAI(pageText, validated.bulletMode);
      sendResponse({ summary });

    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
