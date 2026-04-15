/**
 * Tab-based fallback for SPA pages (React, Vue, Next.js, etc.) where
 * raw fetch() returns an empty shell with no price.
 *
 * Strategy:
 *  1. Open a small background popup. SPAs that check the Page Visibility API
 *     require an active (non-hidden) tab to render their content.
 *  2. Open in a normal (non-incognito) tab so session cookies are present,
 *     avoiding GDPR consent walls that appear when cookies are missing.
 *  3. Inject a content script that installs a MutationObserver and waits
 *     for a price element to appear (up to TAB_TIMEOUT_MS).
 *  4. The script sends back { price, selector } via chrome.runtime.sendMessage.
 *  5. We close the tab and restore focus to the tab that was active before.
 *
 * The tab is always closed — even if extraction fails or times out.
 */

import { HEURISTIC_SELECTORS } from '../shared/constants.js';

// Total time budget from window creation. Must exceed max page-load time + MAX_WAIT
// (page load ≤ ~20 s + MAX_WAIT 15 s = 35 s, so 45 s gives a safe margin).
const TAB_TIMEOUT_MS = 45_000;

/**
 * @param {import('../shared/types').Product} product
 */
export async function tabFetchAndExtract(product) {
  let tabId = null;
  let windowId = null;
  let previousTabId = null;
  let tabsListener = null;
  let msgListener  = null;
  let visScriptId  = null;

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    previousTabId = currentTab?.id ?? null;

    // Inject a MAIN-world content script at document_start that overrides
    // document.visibilityState → 'visible' so SPAs render content even in
    // an inactive background tab. persistAcrossSessions:false prevents
    // script accumulation if the service worker is killed before cleanup.
    visScriptId = `pw-vis-${Date.now()}`;
    try {
      const { hostname } = new URL(product.url);
      await chrome.scripting.registerContentScripts([{
        id: visScriptId,
        matches: [`*://${hostname}/*`],
        js: ['src/content/visibility-override.js'],
        world: 'MAIN',
        runAt: 'document_start',
        persistAcrossSessions: false,
      }]);
    } catch {
      visScriptId = null;
    }

    // Open an inactive background tab in the current window — no new window is
    // created, so there is no visible popup or taskbar flash on any platform.
    // windowId stays null so the finally block uses chrome.tabs.remove.
    const tab = await chrome.tabs.create({
      url: product.url,
      active: false,
      ...(currentTab?.windowId != null && { windowId: currentTab.windowId }),
    });
    tabId = tab.id;

    const result = await Promise.race([
      // Re-inject on every status=complete event so redirects are handled:
      // SPAs often fire complete once on the shell/redirect page and again
      // after the real content page loads — we must not remove the listener
      // on the first fire.
      new Promise((resolve) => {
        tabsListener = (changedTabId, changeInfo) => {
          if (changedTabId !== tabId || changeInfo.status !== 'complete') return;

          // Each new complete may be a different page — swap the message listener.
          if (msgListener) {
            chrome.runtime.onMessage.removeListener(msgListener);
            msgListener = null;
          }

          const args = [{ tabId, userSelector: product.selectors?.price ?? null, selectors: HEURISTIC_SELECTORS }];
          chrome.scripting.executeScript({ target: { tabId }, func: tabExtractor, args })
            .catch(() => {}); // ignore injection errors on restricted / transient pages

          msgListener = (msg) => {
            if (msg.type !== '__PW_TAB_RESULT' || msg.tabId !== tabId) return;
            chrome.runtime.onMessage.removeListener(msgListener);
            msgListener = null;
            resolve(msg);
          };
          chrome.runtime.onMessage.addListener(msgListener);
        };
        chrome.tabs.onUpdated.addListener(tabsListener);
      }),
      timeout(TAB_TIMEOUT_MS, 'Tab extraction timed out'),
    ]);

    return {
      price: result.price ?? null,
      currency: result.currency ?? null,
      strategy: result.strategy ?? null,
      selectorUsed: result.selectorUsed ?? null,
      requiresTabExtraction: true,
      error: null,
    };
  } catch (err) {
    return {
      price: null, currency: null,
      strategy: null, selectorUsed: null,
      requiresTabExtraction: true,
      error: err.message,
    };
  } finally {
    // Always clean up both listeners regardless of how the promise settled.
    if (tabsListener) chrome.tabs.onUpdated.removeListener(tabsListener);
    if (msgListener)  chrome.runtime.onMessage.removeListener(msgListener);
    if (windowId !== null) chrome.windows.remove(windowId).catch(() => {});
    else if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    if (previousTabId !== null) chrome.tabs.update(previousTabId, { active: true }).catch(() => {});
    if (visScriptId) chrome.scripting.unregisterContentScripts({ ids: [visScriptId] }).catch(() => {});
  }
}

