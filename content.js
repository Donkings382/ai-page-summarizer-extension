// ─── Clutter tags stripped before fallback extraction ────────────────────────
const CLUTTER_TAGS = ["script","style","nav","footer","header","aside","noscript","iframe","form","figure"];

// ─── Extraction ───────────────────────────────────────────────────────────────
function extractWithReadability() {
  if (typeof Readability === "undefined") return null;
  try {
    const article = new Readability(document.cloneNode(true)).parse();
    return article?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  } catch {
    return null;
  }
}

function extractFromElement(el) {
  const clone = el.cloneNode(true);
  CLUTTER_TAGS.forEach(tag => clone.querySelectorAll(tag).forEach(n => n.remove()));
  return clone.innerText?.replace(/\s+/g, " ").trim() ?? "";
}

function extractMainContent() {
  const readabilityText = extractWithReadability();
  if (readabilityText && readabilityText.length > 100) return readabilityText;

  const article = document.querySelector("article");
  if (article) return extractFromElement(article);

  const main = document.querySelector("main");
  if (main) return extractFromElement(main);

  const richest = [...document.querySelectorAll("div, section")]
    .slice(0, 50) // cap candidates — avoids reflow on thousands of elements
    .reduce((best, el) =>
      (el.innerText?.length ?? 0) > (best.innerText?.length ?? 0) ? el : best
    , document.body);

  return extractFromElement(richest);
}

// ─── Highlight ────────────────────────────────────────────────────────────────
const HIGHLIGHT_CLASS = "ai-summarizer-highlight";

function injectHighlightStyles() {
  if (document.getElementById("ai-summarizer-styles")) return;
  const style = document.createElement("style");
  style.id = "ai-summarizer-styles";
  // textContent — not innerHTML — no XSS risk
  style.textContent = `
    .${HIGHLIGHT_CLASS} { background:#fef08a; color:#000; border-radius:2px; padding:0 2px; }
    @media (prefers-color-scheme:dark) {
      .${HIGHLIGHT_CLASS} { background:#854d0e; color:#fef9c3; }
    }`;
  document.head.appendChild(style);
}

function highlightKeywords(keywords) {
  clearHighlights();
  injectHighlightStyles();
  if (!keywords.length) return;

  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(`script,style,.${HIGHLIGHT_CLASS}`)) continue;
    if (pattern.test(node.textContent)) nodes.push(node);
  }

  nodes.forEach(textNode => {
    const frag = document.createDocumentFragment();
    textNode.textContent.split(pattern).forEach(part => {
      if (pattern.test(part)) {
        const mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        mark.textContent = part;          // textContent — XSS-safe
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(mark =>
    mark.replaceWith(document.createTextNode(mark.textContent))
  );
  document.body.normalize();
}

// ─── Message validation ───────────────────────────────────────────────────────
const VALID_ACTIONS = new Set(["extractContent", "highlightKeywords", "clearHighlights"]);

function validateMsg(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (!VALID_ACTIONS.has(msg.action)) return null;
  return msg;
}

function sanitizeKeywords(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(k => typeof k === "string" && k.length > 0 && k.length <= 50)
    .slice(0, 20); // hard cap — never trust caller count
}

// ─── Message Listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const validated = validateMsg(msg);
  if (!validated) return false;

  if (validated.action === "extractContent") {
    sendResponse({ content: extractMainContent() });
    return true;
  }

  if (validated.action === "highlightKeywords") {
    highlightKeywords(sanitizeKeywords(validated.keywords));
    sendResponse({ ok: true });
    return true;
  }

  if (validated.action === "clearHighlights") {
    clearHighlights();
    sendResponse({ ok: true });
    return true;
  }
});
