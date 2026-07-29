/**
 * Tests for the five extraction strategies in offscreen.js.
 * Since offscreen.js runs in a browser DOM context, these tests use
 * JSDOM (via jest-environment-jsdom) to simulate DOMParser + document.
 *
 * Run with: npx jest tests/unit/extractor.test.js
 */

// Re-implement the extraction logic in a testable, environment-independent form
// by importing the helpers directly via a thin test harness below.

import { HEURISTIC_SELECTORS } from '../../src/shared/constants.js';
import { parsePrice } from '../../src/shared/currency.js';

// ── Inline the extraction helpers (mirrors offscreen.js logic) ──────────────
// offscreen.js only runs inside the offscreen document (wired to
// chrome.runtime.onMessage) and doesn't export these as pure functions, so
// this suite exercises a local mirror. STOCK_STATUS/STOCK_SELECTORS below are
// test-only fixtures — production stock detection (offscreen.js extractStock)
// returns a plain boolean|null, not this enum.
const STOCK_STATUS = { IN_STOCK: 'in_stock', OUT_OF_STOCK: 'out_of_stock', UNKNOWN: 'unknown' };
const STOCK_SELECTORS = ['#add-to-cart-button', '.add-to-cart', '[data-testid="add-to-cart"]'];

function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function detectStock(doc) {
  const availEl = doc.querySelector('[itemprop="availability"]');
  if (availEl) {
    const href = availEl.getAttribute('href') ?? availEl.getAttribute('content') ?? availEl.textContent ?? '';
    const s = href.toLowerCase();
    if (s.includes('instock') || s.includes('in stock')) return STOCK_STATUS.IN_STOCK;
    if (s.includes('outofstock') || s.includes('out of stock')) return STOCK_STATUS.OUT_OF_STOCK;
  }
  for (const sel of STOCK_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) {
      if (el.hasAttribute('disabled')) return STOCK_STATUS.OUT_OF_STOCK;
      const text = (el.textContent ?? '').toLowerCase();
      if (text.includes('out of stock') || text.includes('sold out')) return STOCK_STATUS.OUT_OF_STOCK;
      return STOCK_STATUS.IN_STOCK;
    }
  }
  return STOCK_STATUS.UNKNOWN;
}

function trySelector(doc, selector) {
  try {
    const el = doc.querySelector(selector);
    if (!el) return null;
    const raw = el.getAttribute('data-price') || el.getAttribute('content') || el.textContent;
    if (!raw) return null;
    const parsed = parsePrice(raw.trim());
    if (!parsed) return null;
    return { price: parsed.value, currency: parsed.currency, stock: detectStock(doc) };
  } catch { return null; }
}

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
    } catch { /* skip */ }
  }
  return null;
}

function parseJsonLdAvailability(raw) {
  if (!raw) return STOCK_STATUS.UNKNOWN;
  const s = raw.toLowerCase();
  if (s.includes('instock')) return STOCK_STATUS.IN_STOCK;
  if (s.includes('outofstock')) return STOCK_STATUS.OUT_OF_STOCK;
  return STOCK_STATUS.UNKNOWN;
}

function extractFromSchema(schema, doc) {
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
  const offerList = Array.isArray(offers) ? offers : [offers];
  let lowestPrice = null; let currency = null;
  for (const offer of offerList) {
    const raw = offer.price ?? offer.lowPrice;
    if (raw == null) continue;
    const parsed = parsePrice(String(raw));
    if (!parsed) continue;
    if (offer.priceCurrency) parsed.currency = offer.priceCurrency.toUpperCase();
    if (lowestPrice === null || parsed.value < lowestPrice) { lowestPrice = parsed.value; currency = parsed.currency; }
  }
  if (lowestPrice === null) return null;
  const stock = parseJsonLdAvailability(offerList[0]?.availability ?? '');
  return { price: lowestPrice, currency, stock };
}

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Strategy 1 — user-defined selector', () => {
  test('extracts price via custom selector', () => {
    const doc = parseDoc('<html><body><span class="my-price">$49.99</span></body></html>');
    const result = trySelector(doc, '.my-price');
    expect(result).toMatchObject({ price: 4999, currency: 'USD' });
  });

  test('returns null when selector not found', () => {
    const doc = parseDoc('<html><body><p>no price</p></body></html>');
    expect(trySelector(doc, '.my-price')).toBeNull();
  });

  test('prefers data-price attribute over textContent', () => {
    const doc = parseDoc('<html><body><span class="p" data-price="89.99">$100</span></body></html>');
    const result = trySelector(doc, '.p');
    // data-price "89.99" has no symbol — falls back to USD
    expect(result?.price).toBe(8999);
  });

  test('prefers content attribute', () => {
    const doc = parseDoc('<html><body><meta itemprop="price" content="29.99"></body></html>');
    const result = trySelector(doc, '[itemprop="price"]');
    expect(result?.price).toBe(2999);
  });
});

