/**
 * Offscreen document — runs in a real DOM context so DOMParser works.
 * Receives { html, url } from the service worker, extracts price + stock,
 * and replies with { price, currency, stock, selectorUsed, strategy }.
 *
 * Five extraction strategies (in priority order):
 *  1. User-defined CSS selector
 *  2. JSON-LD structured data  (application/ld+json → offers.price)
 *  3. Open Graph meta tags     (product:price:amount)
 *  4. Heuristic CSS selectors  (itemprop, Amazon, eBay, etc.)
 *  5. Add-to-cart button state (stock-only fallback)
 */

import { parsePrice } from '../shared/currency.js';
import { HEURISTIC_SELECTORS, STOCK_SELECTORS, STOCK_STATUS } from '../shared/constants.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'PARSE_HTML') return false;
  handleParse(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async reply
});

/**
 * @param {{ html: string, url: string, userSelector?: string }} msg
 */
async function handleParse({ html, url, userSelector }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── Strategy 1: User-defined selector ─────────────────────────────────────
  if (userSelector) {
    const result = trySelector(doc, userSelector);
    if (result) return { ...result, strategy: 1, selectorUsed: userSelector };
  }

  // ── Strategy 2: JSON-LD ───────────────────────────────────────────────────
  const jsonLd = tryJsonLd(doc);
  if (jsonLd) return { ...jsonLd, strategy: 2, selectorUsed: 'json-ld' };

  // ── Strategy 3: Open Graph ────────────────────────────────────────────────
  const og = tryOpenGraph(doc);
  if (og) return { ...og, strategy: 3, selectorUsed: 'og:price' };

  // ── Strategy 4: Heuristic selectors ──────────────────────────────────────
  for (const sel of HEURISTIC_SELECTORS) {
    const result = trySelector(doc, sel);
    if (result) return { ...result, strategy: 4, selectorUsed: sel };
  }

  // ── Strategy 5: Stock-only (add-to-cart presence) ────────────────────────
  const stock = detectStock(doc);
  if (stock !== STOCK_STATUS.UNKNOWN) {
    return { price: null, currency: null, stock, strategy: 5, selectorUsed: null };
  }

  return { price: null, currency: null, stock: STOCK_STATUS.UNKNOWN, strategy: null, selectorUsed: null };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Try a CSS selector. Returns { price, currency, stock } or null.
 * @param {Document} doc
 * @param {string} selector
 */
function trySelector(doc, selector) {
  try {
    const el = doc.querySelector(selector);
    if (!el) return null;

    // Prefer data-price / content attribute, then textContent
    const raw =
      el.getAttribute('data-price') ||
      el.getAttribute('content') ||
      el.textContent;

    if (!raw) return null;
    const parsed = parsePrice(raw.trim());
    if (!parsed) return null;

    return { price: parsed.value, currency: parsed.currency, stock: detectStock(doc) };
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
        const result = extractFromSchema(schema, doc);
        if (result) return result;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

function extractFromSchema(schema, doc) {
  // Handle @graph arrays
  if (schema['@graph']) {
    for (const node of schema['@graph']) {
      const r = extractFromSchema(node, doc);
      if (r) return r;
    }
  }

  const type = schema['@type'];
  if (!type) return null;
  const typeStr = Array.isArray(type) ? type.join(',') : String(type);
  if (!typeStr.toLowerCase().includes('product')) return null;

  const offers = schema.offers;
  if (!offers) return null;

  // offers can be a single object or an array
  const offerList = Array.isArray(offers) ? offers : [offers];
  let lowestPrice = null;
  let currency = null;

  for (const offer of offerList) {
    const raw = offer.price ?? offer.lowPrice;
    if (raw == null) continue;
    const parsed = parsePrice(String(raw));
    if (!parsed) continue;

    // If currency is specified, trust it over symbol detection
    if (offer.priceCurrency) {
      parsed.currency = offer.priceCurrency.toUpperCase();
    }

    if (lowestPrice === null || parsed.value < lowestPrice) {
      lowestPrice = parsed.value;
      currency = parsed.currency;
    }
  }

  if (lowestPrice === null) return null;

  // Stock from JSON-LD
  const availabilityRaw = offerList[0]?.availability ?? '';
  const stock = parseJsonLdAvailability(availabilityRaw);

  return { price: lowestPrice, currency, stock };
}

function parseJsonLdAvailability(raw) {
  if (!raw) return STOCK_STATUS.UNKNOWN;
  const s = raw.toLowerCase();
  if (s.includes('instock') || s.includes('in_stock')) return STOCK_STATUS.IN_STOCK;
  if (s.includes('outofstock') || s.includes('out_of_stock')) return STOCK_STATUS.OUT_OF_STOCK;
  return STOCK_STATUS.UNKNOWN;
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

  return { price: parsed.value, currency: parsed.currency, stock: detectStock(doc) };
}

/**
 * Strategy 4/5 helper: detect stock from common DOM signals.
 * @param {Document} doc
 * @returns {string} STOCK_STATUS.*
 */
function detectStock(doc) {
  // Check itemprop="availability"
  const availEl = doc.querySelector('[itemprop="availability"]');
  if (availEl) {
    const href = availEl.getAttribute('href') ?? availEl.getAttribute('content') ?? availEl.textContent ?? '';
    const s = href.toLowerCase();
    if (s.includes('instock') || s.includes('in_stock') || s.includes('in stock')) return STOCK_STATUS.IN_STOCK;
    if (s.includes('outofstock') || s.includes('out_of_stock') || s.includes('out of stock')) return STOCK_STATUS.OUT_OF_STOCK;
  }

  // Check add-to-cart buttons — if disabled or absent → out of stock
  for (const sel of STOCK_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) {
      if (el.hasAttribute('disabled')) return STOCK_STATUS.OUT_OF_STOCK;
      const text = (el.textContent ?? '').toLowerCase();
      if (text.includes('out of stock') || text.includes('sold out') || text.includes('unavailable')) {
        return STOCK_STATUS.OUT_OF_STOCK;
      }
      return STOCK_STATUS.IN_STOCK;
    }
  }

  return STOCK_STATUS.UNKNOWN;
}
