/**
 * Offscreen document — runs in a real DOM context so DOMParser works.
 * Receives { html, userSelector? } from the service worker, extracts price
 * and thumbnail, and replies with { price, currency, thumbnail, selectorUsed, strategy }.
 *
 * Four extraction strategies (in priority order):
 *  1. User-defined CSS selector
 *  2. JSON-LD structured data  (application/ld+json → offers.price)
 *  3. Open Graph meta tags     (product:price:amount)
 *  4. Heuristic CSS selectors  (itemprop, Amazon, eBay, etc.)
 */

import { parsePrice } from '../shared/currency.js';
import { HEURISTIC_SELECTORS } from '../shared/constants.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PLAY_SOUND') { playBeep(); sendResponse({ ok: true }); return true; }
  if (msg.type !== 'PARSE_HTML') return false;
  handleParse(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

/**
 * @param {{ html: string, userSelector?: string }} msg
 */
async function handleParse({ html, userSelector }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const thumbnail = extractThumbnail(doc);

  // ── Strategy 1: User-defined selector ─────────────────────────────────────
  if (userSelector) {
    const result = trySelector(doc, userSelector);
    if (result) return { ...result, strategy: 1, selectorUsed: userSelector, thumbnail };
  }

  // ── Strategy 2: JSON-LD ───────────────────────────────────────────────────
  const jsonLd = tryJsonLd(doc);
  if (jsonLd) return { ...jsonLd, strategy: 2, selectorUsed: 'json-ld', thumbnail };

  // ── Strategy 3: Open Graph ────────────────────────────────────────────────
  const og = tryOpenGraph(doc);
  if (og) return { ...og, strategy: 3, selectorUsed: 'og:price', thumbnail };

  // ── Strategy 4: Heuristic selectors ──────────────────────────────────────
  for (const sel of HEURISTIC_SELECTORS) {
    const result = trySelector(doc, sel);
    if (result) return { ...result, strategy: 4, selectorUsed: sel, thumbnail };
  }

  return { price: null, currency: null, strategy: null, selectorUsed: null, thumbnail };
}

function extractThumbnail(doc) {
  // 1. JSON-LD Product.image — most reliable (product-specific, not shop logo)
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const schemas = JSON.parse(script.textContent);
      const img = findImageInSchema(Array.isArray(schemas) ? schemas : [schemas]);
      if (img) return img;
    } catch { /* malformed — skip */ }
  }

  // 2. Microdata itemprop="image"
  const itemImg = doc.querySelector('[itemprop="image"]');
  if (itemImg) {
    const src = itemImg.getAttribute('src') ?? itemImg.getAttribute('content');
    if (src) return src;
  }

  // 3. Open Graph / Twitter (may be shop logo on some sites, but better than nothing)
  return doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
    ?? doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
    ?? null;
}

function findImageInSchema(schemas) {
  for (const schema of schemas) {
    if (schema['@graph']) {
      const img = findImageInSchema(schema['@graph']);
      if (img) return img;
    }
    if (!isProductType(schema['@type'])) continue;
    const img = imageUrlFromValue(schema.image);
    if (img) return img;
  }
  return null;
}

function isProductType(type) {
  if (!type) return false;
  return (Array.isArray(type) ? type.join(',') : String(type)).toLowerCase().includes('product');
}

function imageUrlFromValue(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    const first = image[0];
    return typeof first === 'string' ? first : (first?.url ?? null);
  }
  return image.url ?? null;
}

function playBeep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 880;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
  osc.onended = () => ctx.close();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Try a CSS selector. Returns { price, currency } or null.
 * @param {Document} doc
 * @param {string} selector
 */
function trySelector(doc, selector) {
  try {
    const el = doc.querySelector(selector);
    if (!el) return null;

    // Prefer data-price / content attribute, then textContent
    const raw = el.dataset.price || el.getAttribute('content') || el.textContent;

    if (!raw) return null;
    const parsed = parsePrice(raw.trim());
    if (!parsed) return null;

    return { price: parsed.value, currency: parsed.currency };
  } catch {
    return null;
  }
}

/**
 * Strategy 2: JSON-LD structured data.
 * Looks for Product schema with offers.price.
 */
function tryJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const schemas = Array.isArray(data) ? data : [data];
      for (const schema of schemas) {
        const result = extractFromSchema(schema);
        if (result) return result;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

function extractFromSchema(schema) {
  if (schema['@graph']) {
    for (const node of schema['@graph']) {
      const r = extractFromSchema(node);
      if (r) return r;
    }
  }

  if (!isProductType(schema['@type'])) return null;
  if (!schema.offers) return null;

  const offerList = Array.isArray(schema.offers) ? schema.offers : [schema.offers];
  return extractLowestOffer(offerList);
}

function extractLowestOffer(offerList) {
  let lowestPrice = null;
  let currency = null;
  for (const offer of offerList) {
    const raw = offer.price ?? offer.lowPrice;
    if (raw == null) continue;
    const parsed = parsePrice(String(raw));
    if (!parsed) continue;
    if (offer.priceCurrency) parsed.currency = offer.priceCurrency.toUpperCase();
    if (lowestPrice === null || parsed.value < lowestPrice) {
      lowestPrice = parsed.value;
      currency = parsed.currency;
    }
  }
  return lowestPrice === null ? null : { price: lowestPrice, currency };
}

/**
 * Strategy 3: Open Graph meta tags.
 */
function tryOpenGraph(doc) {
  const priceEl = doc.querySelector('meta[property="product:price:amount"]');
  if (!priceEl) return null;
  const raw = priceEl.getAttribute('content');
  if (!raw) return null;

  const currencyEl = doc.querySelector('meta[property="product:price:currency"]');
  const currencyRaw = currencyEl?.getAttribute('content') ?? '';

  const parsed = parsePrice(raw.trim());
  if (!parsed) return null;

  if (currencyRaw) parsed.currency = currencyRaw.toUpperCase();

  return { price: parsed.value, currency: parsed.currency };
}
