/**
 * Fetches a URL and returns extracted price/stock data.
 *
 * Improvements over v1:
 *  - User-Agent rotation on 403/429
 *  - Canonical URL detection (follows redirects, stores final URL)
 *  - "Site not supported" detection after exhausted strategies
 */

import { retry } from '../shared/utils.js';
import { USER_AGENTS } from '../shared/constants.js';

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/offscreen.html');
const OFFSCREEN_REASON = 'DOM_PARSER';

let offscreenReady = false;
// Caches the in-flight creation promise so concurrent callers (multiple alarms
// firing near-simultaneously) await the same createDocument() call instead of
// each racing to create one — only a single offscreen document is allowed.
let offscreenCreating = null;

async function ensureOffscreen() {
  if (offscreenReady) return;
  if (!offscreenCreating) {
    offscreenCreating = (async () => {
      const existing = await chrome.offscreen.hasDocument?.() ?? false;
      if (!existing) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: [OFFSCREEN_REASON],
          justification: 'Parse product page HTML with DOMParser to extract prices',
        });
      }
      offscreenReady = true;
    })().finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating;
}

async function parseWithOffscreen(html, url, userSelector) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({
    type: 'PARSE_HTML',
    html,
    url,
    userSelector: userSelector ?? null,
  });
}

function looksLikeSpa(html) {
  const hasSpaRoot = /<div[^>]+id=["']?(root|app|__next|__nuxt)["']?/i.test(html);
  const hasNoText  = (html.match(/>([A-Za-z0-9][\w\s]{20,})</g) ?? []).length < 3;
  // Google's SPA framework (Flights, Hotels, Travel) uses <c-wiz> custom elements
  // instead of the standard React/Vue/Next.js root div patterns above.
  const hasGoogleWiz = /<c-wiz[\s/>]/i.test(html);
  return (hasSpaRoot && hasNoText) || hasGoogleWiz;
}

/**
 * Fetch with User-Agent rotation on 403/429.
 * Returns { html, finalUrl } or throws.
 */
async function fetchWithRotation(url) {
  let lastStatus = 0;
  let lastNetworkError = null;

  for (const ua of USER_AGENTS) {
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      lastNetworkError = err; // network/timeout error — try next UA
      continue;
    }

    lastStatus = resp.status;
    if (resp.status === 403 || resp.status === 429) continue; // try next UA

    // A definitive non-UA-related status (404, 500, ...) — fail fast with the
    // real reason instead of cycling through the remaining UAs.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();
    // Detect canonical URL from redirect chain (fetch follows redirects)
    const finalUrl = resp.url === url ? null : resp.url;
    return { html, finalUrl };
  }

  if (lastStatus) throw new Error(`HTTP ${lastStatus} — all User-Agents blocked`);
  throw lastNetworkError ?? new Error('Network error — all User-Agents failed');
}

export async function fetchAndExtract(product) {
  if (product.requiresTabExtraction) {
    return { price: null, currency: null, strategy: null, selectorUsed: null, requiresTabExtraction: true, canonicalUrl: null, thumbnail: null, error: null };
  }

  let html, finalUrl;
  try {
    ({ html, finalUrl } = await retry(() => fetchWithRotation(product.url), { attempts: 2, baseDelayMs: 1000 }));
  } catch (err) {
    return { price: null, currency: null, strategy: null, selectorUsed: null, requiresTabExtraction: false, canonicalUrl: null, thumbnail: null, error: err.message };
  }

  try {
    const result = await parseWithOffscreen(html, product.url, product.selectors?.price ?? null);

    if (result?.error) {
      return { price: null, currency: null, inStock: null, strategy: null, selectorUsed: null, requiresTabExtraction: false, canonicalUrl: finalUrl, thumbnail: null, error: result.error };
    }

    const spaDetected = !result?.price && looksLikeSpa(html);

    return {
      price: result?.price ?? null,
      currency: result?.currency ?? null,
      strategy: result?.strategy ?? null,
      selectorUsed: result?.selectorUsed ?? null,
      thumbnail: result?.thumbnail ?? null,
      inStock: result?.inStock ?? null,
      requiresTabExtraction: spaDetected,
      canonicalUrl: finalUrl,
      error: null,
    };
  } catch (err) {
    return { price: null, currency: null, inStock: null, strategy: null, selectorUsed: null, requiresTabExtraction: false, canonicalUrl: finalUrl, thumbnail: null, error: err.message };
  }
}

export function resetOffscreenState() {
  offscreenReady = false;
  offscreenCreating = null;
}
