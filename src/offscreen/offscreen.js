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
  const inStock = extractStock(doc);
  // ── Strategy 1: User-defined selector ─────────────────────────────────────
  if (userSelector) {
    const result = trySelector(doc, userSelector);
    if (result) return { ...result, strategy: 1, selectorUsed: userSelector, thumbnail, inStock };
  }

  // ── Strategy 2: JSON-LD ───────────────────────────────────────────────────
  const jsonLd = tryJsonLd(doc);
  if (jsonLd) return { ...jsonLd, strategy: 2, selectorUsed: 'json-ld', thumbnail, inStock };

  // ── Strategy 3: Open Graph ────────────────────────────────────────────────
  const og = tryOpenGraph(doc);
  if (og) return { ...og, strategy: 3, selectorUsed: 'og:price', thumbnail, inStock };

  // ── Strategy 4: Heuristic selectors ──────────────────────────────────────
  for (const sel of HEURISTIC_SELECTORS) {
    const result = trySelector(doc, sel);
    if (result) return { ...result, strategy: 4, selectorUsed: sel, thumbnail, inStock };
  }

  return { price: null, currency: null, strategy: null, selectorUsed: null, thumbnail, inStock };
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

// ── Stock extraction ──────────────────────────────────────────────────────────

/**
 * Extract in-stock status from a DOMParser document (static HTML).
 * Returns true (in stock), false (out of stock), or null (unknown).
 */
function extractStock(doc) {
  // 1. Sylius platform
  if (doc.querySelector('#sylius-product-out-of-stock'))  return false;
  if (doc.querySelector('#sylius-product-adding-to-cart')) return true;

  // 2. JSON-LD schema.org offers.availability
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const schemas = [JSON.parse(s.textContent)].flat();
      for (const sc of schemas) {
        const r = ldAvailability(sc);
        if (r !== null) return r;
      }
    } catch { /* malformed — skip */ }
  }

  // 3. OpenGraph product:availability
  const ogRaw = (doc.querySelector('meta[property="product:availability"]')?.getAttribute('content') ?? '').toLowerCase().replaceAll(/\s+/g, '');
  if (ogRaw === 'instock')                       return true;
  if (ogRaw === 'outofstock' || ogRaw === 'oos') return false;

  // 4. itemprop="availability"
  const availEl = doc.querySelector('[itemprop="availability"]');
  if (availEl) {
    const v = (availEl.getAttribute('content') || availEl.getAttribute('href') || availEl.textContent).toLowerCase();
    if (/instock/.test(v))                         return true;
    if (/outofstock|out[\s-]of[\s-]stock/.test(v)) return false;
  }

  // 5. Common e-commerce class / attribute patterns
  if (doc.querySelector('.stock.out-of-stock, [data-stock="outofstock"], [data-availability="out-of-stock"], [data-available="false"]')) return false;
  if (doc.querySelector('.stock.in-stock,     [data-stock="instock"],    [data-availability="in-stock"],    [data-available="true"]'))  return true;

  // 6. textContent scan — static HTML, so we read from <body>
  const bodyText = (doc.body?.textContent ?? '').toLowerCase();
  const OOS = ['out of stock', 'sold out', 'nu este in stoc', 'nu este \u00een stoc', 'stoc epuizat', 'indisponibil', 'nicht auf lager', 'fuori stock', 'sin stock'];
  const INS = ['add to cart', 'add to basket', 'adauga in cos', 'adaug\u0103 \u00een co\u0219', 'buy now'];
  for (const p of OOS) { if (bodyText.includes(p)) return false; }
  for (const p of INS) { if (bodyText.includes(p)) return true; }

  return null;
}

function ldAvailability(schema) {
  if (schema['@graph']) {
    for (const n of schema['@graph']) { const r = ldAvailability(n); if (r !== null) return r; }
  }
  const t = [schema['@type'] ?? []].flat().join(',').toLowerCase();
  if (!t.includes('product')) return null;
  for (const offer of [schema.offers ?? []].flat()) {
    const v = String(offer.availability ?? '').toLowerCase();
    if (v.includes('instock'))    return true;
    if (v.includes('outofstock')) return false;
  }
  return null;
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

    // parsePrice defaults to USD when no symbol is found in `raw`. On sites
    // like emag.ro the value lives in a data-price/content attribute while
    // the currency ("Lei") is in a sibling element — so `raw` has no token.
    // Consult the document before accepting the USD fallback.
    if (!hasCurrencyToken(raw)) {
      const hint = currencyHintFromDoc(doc, el);
      if (hint) parsed.currency = hint;
    }

    return { price: parsed.value, currency: parsed.currency };
  } catch {
    return null;
  }
}

const CURRENCY_TOKEN_RE = /[€£¥₩₹₺₽₴₪฿₱$]|\b(USD|EUR|GBP|JPY|KRW|RON|PLN|HUF|CZK|SEK|NOK|DKK|CHF|CNY|INR|BRL|MXN|NZD|SGD|HKD|TWD|TRY|RUB|UAH|ILS|AED|SAR|THB|MYR|IDR|PHP|AUD|CAD)\b|\blei\b|zł|Kč|\bFt\b|Rp|\bRM\b/i;

function hasCurrencyToken(s) {
  return typeof s === 'string' && CURRENCY_TOKEN_RE.test(s);
}

/**
 * Best-effort currency lookup for a price element whose raw value had no
 * currency token. Scans, in priority order: itemprop="priceCurrency",
 * og:price:currency meta, ancestor data-currency, element textContent,
 * ancestor textContent, full body textContent.
 */
function currencyHintFromDoc(doc, priceEl) {
  const curEl = doc.querySelector('[itemprop="priceCurrency"]');
  if (curEl) {
    const v = (curEl.getAttribute('content') || curEl.textContent || '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(v)) return v;
  }
  const og = doc.querySelector('meta[property="product:price:currency"]')?.getAttribute('content');
  if (og && /^[A-Za-z]{3}$/.test(og.trim())) return og.trim().toUpperCase();

  let n = priceEl;
  for (let i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
    const dc = n.getAttribute?.('data-currency');
    if (dc && /^[A-Za-z]{3}$/.test(dc.trim())) return dc.trim().toUpperCase();
  }

  const elText = tokenScan(priceEl.textContent);
  if (elText) return elText;

  let anc = priceEl.parentElement;
  for (let i = 0; anc && i < 4; anc = anc.parentElement, i++) {
    const hit = tokenScan(anc.textContent);
    if (hit) return hit;
  }

  return tokenScan(doc.body?.textContent);
}

function tokenScan(s) {
  if (!s) return null;
  if (/\blei\b|\bRON\b/i.test(s)) return 'RON';
  if (/€|\bEUR\b/.test(s))         return 'EUR';
  if (/£|\bGBP\b/.test(s))         return 'GBP';
  if (/¥|\bJPY\b/.test(s))         return 'JPY';
  if (/₩|\bKRW\b/.test(s))         return 'KRW';
  if (/zł|\bPLN\b/i.test(s))       return 'PLN';
  if (/\bFt\b|\bHUF\b/.test(s))    return 'HUF';
  if (/\bCHF\b/.test(s))           return 'CHF';
  if (/Kč|\bCZK\b/i.test(s))       return 'CZK';
  if (/₽|\bRUB\b/i.test(s))        return 'RUB';
  if (/\$|\bUSD\b/.test(s))        return 'USD';
  return null;
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