describe('Strategy 2 — JSON-LD', () => {
  test('extracts from basic Product schema', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': 'Widget',
      'offers': { '@type': 'Offer', 'price': '19.99', 'priceCurrency': 'USD', 'availability': 'https://schema.org/InStock' }
    });
    const doc = parseDoc(`<html><head><script type="application/ld+json">${ld}</script></head></html>`);
    expect(tryJsonLd(doc)).toMatchObject({ price: 1999, currency: 'USD', stock: STOCK_STATUS.IN_STOCK });
  });

  test('picks lowest price from multiple offers', () => {
    const ld = JSON.stringify({
      '@type': 'Product',
      'offers': [
        { price: '59.99', priceCurrency: 'USD' },
        { price: '39.99', priceCurrency: 'USD' },
      ]
    });
    const doc = parseDoc(`<html><head><script type="application/ld+json">${ld}</script></head></html>`);
    expect(tryJsonLd(doc)?.price).toBe(3999);
  });

  test('handles @graph wrapper', () => {
    const ld = JSON.stringify({
      '@graph': [{ '@type': 'Product', offers: { price: '99', priceCurrency: 'USD', availability: 'OutOfStock' } }]
    });
    const doc = parseDoc(`<html><head><script type="application/ld+json">${ld}</script></head></html>`);
    expect(tryJsonLd(doc)).toMatchObject({ price: 9900, stock: STOCK_STATUS.OUT_OF_STOCK });
  });

  test('returns null for malformed JSON', () => {
    const doc = parseDoc('<html><head><script type="application/ld+json">{bad json</script></head></html>');
    expect(tryJsonLd(doc)).toBeNull();
  });

  test('returns null when no Product type', () => {
    const ld = JSON.stringify({ '@type': 'Article', name: 'Blog post' });
    const doc = parseDoc(`<html><head><script type="application/ld+json">${ld}</script></head></html>`);
    expect(tryJsonLd(doc)).toBeNull();
  });
});

describe('Strategy 3 — Open Graph', () => {
  test('extracts OG price and currency', () => {
    const doc = parseDoc(`<html><head>
      <meta property="product:price:amount" content="34.99">
      <meta property="product:price:currency" content="EUR">
    </head></html>`);
    expect(tryOpenGraph(doc)).toMatchObject({ price: 3499, currency: 'EUR' });
  });

  test('defaults to USD when no currency meta', () => {
    const doc = parseDoc(`<html><head>
      <meta property="product:price:amount" content="12.00">
    </head></html>`);
    expect(tryOpenGraph(doc)?.currency).toBe('USD');
  });

  test('returns null when no OG price tag', () => {
    const doc = parseDoc('<html><head></head></html>');
    expect(tryOpenGraph(doc)).toBeNull();
  });
});

describe('Strategy 4 — heuristic selectors', () => {
  test('matches [itemprop="price"] with content attribute', () => {
    const doc = parseDoc('<html><body><span itemprop="price" content="24.99">$24.99</span></body></html>');
    const result = trySelector(doc, '[itemprop="price"]');
    expect(result?.price).toBe(2499);
  });

  test('matches Amazon .a-price .a-offscreen', () => {
    const doc = parseDoc(`<html><body>
      <span class="a-price"><span class="a-offscreen">$129.99</span></span>
    </body></html>`);
    const result = trySelector(doc, '.a-price .a-offscreen');
    expect(result?.price).toBe(12999);
  });
});

describe('Strategy 5 — stock detection', () => {
  test('add-to-cart button present → in_stock', () => {
    const doc = parseDoc('<html><body><button id="add-to-cart-button">Add to cart</button></body></html>');
    expect(detectStock(doc)).toBe(STOCK_STATUS.IN_STOCK);
  });

  test('disabled add-to-cart → out_of_stock', () => {
    const doc = parseDoc('<html><body><button id="add-to-cart-button" disabled>Out of stock</button></body></html>');
    expect(detectStock(doc)).toBe(STOCK_STATUS.OUT_OF_STOCK);
  });

  test('itemprop availability InStock', () => {
    const doc = parseDoc('<html><body><link itemprop="availability" href="https://schema.org/InStock"></body></html>');
    expect(detectStock(doc)).toBe(STOCK_STATUS.IN_STOCK);
  });

  test('itemprop availability OutOfStock', () => {
    const doc = parseDoc('<html><body><link itemprop="availability" href="https://schema.org/OutOfStock"></body></html>');
    expect(detectStock(doc)).toBe(STOCK_STATUS.OUT_OF_STOCK);
  });

  test('no signals → unknown', () => {
    const doc = parseDoc('<html><body><p>some content</p></body></html>');
    expect(detectStock(doc)).toBe(STOCK_STATUS.UNKNOWN);
  });
});
