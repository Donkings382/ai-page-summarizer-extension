document.addEventListener("DOMContentLoaded", () => {
  const summarizeBtn = document.getElementById("summarize-btn");
  const clearBtn     = document.getElementById("clear-btn");
  const resetBtn     = document.getElementById("reset-btn");
  const summaryDiv   = document.getElementById("summary");
  const summaryWrap  = document.getElementById("summary-wrap");
  const loadingDiv   = document.getElementById("loading");
  const cachedBadge  = document.getElementById("cached-badge");
  const themeToggle  = document.getElementById("theme-toggle");
  const copyBtn      = document.getElementById("copy-btn");
  const highlightBtn = document.getElementById("highlight-btn");
  const wordCount    = document.getElementById("word-count");
  const bulletMode   = document.getElementById("bullet-mode");

  let highlightsActive = false;
  let lastTabId = null;

  // ── Load & persist all user settings ──────────────────────────────────────
  chrome.storage.local.get(["theme", "bulletMode"], ({ theme, bulletMode: bm }) => {
    applyTheme(theme ?? "light");
    bulletMode.checked = bm ?? false;
  });

  themeToggle.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    chrome.storage.local.set({ theme: next });
  });

  bulletMode.addEventListener("change", () => {
    chrome.storage.local.set({ bulletMode: bulletMode.checked });
  });

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  // ── Cache key — normalized URL (strips fragment, keeps path+query) ─────────
  function cacheKey(url, isBullet) {
    try {
      const u = new URL(url);
      u.hash = "";                          // strip fragment
      return `summary_${isBullet ? "bullet_" : ""}${u.toString()}`;
    } catch {
      return `summary_${isBullet ? "bullet_" : ""}${url}`;
    }
  }

  // ── Summarize ──────────────────────────────────────────────────────────────
  summarizeBtn.addEventListener("click", async () => {
    setLoading(true);
    summaryWrap.hidden = true;
    cachedBadge.hidden = true;
    resetHighlight();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    lastTabId = tab.id;
    const isBullet = bulletMode.checked;
    const key = cacheKey(tab.url, isBullet);

    // Cache hit — no API call
    chrome.storage.local.get(key, (result) => {
      if (result[key]) {
        showSummary(result[key], true, isBullet);
        return;
      }

      // Cache miss — call AI via background
      chrome.runtime.sendMessage({ action: "summarize", bulletMode: isBullet }, (response) => {
        if (chrome.runtime.lastError || response?.error) {
          showError(response?.error ?? chrome.runtime.lastError.message);
          return;
        }
        chrome.storage.local.set({ [key]: response.summary });
        showSummary(response.summary, false, isBullet);
      });
    });
  });

  // ── Clear (current summary view only) ─────────────────────────────────────
  clearBtn.addEventListener("click", () => {
    while (summaryDiv.firstChild) summaryDiv.removeChild(summaryDiv.firstChild);
    summaryWrap.hidden = true;
    wordCount.textContent = "";
    cachedBadge.hidden = true;
    copyBtn.hidden = true;
    highlightBtn.hidden = true;
    resetHighlight();
  });

  // ── Reset All (wipe all cached summaries + settings) ──────────────────────
  // Single listener with two-click confirmation — avoids confirm() and race condition
  resetBtn.addEventListener("click", () => {
    if (!resetBtn.dataset.pending) {
      // First click — arm the button
      resetBtn.textContent = "Sure? Click again";
      resetBtn.dataset.pending = "1";
      setTimeout(() => {
        if (resetBtn.dataset.pending) {
          resetBtn.textContent = "🗑 Reset All";
          delete resetBtn.dataset.pending;
        }
      }, 3000);
      return;
    }
    // Second click within 3s — execute reset
    delete resetBtn.dataset.pending;
    resetBtn.textContent = "🗑 Reset All";
    chrome.storage.local.clear(() => {
      applyTheme("light");
      bulletMode.checked = false;
      while (summaryDiv.firstChild) summaryDiv.removeChild(summaryDiv.firstChild);
      summaryWrap.hidden = true;
      wordCount.textContent = "";
      cachedBadge.hidden = true;
      copyBtn.hidden = true;
      highlightBtn.hidden = true;
      resetHighlight();
    });
  });

  // ── Copy ───────────────────────────────────────────────────────────────────
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(summaryDiv.innerText).then(() => {
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => (copyBtn.textContent = "📋 Copy"), 2000);
    });
  });

  // ── Highlight ──────────────────────────────────────────────────────────────
  highlightBtn.addEventListener("click", () => {
    if (!lastTabId) return;
    if (highlightsActive) {
      chrome.tabs.sendMessage(lastTabId, { action: "clearHighlights" });
      highlightBtn.textContent = "🔦 Highlight";
      highlightsActive = false;
      return;
    }
    const keywords = extractKeywords(summaryDiv.innerText);
    chrome.tabs.sendMessage(lastTabId, { action: "highlightKeywords", keywords });
    highlightBtn.textContent = "✖ Clear Highlights";
    highlightsActive = true;
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setLoading(on) {
    loadingDiv.hidden = !on;
    summarizeBtn.disabled = on;
    summarizeBtn.setAttribute("aria-busy", String(on));
    summarizeBtn.textContent = on ? "Summarizing…" : "Summarize Page";
    bulletMode.disabled = on; // prevent mode switch mid-request
  }

  function showSummary(text, fromCache, isBullet) {
    setLoading(false);
    while (summaryDiv.firstChild) summaryDiv.removeChild(summaryDiv.firstChild);
    summaryDiv.appendChild(isBullet ? renderBullets(text) : renderSections(text));
    summaryDiv.scrollTop = 0; // always start at top for new/cached summaries
    summaryWrap.hidden = false;
    cachedBadge.hidden = !fromCache;
    copyBtn.hidden = false;
    highlightBtn.hidden = false;
    wordCount.textContent = `${text.trim().split(/\s+/).filter(Boolean).length} words`;
  }

  function showError(msg) {
    setLoading(false);
    while (summaryDiv.firstChild) summaryDiv.removeChild(summaryDiv.firstChild);
    const p = document.createElement("p");
    p.className = "error-msg";
    p.textContent = "Error: " + msg;
    summaryDiv.appendChild(p);
    summaryWrap.hidden = false;
    copyBtn.hidden = true;
    highlightBtn.hidden = true;
    wordCount.textContent = "";
  }

  function resetHighlight() {
    if (highlightsActive && lastTabId) {
      chrome.tabs.sendMessage(lastTabId, { action: "clearHighlights" });
    }
    highlightsActive = false;
    if (highlightBtn) highlightBtn.textContent = "🔦 Highlight";
  }

  // ── DOM-based renderers (no innerHTML — fixes CWE-94) ─────────────────────

  function renderSections(text) {
    const SECTIONS = ["OVERVIEW", "KEY INSIGHTS", "READING TIME"];
    const buckets = Object.fromEntries(SECTIONS.map(s => [s, []]));
    let current = null;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (SECTIONS.includes(trimmed)) { current = trimmed; continue; }
      if (current && trimmed) buckets[current].push(trimmed);
    }

    const frag = document.createDocumentFragment();
    for (const [heading, lines] of Object.entries(buckets)) {
      if (!lines.length) continue;
      const section = document.createElement("div");
      section.className = "summary-section";

      const h2 = document.createElement("h2");
      h2.className = "section-heading";
      h2.textContent = heading;
      section.appendChild(h2);

      const bullets = lines.filter(l => l.startsWith("•"));
      if (bullets.length) {
        const ul = document.createElement("ul");
        bullets.forEach(l => {
          const li = document.createElement("li");
          li.textContent = l.slice(1).trim();
          ul.appendChild(li);
        });
        section.appendChild(ul);
      } else {
        lines.forEach(l => {
          const p = document.createElement("p");
          p.textContent = l;
          section.appendChild(p);
        });
      }
      frag.appendChild(section);
    }
    return frag;
  }

  function renderBullets(text) {
    const items = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("•"));
    const frag = document.createDocumentFragment();
    if (!items.length) {
      const p = document.createElement("p");
      p.textContent = text;
      frag.appendChild(p);
      return frag;
    }
    const ul = document.createElement("ul");
    items.forEach(l => {
      const li = document.createElement("li");
      li.textContent = l.slice(1).trim();
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    return frag;
  }

  function extractKeywords(text) {
    const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for",
      "of","with","is","are","was","were","be","been","it","this","that","from","by","as"]);
    return [...new Set(text.match(/\b[A-Z][a-z]{2,}|\b[a-z]{5,}\b/g) ?? [])]
      .filter(w => !stopWords.has(w.toLowerCase()))
      .slice(0, 15);
  }
});