/**
 * Runs as a content script (isolated world) — has full Chrome API access.
 * Receives serialised args — cannot close over outer-scope variables.
 */
function tabExtractor({ tabId, userSelector, selectors }) {
  // NOTE: helper functions must stay nested here —
  // executeScript serialises only this function into the page context, so
  // module-level helpers are unreachable from the injected code.
  const MAX_WAIT = 15000;
  const start = Date.now();

  // ── Cookie / GDPR consent auto-dismissal ─────────────────────────────────
  const CONSENT_SELECTORS = [
    // OneTrust
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',
    '.onetrust-accept-btn-handler',
    // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    // Generic
    '[data-testid="cookie-accept"]',
    '[data-testid="accept-all-cookies"]',
    'button[id*="accept-all"]',
    'button[id*="acceptAll"]',
    'button[class*="accept-all"]',
  ];

  // Checked via includes() so nested icon elements in textContent don't break the match.
  const ACCEPT_PHRASES = ['accept all', 'accept cookies', 'allow all', 'i accept'];

  let consentDone = false;

  function tryDismissConsent() { // NOSONAR
    if (consentDone) return;
    for (const sel of CONSENT_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el) { el.click(); consentDone = true; return; }
      } catch { /* bad selector */ }
    }
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const btn of candidates) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const txt = (btn.textContent ?? '').toLowerCase();
      if (ACCEPT_PHRASES.some((p) => txt.includes(p))) {
        btn.click(); consentDone = true; return;
      }
    }
  }

  tryDismissConsent();
  const timers = [
    setTimeout(tryDismissConsent, 1500),
    setTimeout(tryDismissConsent, 4000),
  ];

  // ── Price extraction ──────────────────────────────────────────────────────

  function tryExtract() { // NOSONAR
    const all = userSelector ? [userSelector, ...selectors] : selectors;
    for (const sel of all) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const raw = el.dataset?.price || el.getAttribute('content') || el.textContent;
        if (raw?.trim()) return { raw: raw.trim(), selectorUsed: sel };
      } catch { /* bad selector — skip */ }
    }
    return null;
  }

  function detectCurrency(raw) { // NOSONAR
    if (/\blei\b|RON/i.test(raw)) return 'RON';
    if (/€|EUR/i.test(raw))       return 'EUR';
    if (/£|GBP/i.test(raw))       return 'GBP';
    if (/\bFt\b|HUF/i.test(raw))  return 'HUF';
    if (/zł|PLN/i.test(raw))      return 'PLN';
    if (/CHF/i.test(raw))         return 'CHF';
    if (/\$|USD/i.test(raw))      return 'USD';
    return null;
  }

  function parseMinorUnits(raw) { // NOSONAR — must stay nested: executeScript serialises only tabExtractor into the page context
    const cleaned = raw.replaceAll(/[^\d.,]/g, '').trim();
    if (!cleaned || !/\d/.test(cleaned)) return null;
    const s = cleaned.replaceAll(/\s/g, '');
    const lastDot   = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const afterDot   = lastDot   >= 0 ? s.length - lastDot   - 1 : -1;
    const afterComma = lastComma >= 0 ? s.length - lastComma - 1 : -1;
    let n;
    if (lastDot > lastComma) {
      // dot is last separator: decimal if 0 or 2 digits follow, thousands if 3
      n = (afterDot === 2 || afterDot === 0) ? s.replaceAll(',', '') : s.replaceAll('.', '').replaceAll(',', '');
    } else if (lastComma > lastDot) {
      // comma is last separator: decimal if 0 or 2 digits follow, thousands if 3
      n = (afterComma === 2 || afterComma === 0) ? s.replaceAll('.', '').replace(',', '.') : s.replaceAll(',', '').replaceAll('.', '');
    } else {
      n = s;
    }
    const f = Number.parseFloat(n);
    return Number.isNaN(f) ? null : Math.round(f * 100);
  }

  // Text-scan fallback: collect all visible price-like elements and return the
  // lowest price found. "Lowest" is correct for aggregator pages (flight/hotel
  // search) that show many results — we want the best available deal, not just
  // the first or largest-font price. A minimum font size filters out footnotes.
  function tryExtractByText() { // NOSONAR
    const numThenCurr = /(?:^|[\s(])(\d[\d\s.,]{0,9}\s*(?:€|lei|RON|EUR|GBP|[£$]))(?:[\s)]|$)/i;
    const currThenNum = /(?:^|[\s(])([€£$]\s*\d[\d\s.,]{0,9})(?:[\s)]|$)/i;
    const MIN_FONT_PX = 12;
    let lowestPrice = null;
    let lowestRaw   = null;
    const candidates = document.querySelectorAll('span, div, p, strong, b, td, h1, h2, h3');
    for (const el of candidates) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = (el.textContent ?? '').trim();
        if (!text || text.length > 40) continue;
        const m = text.match(numThenCurr) ?? text.match(currThenNum);
        if (!m) continue;
        if ((Number.parseFloat(getComputedStyle(el).fontSize) || 0) < MIN_FONT_PX) continue;
        const price = parseMinorUnits(m[1].trim());
        if (!price || price <= 0) continue;
        if (lowestPrice === null || price < lowestPrice) {
          lowestPrice = price;
          lowestRaw   = m[1].trim();
        }
      } catch { /* skip */ }
    }
    return lowestRaw ? { raw: lowestRaw, selectorUsed: '_text_scan' } : null;
  }

  let sent = false;
  function send(data) {
    if (sent) return;
    sent = true;
    timers.forEach(clearTimeout);
    chrome.runtime.sendMessage({ type: '__PW_TAB_RESULT', tabId, ...data });
  }

  function tryAll() { // NOSONAR
    return tryExtract() ?? tryExtractByText();
  }

  const initial = tryAll();
  if (initial) {
    const price = parseMinorUnits(initial.raw);
    if (price > 0) { send({ price, currency: detectCurrency(initial.raw) ?? 'USD', selectorUsed: initial.selectorUsed, strategy: 4 }); return; }
  }

  const observer = new MutationObserver(() => {
    tryDismissConsent();
    const r = tryAll();
    if (r) {
      const price = parseMinorUnits(r.raw);
      if (price > 0) {
        observer.disconnect();
        send({ price, currency: detectCurrency(r.raw) ?? 'USD', selectorUsed: r.selectorUsed, strategy: 4 });
        return;
      }
    }
    if (Date.now() - start > MAX_WAIT) {
      observer.disconnect();
      send({ price: null, currency: null, selectorUsed: null, strategy: null });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Guaranteed send: if the page stops mutating before MAX_WAIT (static page after
  // initial SPA load, or price never found), this timer fires and sends a final answer.
  // Without this, the observer MAX_WAIT check inside the callback never runs
  // on a "quiet" page, causing the 45 s outer timeout to fire instead (→ error).
  timers.push(setTimeout(() => {
    observer.disconnect();
    const last = tryAll();
    const price = last ? parseMinorUnits(last.raw) : null;
    if (price > 0) {
      send({ price, currency: detectCurrency(last.raw) ?? 'USD', selectorUsed: last.selectorUsed, strategy: 4 });
    } else {
      send({ price: null, currency: null, selectorUsed: null, strategy: null });
    }
  }, Math.max(MAX_WAIT - (Date.now() - start), 500)));
}

function timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
