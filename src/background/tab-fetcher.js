/**
 * Tab-based fallback for SPA pages (React, Vue, Next.js, etc.) where
 * raw fetch() returns an empty shell with no price.
 *
 * Strategy:
 *  1. Open a small background popup. SPAs that check the Page Visibility API
 *     require an active (non-hidden) tab to render their content.
 *  2. Prefer incognito to avoid session-cookie interference on some sites.
 *  3. Inject a content script that installs a MutationObserver and waits
 *     for a price element to appear (up to TAB_TIMEOUT_MS).
 *  4. The script sends back { price, selector } via chrome.runtime.sendMessage.
 *  5. We close the tab and restore focus to the tab that was active before.
 *
 * The tab is always closed — even if extraction fails or times out.
 */

import { HEURISTIC_SELECTORS } from '../shared/constants.js';

const TAB_TIMEOUT_MS = 20_000;

/**
 * @param {import('../shared/types').Product} product
 */
export async function tabFetchAndExtract(product) {
  let tabId = null;
  let windowId = null;
  let previousTabId = null;
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    previousTabId = currentTab?.id ?? null;

    // Prefer incognito — sites like Wizz Air return "Critical error" when they
    // detect existing session cookies from a logged-in/prior session. A fresh
    // incognito context has no cookies and loads normally.
    // Fallback to a normal active tab if the user hasn't enabled incognito access.
    const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
    if (incognitoAllowed) {
      const win = await chrome.windows.create({ url: product.url, incognito: true, focused: false, type: 'popup', width: 800, height: 600 });
      tabId = win.tabs[0].id;
      windowId = win.id;
    } else {
      const tab = await chrome.tabs.create({ url: product.url, active: true });
      tabId = tab.id;
    }

    const result = await Promise.race([
      waitForTabExtraction(tabId, product),
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
    if (windowId !== null) chrome.windows.remove(windowId).catch(() => {});
    else if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    if (previousTabId !== null) chrome.tabs.update(previousTabId, { active: true }).catch(() => {});
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Injects extraction script into tab and waits for the result message.
 */
function waitForTabExtraction(tabId, product) {
  return new Promise((resolve, reject) => {
    // Wait for tab to finish loading before injecting
    const loadListener = (changedTabId, changeInfo) => {
      if (changedTabId !== tabId || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(loadListener);
      injectAndListen(tabId, product, resolve, reject);
    };
    chrome.tabs.onUpdated.addListener(loadListener);
  });
}

function injectAndListen(tabId, product, resolve, reject) {
  const args = [{ tabId, userSelector: product.selectors?.price ?? null, selectors: HEURISTIC_SELECTORS }];

  chrome.scripting.executeScript({
    target: { tabId },
    func: tabExtractor,
    args,
    world: 'MAIN',
  }).catch(reject);

  function onMessage(msg) {
    if (msg.type !== '__PW_TAB_RESULT' || msg.tabId !== tabId) return;
    chrome.runtime.onMessage.removeListener(onMessage);
    resolve(msg);
  }
  chrome.runtime.onMessage.addListener(onMessage);
}

/**
 * Runs inside the page context (world: MAIN). No module imports available.
 * Receives serialised args — cannot close over outer-scope variables.
 */
function tabExtractor({ tabId, userSelector, selectors }) {
  // NOTE: helper functions must stay nested here —
  // executeScript serialises only this function into the page context, so
  // module-level helpers are unreachable from the injected code.
  if (globalThis.__pwInjected) return;
  globalThis.__pwInjected = true;

  const MAX_WAIT = 12000;
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

  function send(data) {
    timers.forEach(clearTimeout);
    chrome.runtime.sendMessage({ type: '__PW_TAB_RESULT', tabId, ...data });
  }

  const initial = tryExtract();
  if (initial) {
    const price = parseMinorUnits(initial.raw);
    if (price > 0) { send({ price, currency: detectCurrency(initial.raw) ?? 'USD', selectorUsed: initial.selectorUsed, strategy: 4 }); return; }
  }

  const observer = new MutationObserver(() => {
    tryDismissConsent();
    const r = tryExtract();
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
}

function timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
