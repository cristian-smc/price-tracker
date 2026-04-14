/**
 * Fetches a URL and returns extracted price/stock data.
 *
 * Flow:
 *  1. Try raw fetch → send HTML to offscreen document for parsing.
 *  2. If price is null and page looks SPA-rendered, set requiresTabExtraction.
 *     (Tab-based fallback is implemented in Phase 7 / check-engine.js.)
 *
 * The offscreen document is created lazily and kept alive across calls
 * within the same service worker lifecycle.
 */

import { retry } from '../shared/utils.js';

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/offscreen.html');
const OFFSCREEN_REASON = 'DOM_PARSER';

let offscreenReady = false;

/**
 * Ensure the offscreen document exists.
 */
async function ensureOffscreen() {
  if (offscreenReady) return;
  const existing = await chrome.offscreen.hasDocument?.() ?? false;
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [OFFSCREEN_REASON],
      justification: 'Parse product page HTML with DOMParser to extract prices',
    });
  }
  offscreenReady = true;
}

/**
 * Send HTML to the offscreen document for extraction.
 * @param {string} html
 * @param {string} url
 * @param {string|null} userSelector
 */
async function parseWithOffscreen(html, url, userSelector) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({
    type: 'PARSE_HTML',
    html,
    url,
    userSelector: userSelector ?? null,
  });
}

/**
 * Detect whether a page is likely SPA-rendered (no meaningful text content
 * despite having a JS framework root element).
 * @param {string} html raw HTML string
 */
function looksLikeSpa(html) {
  const hasSpaRoot = /<div[^>]+id=["']?(root|app|__next|__nuxt)["']?/i.test(html);
  const hasNoText = (html.match(/>([A-Za-z0-9][\w\s]{20,})</g) ?? []).length < 3;
  return hasSpaRoot && hasNoText;
}

/**
 * Fetch a product URL and extract its price + stock.
 *
 * @param {{ url: string, selectors?: { price?: string|null }, requiresTabExtraction?: boolean }} product
 * @returns {Promise<{
 *   price: number|null,
 *   currency: string|null,
 *   stock: string,
 *   strategy: number|null,
 *   selectorUsed: string|null,
 *   requiresTabExtraction: boolean,
 *   error: string|null
 * }>}
 */
export async function fetchAndExtract(product) {
  // If flagged as SPA, skip straight to tab-based fallback signal
  if (product.requiresTabExtraction) {
    return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: true, error: null };
  }

  let html;
  try {
    html = await retry(async () => {
      const resp = await fetch(product.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceWatch/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    }, { attempts: 3, baseDelayMs: 1000 });
  } catch (err) {
    return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: false, error: err.message };
  }

  try {
    const result = await parseWithOffscreen(html, product.url, product.selectors?.price ?? null);

    if (result?.error) {
      return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: false, error: result.error };
    }

    // If no price found and page looks SPA-rendered, flag for tab extraction
    const spaDetected = !result?.price && looksLikeSpa(html);

    return {
      price: result?.price ?? null,
      currency: result?.currency ?? null,
      stock: result?.stock ?? 'unknown',
      strategy: result?.strategy ?? null,
      selectorUsed: result?.selectorUsed ?? null,
      requiresTabExtraction: spaDetected,
      error: null,
    };
  } catch (err) {
    return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: false, error: err.message };
  }
}

/**
 * Invalidate the offscreen ready flag — call if the offscreen document
 * is closed externally (e.g. on chrome.offscreen events).
 */
export function resetOffscreenState() {
  offscreenReady = false;
}
