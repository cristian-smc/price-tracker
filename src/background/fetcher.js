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
  return hasSpaRoot && hasNoText;
}

/**
 * Fetch with User-Agent rotation on 403/429.
 * Returns { html, finalUrl } or throws.
 */
async function fetchWithRotation(url) {
  let lastStatus = 0;

  for (const ua of USER_AGENTS) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      });

      lastStatus = resp.status;

      if (resp.status === 403 || resp.status === 429) continue; // try next UA
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const html = await resp.text();
      // Detect canonical URL from redirect chain (fetch follows redirects)
      const finalUrl = resp.url !== url ? resp.url : null;
      return { html, finalUrl };
    } catch (err) {
      if (err.message?.startsWith('HTTP')) continue;
      throw err;
    }
  }

  throw new Error(`HTTP ${lastStatus} — all User-Agents blocked`);
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
      return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: false, canonicalUrl: finalUrl, thumbnail: null, error: result.error };
    }

    const spaDetected = !result?.price && looksLikeSpa(html);

    return {
      price: result?.price ?? null,
      currency: result?.currency ?? null,
      strategy: result?.strategy ?? null,
      selectorUsed: result?.selectorUsed ?? null,
      thumbnail: result?.thumbnail ?? null,
      requiresTabExtraction: spaDetected,
      canonicalUrl: finalUrl,
      error: null,
    };
  } catch (err) {
    return { price: null, currency: null, stock: 'unknown', strategy: null, selectorUsed: null, requiresTabExtraction: false, canonicalUrl: finalUrl, thumbnail: null, error: err.message };
  }
}

export function resetOffscreenState() {
  offscreenReady = false;
}
