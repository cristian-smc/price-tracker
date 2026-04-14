/**
 * Tab-based fallback for SPA pages (React, Vue, Next.js, etc.) where
 * raw fetch() returns an empty shell with no price.
 *
 * Strategy:
 *  1. Create a hidden tab (active: false) for the product URL.
 *  2. Inject a content script that installs a MutationObserver and waits
 *     for a price element to appear (up to TAB_TIMEOUT_MS).
 *  3. The script sends back { price, selector } via chrome.runtime.sendMessage.
 *  4. We close the tab and return the result.
 *
 * The tab is always closed — even if extraction fails or times out.
 */

import { HEURISTIC_SELECTORS, STOCK_SELECTORS, STOCK_STATUS } from '../shared/constants.js';
import { parsePrice } from '../shared/currency.js';

const TAB_TIMEOUT_MS = 20_000;
const EXTRACT_FN_NAME = '__pwExtract'; // must match the injected function name

/**
 * @param {import('../shared/types').Product} product
 */
export async function tabFetchAndExtract(product) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({
      url: product.url,
      active: false,
    });
    tabId = tab.id;

    const result = await Promise.race([
      waitForTabExtraction(tabId, product),
      timeout(TAB_TIMEOUT_MS, 'Tab extraction timed out'),
    ]);

    return {
      price: result.price ?? null,
      currency: result.currency ?? null,
      stock: result.stock ?? STOCK_STATUS.UNKNOWN,
      strategy: result.strategy ?? null,
      selectorUsed: result.selectorUsed ?? null,
      requiresTabExtraction: true,
      error: null,
    };
  } catch (err) {
    return {
      price: null, currency: null,
      stock: STOCK_STATUS.UNKNOWN,
      strategy: null, selectorUsed: null,
      requiresTabExtraction: true,
      error: err.message,
    };
  } finally {
    if (tabId !== null) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
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
  const userSelector = product.selectors?.price ?? null;
  const selectors = JSON.stringify(HEURISTIC_SELECTORS);
  const stockSelectors = JSON.stringify(STOCK_SELECTORS);

  // The injected function runs in the page context (no imports available)
  const injectedCode = `
  (function() {
    if (window.__pwInjected) return;
    window.__pwInjected = true;

    const SELECTORS = ${selectors};
    const STOCK_SELS = ${stockSelectors};
    const USER_SEL = ${JSON.stringify(userSelector)};
    const MAX_WAIT = 10000;
    const start = Date.now();

    function tryExtract() {
      const allSelectors = USER_SEL ? [USER_SEL, ...SELECTORS] : SELECTORS;
      for (const sel of allSelectors) {
        try {
          const el = document.querySelector(sel);
          if (!el) continue;
          const raw = el.getAttribute('data-price') || el.getAttribute('content') || el.textContent;
          if (raw && raw.trim()) return { raw: raw.trim(), selectorUsed: sel };
        } catch {}
      }
      return null;
    }

    function parseMinorUnits(raw) {
      // Minimal inline parser — avoids module import in injected context
      const cleaned = raw.replace(/[^\\d.,]/g, ' ').trim();
      const numMatch = cleaned.match(/[\\d\\s,\\.]+/);
      if (!numMatch) return null;
      const s = numMatch[0].replace(/\\s/g, '');
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      let normalized;
      if (lastDot > lastComma) {
        normalized = s.replace(/,/g, '');
      } else if (lastComma > lastDot) {
        normalized = s.replace(/\\./g, '').replace(',', '.');
      } else {
        normalized = s;
      }
      const f = parseFloat(normalized);
      return isNaN(f) ? null : Math.round(f * 100);
    }

    function detectStock() {
      for (const sel of STOCK_SELS) {
        const el = document.querySelector(sel);
        if (el) {
          if (el.hasAttribute('disabled')) return 'out_of_stock';
          const t = (el.textContent || '').toLowerCase();
          if (t.includes('out of stock') || t.includes('sold out')) return 'out_of_stock';
          return 'in_stock';
        }
      }
      return 'unknown';
    }

    function send(data) {
      chrome.runtime.sendMessage({ type: '__PW_TAB_RESULT', tabId: ${tabId}, ...data });
    }

    const result = tryExtract();
    if (result) {
      const price = parseMinorUnits(result.raw);
      if (price && price > 0) {
        send({ price, currency: 'USD', stock: detectStock(), selectorUsed: result.selectorUsed, strategy: 4 });
        return;
      }
    }

    // MutationObserver fallback — wait for DOM to settle
    const observer = new MutationObserver(() => {
      const r = tryExtract();
      if (r) {
        const price = parseMinorUnits(r.raw);
        if (price && price > 0) {
          observer.disconnect();
          send({ price, currency: 'USD', stock: detectStock(), selectorUsed: r.selectorUsed, strategy: 4 });
        }
      }
      if (Date.now() - start > MAX_WAIT) {
        observer.disconnect();
        send({ price: null, currency: null, stock: detectStock(), selectorUsed: null, strategy: null });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  })();
  `;

  chrome.scripting.executeScript({
    target: { tabId },
    func: new Function(injectedCode), // CSP-safe: no eval; executeScript bypasses page CSP
    world: 'MAIN',
  }).catch(reject);

  // Listen for the result from the injected script
  function onMessage(msg) {
    if (msg.type !== '__PW_TAB_RESULT' || msg.tabId !== tabId) return;
    chrome.runtime.onMessage.removeListener(onMessage);
    resolve(msg);
  }
  chrome.runtime.onMessage.addListener(onMessage);
}

function timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
