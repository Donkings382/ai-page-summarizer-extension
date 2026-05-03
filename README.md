# AI Page Summarizer — Chrome Extension

A Manifest V3 Chrome Extension that summarizes any webpage using the **Gemini 1.5 Flash** API.  
Displays a structured summary — overview, bullet-point key insights, and estimated reading time — directly in the popup.

---

## Table of Contents

1. [Features](#features)
2. [Setup Instructions](#setup-instructions)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
5. [AI Integration](#ai-integration)
6. [Security Decisions](#security-decisions)
7. [Trade-offs](#trade-offs)
8. [Demo Recording Guide](#demo-recording-guide)

---

## Features

- One-click summarization via Gemini 1.5 Flash
- Structured output: Overview · Key Insights (5 bullets) · Reading Time
- 3-bullet summary mode for quick reads
- Per-URL caching — no duplicate API calls (⚡ Cached badge)
- Dark / Light mode toggle, preference persisted
- Copy summary to clipboard
- Word count display
- In-page keyword highlight toggle
- Reset All — clears all cached summaries and settings
- Rate limiter: 5 requests / 60s with exact wait-time feedback
- Retry with exponential backoff on transient API failures (429 / 503)

---

## Setup Instructions

### 1. Get a Gemini API key

Get a free key at: https://aistudio.google.com/app/apikey

### 2. Add the key to the extension

Open `background.js` and replace the placeholder on line 2:

```js
const GEMINI_API_KEY = "<YOUR_GEMINI_API_KEY>";
```

### 3. Load the extension in Chrome

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this project folder

### 4. Use it

Navigate to any article page, click the extension icon, and press **Summarize Page**.

---

### Optional: Use a proxy backend (recommended for production)

Never ship a real API key inside an extension bundle — it is readable by anyone who inspects the source.  
For production, run a lightweight backend that holds the key server-side:

```
User → Extension → Your Proxy → Gemini API
```

**Minimal Node.js/Express proxy:**

```js
// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/summarize", async (req, res) => {
  const { text, bulletMode } = req.body;
  // Build prompt, call Gemini with process.env.GEMINI_API_KEY
  // Return { summary }
});

app.listen(3000);
```

Then in `background.js`, uncomment Option B and delete the Option A fetch block.

---

## Project Structure

```
ai-page-summarizer/
├── manifest.json       Extension config — Manifest V3
├── background.js       Service worker — AI API calls, rate limiting, retry
├── content.js          Content script — page text extraction, keyword highlight
├── popup.html          Extension popup — UI structure
├── popup.css           Styling — dark/light mode, spinner, sections, animations
├── popup.js            Popup logic — caching, rendering, settings, theme
├── Readability.js      Mozilla Readability — bundled locally for content extraction
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── .gitignore
└── README.md
```

---

## Architecture

### Message flow

```
User clicks "Summarize Page"
        │
        ▼
   popup.js
        │
        ├─► chrome.storage.local.get(cacheKey)
        │         │
        │         ├── Cache HIT  → renderSections() → display (⚡ Cached)
        │         │
        │         └── Cache MISS
        │                 │
        │                 ▼
        │         chrome.runtime.sendMessage({ action: "summarize" })
        │                 │
        │                 ▼
        │          background.js  (service worker)
        │                 │
        │                 ├─ checkRateLimit()
        │                 ├─ chrome.tabs.sendMessage({ action: "extractContent" })
        │                 │         │
        │                 │         ▼
        │                 │    content.js
        │                 │    Readability → <article> → <main> → div heuristic
        │                 │    Returns { content: "plain text..." }
        │                 │
        │                 └─ fetchGemini(prompt)  ──► Gemini 1.5 Flash API
        │                           │
        │                           └── Returns structured summary text
        │
        ├─► chrome.storage.local.set(cacheKey, summary)
        └─► renderSections() → display in popup
```

### Responsibilities per file

| File            | Responsibility                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `manifest.json` | Declares permissions, registers service worker, popup, content scripts         |
| `background.js` | Owns all network I/O — rate limiter, retry logic, prompt building, Gemini call |
| `content.js`    | Runs in page context — extracts text, handles keyword highlighting             |
| `popup.js`      | UI state machine — loading, cache, render, settings, theme, copy, highlight    |
| `popup.html`    | Semantic HTML structure with ARIA attributes                                   |
| `popup.css`     | All visual styling — no logic                                                  |

### Chrome API usage

| API                          | Used for                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `chrome.runtime.sendMessage` | popup → background communication                                |
| `chrome.tabs.sendMessage`    | background → content script communication                       |
| `chrome.tabs.query`          | Get active tab ID and URL                                       |
| `chrome.storage.local`       | Cache summaries per URL, persist theme and bullet-mode settings |
| `chrome.scripting`           | Declared in permissions for dynamic script injection capability |

---

## AI Integration

### Model

**Gemini 1.5 Flash** — chosen for its speed, low latency, and free tier availability.  
Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`

### Prompt engineering

The prompt enforces a strict output format to make parsing deterministic:

```
OVERVIEW
[2-3 sentence summary]

KEY INSIGHTS
• [insight 1]
• [insight 2]
• [insight 3]
• [insight 4]
• [insight 5]

READING TIME
[Estimated reading time: N minutes]
```

The parser in `renderSections()` splits on these exact section headings and builds DOM nodes — no regex on AI output, no `innerHTML`.

**3-bullet mode** uses a separate prompt that requests exactly 3 bullet points with no extra text, and a separate cache key so both modes can be cached independently.

### Content sent to the API

- Page text is extracted by `content.js`, stripped of all clutter tags, and normalized
- Capped at **4000 characters** before being included in the prompt — covers ~600 words, enough for accurate news article summaries while keeping latency low
- Only plain text is sent — no HTML, no scripts, no user data

### Reliability

- **Retry with exponential backoff**: up to 3 retries on HTTP 429 and 503, with 500ms → 1s → 2s delays
- **Rate limiter**: token bucket — 5 requests per 60-second window, resets with the service worker lifecycle
- **Empty response guard**: throws a user-visible error if the API returns no candidate text

---

## Security Decisions

### 1. API key isolation

The API key lives exclusively in `background.js`, which runs as a **service worker** — a separate execution context that is never accessible to page scripts or content scripts. The popup and content script have no reference to the key at any point.

### 2. No key in frontend

`popup.js` and `content.js` contain zero API references. The popup sends a message to the background; the background makes the network call. This is the correct MV3 pattern.

### 3. XSS prevention

All summary text is rendered using `textContent` — never `innerHTML`. The DOM renderers (`renderSections`, `renderBullets`) build nodes programmatically via `createElement` and set content via `textContent`. This eliminates any HTML injection path from AI-returned text.

### 4. Content Security Policy

`popup.html` declares a strict CSP meta tag:

```
default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none';
```

This blocks inline scripts, external stylesheets, and any network requests from the popup context.

### 5. Message validation

Every incoming message is validated before processing:

- `background.js` — `validateSummarizeMsg()` checks type, action string, and coerces `bulletMode` to boolean
- `content.js` — `validateMsg()` checks against a `VALID_ACTIONS` allowlist; `sanitizeKeywords()` enforces string type, max length per keyword (50 chars), and a hard cap of 20 keywords

### 6. Internal page guard

Before messaging a tab, `background.js` checks that the URL does not start with `chrome://` or `chrome-extension://` — these pages block content script injection and would produce a silent error without this guard.

### 7. Hardcoded fetch URLs

`fetchGemini()` uses a compile-time constant URL — no variable ever reaches `fetch()`. This eliminates any SSRF vector from the extension's own code.

### 8. Secret hygiene

`.gitignore` blocks `.env`, `secrets.js`, and `config.local.js` from being committed. The key in `background.js` is a placeholder string that will never pass API authentication.

---

## Trade-offs

### Bundled Readability.js vs. CDN

**Decision:** Readability.js is bundled locally inside the extension.  
**Why:** Chrome extensions cannot load scripts from external CDNs at runtime (blocked by CSP and MV3 restrictions). Bundling guarantees availability offline and avoids a network dependency.  
**Cost:** Adds ~90KB to the extension package size.

### Direct API call vs. proxy backend

**Decision:** Default is a direct Gemini call from the service worker.  
**Why:** Eliminates backend infrastructure for development and demo purposes. The service worker context is isolated from the page — the key is not exposed to any web content.  
**Cost:** The API key is technically present in the extension bundle. Anyone who unpacks the `.crx` can read it. For production, Option B (proxy) should be used.

### `chrome.storage.local` vs. `sessionStorage`

**Decision:** `chrome.storage.local` for all caching and settings.  
**Why:** Persists across popup open/close cycles (the popup is destroyed and recreated every time it closes). `sessionStorage` would be wiped on every popup close.  
**Cost:** Summaries accumulate indefinitely. Mitigated by the Reset All button, but there is no automatic TTL expiry.

### Content cap at 8000 characters

**Decision:** Page text is sliced to 8000 characters before being sent to the API.  
**Why:** Keeps prompt size predictable, reduces latency, and avoids hitting token limits on very long pages.  
**Cost:** On extremely long articles, the summary is based on the first ~1200 words only. A future improvement would be to extract the most semantically dense paragraphs rather than a hard prefix slice.

### No streaming response

**Decision:** The full summary is returned in one response before rendering.  
**Why:** Gemini's REST API supports streaming via SSE, but implementing a streaming reader in a service worker adds significant complexity for a marginal UX gain on a ~1-3 second response.  
**Cost:** The spinner shows for the full duration with no partial text. A future improvement would stream tokens directly into the summary div.

### Token bucket rate limiter in memory

**Decision:** Rate limit state is stored in a module-level variable in the service worker.  
**Why:** Simple, zero-overhead, no storage writes on every request.  
**Cost:** The bucket resets whenever the service worker is terminated and restarted by Chrome (which can happen after ~30 seconds of inactivity). A persistent rate limit would require `chrome.storage`.

---

## 🎥 Demo Video

Watch the demo here: [Demo Video Link](https://www.loom.com/share/57f9f75e8d5c4cbfaa58dcc0fc525b0f)
