# AI Page Summarizer — Chrome Extension

A Manifest V3 Chrome Extension that summarizes any webpage using the Gemini AI API.  
Displays a bullet-point summary, key insights, and estimated reading time in the popup.

---

## Installation

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `ai-page-summarizer/` folder

---

## Setup

### 1. Add your API key

Open `background.js` and replace the placeholder:

```js
const GEMINI_API_KEY = "<YOUR_GEMINI_API_KEY>";
```

Get a free key at: https://aistudio.google.com/app/apikey

### 2. (Recommended) Use a proxy instead

For production, never ship your API key in the extension bundle.  
Set up a Node.js/Express proxy and switch to Option B in `background.js`:

```js
// background.js — Option B
const PROXY_URL = "https://your-proxy.com/summarize";
```

Your proxy receives `{ text }` and returns `{ summary }`, calling Gemini server-side with the key stored in an environment variable.

---

## Project Structure

```
ai-page-summarizer/
├── manifest.json      Extension config (MV3)
├── background.js      Service worker — AI API calls (secure)
├── content.js         Content script — page text extraction
├── popup.html         Extension popup UI
├── popup.css          Styling + dark/light mode
├── popup.js           Popup logic, caching, theme toggle
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Architecture

```
User clicks icon
      │
      ▼
  popup.js  ──── chrome.storage (cache check / write)
      │
      ├── chrome.storage → cache hit → display immediately (⚡ Cached)
      │
      └── chrome.runtime.sendMessage → background.js
                    │
                    ├── chrome.tabs.sendMessage → content.js
                    │         └── Extracts visible page text
                    │
                    └── fetch() → Gemini API (or proxy)
                          └── Returns summary → popup.js → display
```

---

## Features

- One-click summarization via Gemini 1.5 Flash
- Overview, bullet points, and reading time estimate
- Per-URL caching with `chrome.storage` (⚡ Cached badge)
- Dark / Light mode toggle (preference persisted)
- API key stays in service worker only — never exposed to page

---

## Security Notes

- API key lives only in `background.js` (service worker), isolated from page context
- Page text travels via `chrome.runtime` message passing, not the DOM
- Summary rendered with `textContent`, not `innerHTML` — no XSS risk
- For production: move key to a backend proxy (see Setup above)

---

## Demo Recording

Use OBS Studio, Loom, or QuickTime to record:
1. Extension popup opening on a real webpage
2. Summarize button → loading state → summary display
3. Dark / light mode toggle
4. Revisiting the same page → ⚡ Cached badge appears
