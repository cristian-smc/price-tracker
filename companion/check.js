#!/usr/bin/env node
/**
 * PriceWatch Termux Companion
 *
 * Reads pricewatch.json (exported from the extension), fetches each product URL,
 * extracts the price using the same strategies as the extension, and fires Android
 * notifications via termux-notification when a price drops below target.
 *
 * Requirements:
 *   - Node 18+
 *   - npm install  (installs cheerio)
 *   - Termux:API app installed + `pkg install termux-api` in Termux
 *
 * Files (all in the same directory as this script):
 *   pricewatch.json  — exported from PriceWatch: Options → Export for Termux
 *   state.json       — auto-created; stores last known prices between runs
 *
 * First run:
 *   pkg install nodejs
 *   npm install
 *   node check.js
 *
 * Cron setup (every 30 minutes):
 *   pkg install cronie
 *   crond
 *   crontab -e
 *   → add: *\/30 * * * * cd ~/pricewatch && node check.js >> check.log 2>&1
 *
 * Keep crond alive across reboots by adding `crond` to ~/.bashrc or using
 * Termux:Boot (install the app, then place a start script in ~/.termux/boot/).
 */

import * as cheerio from 'cheerio';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, 'pricewatch.json');
const STATE_FILE    = join(__dir, 'state.json');
const CONFIG_FILE   = join(__dir, 'config.json');

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// ── Price parser (ported from src/shared/currency.js) ────────────────────────

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const SYMBOL_MAP = {
  '$': 'USD', 'US$': 'USD', 'USD': 'USD',
  '€': 'EUR', 'EUR': 'EUR',
  '£': 'GBP', 'GBP': 'GBP',
  '¥': 'JPY', 'JPY': 'JPY', '￥': 'JPY',
  'CN¥': 'CNY', 'CNY': 'CNY',
  '₩': 'KRW', 'KRW': 'KRW',
  'A$': 'AUD', 'AUD': 'AUD',
  'C$': 'CAD', 'CAD': 'CAD',
  'CHF': 'CHF', 'Fr.': 'CHF',
  'zł': 'PLN', 'PLN': 'PLN',
  'Kč': 'CZK', 'CZK': 'CZK',
  'Ft': 'HUF', 'HUF': 'HUF',
  '₹': 'INR', 'INR': 'INR',
  'R$': 'BRL', 'BRL': 'BRL',
  'MXN': 'MXN', 'MX$': 'MXN',
  'SEK': 'SEK', 'kr': 'SEK',
  'NOK': 'NOK', 'DKK': 'DKK',
  'NZD': 'NZD', 'NZ$': 'NZD',
  'SGD': 'SGD', 'S$': 'SGD',
  'HKD': 'HKD', 'HK$': 'HKD',
  'TWD': 'TWD', 'NT$': 'TWD',
  '₺': 'TRY', 'TRY': 'TRY',
  '₽': 'RUB', 'RUB': 'RUB',
  '₴': 'UAH', 'UAH': 'UAH',
  '₪': 'ILS', 'ILS': 'ILS',
  'RON': 'RON', 'Lei': 'RON', 'lei': 'RON',
  'AED': 'AED', 'SAR': 'SAR', '﷼': 'SAR',
  'THB': 'THB', '฿': 'THB',
  'MYR': 'MYR', 'RM': 'MYR',
  'IDR': 'IDR', 'Rp': 'IDR',
  'PHP': 'PHP', '₱': 'PHP',
};

const KNOWN_SYMBOLS = Object.keys(SYMBOL_MAP).sort((a, b) => b.length - a.length);

function extractCurrency(s) {
  for (const sym of KNOWN_SYMBOLS) {
    const idx = s.indexOf(sym);
    if (idx >= 0) {
      const remainder = (s.slice(0, idx) + s.slice(idx + sym.length)).trim();
      return { currency: SYMBOL_MAP[sym], remainder };
    }
  }
  return { currency: 'USD', remainder: s };
}

function detectDecimalSeparator(s) {
  const lastDot   = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const afterDot   = lastDot   >= 0 ? s.length - lastDot   - 1 : -1;
  const afterComma = lastComma >= 0 ? s.length - lastComma - 1 : -1;
  if (lastDot > lastComma)   return afterDot   !== 3 ? 'dot'   : 'comma';
  if (lastComma > lastDot)   return afterComma !== 3 ? 'comma' : 'dot';
  return 'dot';
}

function toMinorUnits(numStr, currency) {
  const isZeroDecimal = ZERO_DECIMAL.has(currency);
  const cleaned = numStr.replace(/\s/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const sep = detectDecimalSeparator(cleaned);
  const normalized = sep === 'dot'
    ? cleaned.replace(/,/g, '')
    : cleaned.replace(/\./g, '').replace(',', '.');
  const float = parseFloat(normalized);
  if (isNaN(float)) return null;
  return isZeroDecimal ? Math.round(float) : Math.round(float * 100);
}

function parsePriceStr(str) {
  // Price range — take lower value
  if (/\d\s*[–—]\s*\d/.test(str)) {
    const parts = str.split(/\s*[–—]\s*/);
    if (parts.length === 2) {
      const a = parsePriceStr(parts[0]);
      const b = parsePriceStr(parts[1]);
      if (a && b) return a.value <= b.value ? a : b;
      return a || b;
    }
  }
  str = str.trim();

  // Detect the currency symbol/code before stripping filler words, so that a
  // leading ISO code (e.g. "EUR 19.99") isn't consumed by the filler-word strip.
  const { currency, remainder: afterCurrency } = extractCurrency(str);

  // Strip leading non-price words ("from", "Sale", "Was:", "Only", etc.)
  let remainder = afterCurrency.replace(/^[a-z\s]+(?=\d)/i, '');
  // Strip trailing non-price words (but not currency codes like "Lei", "RON")
  remainder = remainder.replace(/(?<=\d)\s+[a-z]{4,}[a-z\s]*$/i, '');
  remainder = remainder.trim();

  const numMatch = /[\d\s,.]+/.exec(remainder);
  if (!numMatch) return null;
  const value = toMinorUnits(numMatch[0].trim(), currency);
  if (value === null || value <= 0) return null;
  return { value, currency };
}

function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return parsePriceStr(str);
}

function formatPrice(minorUnits, currency) {
  const isZeroDecimal = ZERO_DECIMAL.has(currency);
  const major = isZeroDecimal ? minorUnits : minorUnits / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(isZeroDecimal ? 0 : 2)}`;
  }
}

// ── HTML price extraction (ported from src/offscreen/offscreen.js) ────────────

const HEURISTIC_SELECTORS = [
  '[itemprop="price"]',
  '[data-testid="price"]',
  '[data-testid*="price"]',
  '[data-price]',
  '.price',
  '.product-price',
  '.offer-price',
  '.sale-price',
  '[class*="price-text"]',
  '[class*="priceText"]',
  '[class*="PriceText"]',
  '[class*="price-amount"]',
  '[class*="priceAmount"]',
  '[class*="total-price"]',
  '[class*="totalPrice"]',
  // Amazon
  '.a-price .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  // eBay
  '.x-price-primary span[itemprop="price"]',
  // Best Buy
  '.priceView-hero-price span',
  // Target
  '[data-test="product-price"]',
];

function trySelectorCheerio($, selector) {
  try {
    const el = $(selector).first();
    if (!el.length) return null;
    const raw = el.attr('data-price') || el.attr('content') || el.text();
    if (!raw) return null;
    const parsed = parsePrice(raw.trim());
    if (!parsed) return null;
    return { price: parsed.value, currency: parsed.currency };
  } catch {
    return null;
  }
}

function isProductType(type) {
  if (!type) return false;
  return (Array.isArray(type) ? type.join(',') : String(type)).toLowerCase().includes('product');
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

// ── Stock extraction ───────────────────────────────────────────────────────────

/**
 * Returns true (in stock), false (out of stock), or null (unknown).
 * Tries 4 strategies in order of reliability.
 */
function extractStock(html, $) {
  // Strategy 1: JSON-LD offers.availability (schema.org)
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html());
      const schemas = Array.isArray(data) ? data : [data];
      for (const schema of schemas) {
        const avail = findJsonLdAvailability(schema);
        if (avail !== null) return avail;
      }
    } catch { /* malformed JSON-LD */ }
  }

  // Strategy 2: OpenGraph product:availability
  const ogAvail = $('meta[property="product:availability"]').attr('content');
  if (ogAvail) {
    const v = ogAvail.trim().toLowerCase().replace(/\s+/g, '');
    if (v === 'instock')    return true;
    if (v === 'outofstock') return false;
  }

  // Strategy 3: GTM dataLayer item_stock (used by bestvalue.eu and similar)
  const dlMatch = html.match(/"item_stock"\s*:\s*"([^"]+)"/);
  if (dlMatch) {
    const v = dlMatch[1].toLowerCase();
    if (v === 'in stock')    return true;
    if (v === 'out of stock') return false;
  }

  // Strategy 4: itemprop="availability"
  const itemAvail = $('[itemprop="availability"]');
  if (itemAvail.length) {
    const raw = (itemAvail.attr('content') || itemAvail.attr('href') || itemAvail.text()).toLowerCase();
    if (/instock/.test(raw))              return true;
    if (/outofstock|out.of.stock/.test(raw)) return false;
  }

  return null; // unknown — don't suppress notifications
}

function findJsonLdAvailability(schema) {
  if (schema['@graph']) {
    for (const node of schema['@graph']) {
      const r = findJsonLdAvailability(node);
      if (r !== null) return r;
    }
  }
  if (!isProductType(schema['@type'])) return null;
  if (!schema.offers) return null;
  const offerList = Array.isArray(schema.offers) ? schema.offers : [schema.offers];
  for (const offer of offerList) {
    const avail = offer.availability;
    if (!avail) continue;
    const v = String(avail).toLowerCase();
    if (v.includes('instock'))    return true;
    if (v.includes('outofstock')) return false;
  }
  return null;
}

function tryJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html());
      const schemas = Array.isArray(data) ? data : [data];
      for (const schema of schemas) {
        const result = extractFromSchema(schema);
        if (result) return result;
      }
    } catch { /* malformed JSON-LD */ }
  }
  return null;
}

function tryOpenGraph($) {
  const priceEl = $('meta[property="product:price:amount"]');
  if (!priceEl.length) return null;
  const raw = priceEl.attr('content');
  if (!raw) return null;
  const currencyRaw = $('meta[property="product:price:currency"]').attr('content') ?? '';
  const parsed = parsePrice(raw.trim());
  if (!parsed) return null;
  if (currencyRaw) parsed.currency = currencyRaw.toUpperCase();
  return { price: parsed.value, currency: parsed.currency };
}

/**
 * Extract price from a pre-loaded cheerio instance.
 * Returns { price, currency, strategy } or null.
 * Mirrors the 4-strategy waterfall in offscreen.js.
 */
function extractPrice($, userSelector) {
  if (userSelector) {
    const result = trySelectorCheerio($, userSelector);
    if (result) return { ...result, strategy: 1 };
  }

  const jsonLd = tryJsonLd($);
  if (jsonLd) return { ...jsonLd, strategy: 2 };

  const og = tryOpenGraph($);
  if (og) return { ...og, strategy: 3 };

  for (const sel of HEURISTIC_SELECTORS) {
    const result = trySelectorCheerio($, sel);
    if (result) return { ...result, strategy: 4 };
  }

  return null;
}

// ── HTTP fetch with UA rotation (ported from src/background/fetcher.js) ──────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

async function fetchHtml(url) {
  let lastErr;
  for (const ua of USER_AGENTS) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (resp.status === 403 || resp.status === 429) { lastErr = new Error(`HTTP ${resp.status}`); continue; }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (err) {
      lastErr = err;
      if (err.message?.startsWith('HTTP')) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error('All User-Agents blocked');
}

// ── Android notifications ─────────────────────────────────────────────────────

function notify(notifId, title, body, openUrl) {
  let hostname = '';
  try { hostname = new URL(openUrl).hostname.replace(/^www\./, ''); } catch {}
  const content = hostname ? `${body}\n${hostname}` : body;
  try {
    execFileSync('termux-notification', [
      '--title',   `PriceWatch: ${title}`,
      '--content', content,
      '--id',      notifId,
      '--priority', 'high',
      '--button1', 'Open',
      '--button1-action', `am start -a android.intent.action.VIEW -d "${openUrl}"`,
    ], { timeout: 8000 });
  } catch {
    // termux-notification not available (desktop testing) — just print
    log(`  [NOTIFY] ${title}: ${content}`);
  }
}

// ── Config (Gist credentials) ─────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

// ── GitHub Gist download ──────────────────────────────────────────────────────

async function downloadFromGist(gistId, token) {
  const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      'Authorization':        `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'pricewatch-companion/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Gist API returned HTTP ${resp.status}`);
  const data = await resp.json();
  const file = data.files['pricewatch.json'];
  if (!file) throw new Error('pricewatch.json not found in Gist');
  return JSON.parse(file.content);
}

// ── State (last known prices) ─────────────────────────────────────────────────

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── Product list loading ──────────────────────────────────────────────────────

async function loadProducts() {
  const config = loadConfig();

  if (config.gistId && config.gistToken) {
    try {
      const exported = await downloadFromGist(config.gistId, config.gistToken);
      log(`Loaded ${exported.products?.length ?? 0} product(s) from Gist (${config.gistId.slice(0, 8)}…)`);
      writeFileSync(PRODUCTS_FILE, JSON.stringify(exported, null, 2), 'utf8');
      return exported.products ?? [];
    } catch (err) {
      log(`Gist download failed: ${err.message} — falling back to local file`);
    }
  }

  if (!existsSync(PRODUCTS_FILE)) {
    log('ERROR: pricewatch.json not found and no Gist configured.');
    log('Run setup.sh --gist-id <id> --gist-token <token>');
    log('or export manually: PriceWatch extension → Options → Export for Termux');
    process.exit(1);
  }

  try {
    const exported = JSON.parse(readFileSync(PRODUCTS_FILE, 'utf8'));
    log(`Loaded ${exported.products?.length ?? 0} product(s) from local file`);
    return exported.products ?? [];
  } catch (err) {
    log(`ERROR: Could not parse pricewatch.json — ${err.message}`);
    process.exit(1);
  }
}

// ── Per-product check ─────────────────────────────────────────────────────────

function buildNotification(product, price, currency, prev) {
  const formatted = formatPrice(price, currency);

  if (product.targetPrice != null && price <= product.targetPrice) {
    const target = formatPrice(product.targetPrice, currency);
    return `${formatted} — below your target of ${target}`;
  }

  if (product.targetPrice == null && prev.lastPrice != null && price < prev.lastPrice) {
    return `Price dropped: ${formatPrice(prev.lastPrice, currency)} → ${formatted}`;
  }

  return null;
}

async function checkOneProduct(product, state) {
  log(`  "${product.name}"`);

  let html;
  try {
    html = await fetchHtml(product.url);
  } catch (err) {
    log(`    ERROR: ${err.message}`);
    return;
  }

  const $ = cheerio.load(html);

  const result = extractPrice($, product.priceSelector ?? null);
  if (!result) { log(`    no price found`); return; }

  const { price, currency: detected, strategy } = result;
  const currency  = detected ?? product.currency ?? 'USD';
  const formatted = formatPrice(price, currency);

  const inStock  = extractStock(html, $);
  const stockTag = inStock === true ? 'in stock' : inStock === false ? 'OUT OF STOCK' : 'stock unknown';
  log(`    ${formatted}  (strategy ${strategy})  [${stockTag}]`);

  const prev = state[product.id] ?? {};
  const now  = new Date().toISOString();

  // Back-in-stock notification (was OOS last run, now available)
  if (inStock === true && prev.inStock === false) {
    notify(`${product.id}_stock`, product.name, `Back in stock! Now ${formatted}`, product.url);
    log(`    back in stock — notified!`);
  }

  // Price-drop notification — skip when confirmed out of stock
  if (inStock !== false) {
    const notifBody = buildNotification(product, price, currency, prev);
    if (notifBody) {
      const cooldownMs     = (product.intervalMinutes ?? 30) * 2 * 60 * 1000;
      const lastNotifiedAt = prev.lastNotified ? new Date(prev.lastNotified).getTime() : 0;
      if (Date.now() - lastNotifiedAt >= cooldownMs) {
        notify(product.id, product.name, notifBody, product.url);
        state[product.id] = { lastPrice: price, lastChecked: now, lastNotified: now, inStock };
        log(`    notified!`);
      } else {
        log(`    below target — cooldown active`);
        state[product.id] = { ...prev, lastPrice: price, lastChecked: now, inStock };
      }
    } else {
      state[product.id] = { ...prev, lastPrice: price, lastChecked: now, inStock };
    }
  } else {
    // Out of stock — track price/stock but don't fire price-drop notification
    state[product.id] = { ...prev, lastPrice: price, lastChecked: now, inStock };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const all      = await loadProducts();
  const products = all.filter((p) => p.enabled);

  if (products.length === 0) { log('No enabled products to check.'); return; }

  const state = loadState();
  log(`Checking ${products.length} product(s)…`);

  let belowTarget = 0;
  for (const product of products) {
    await checkOneProduct(product, state);
    const s = state[product.id];
    if (s && product.targetPrice != null && s.lastPrice != null && s.lastPrice <= product.targetPrice && s.inStock !== false) {
      belowTarget++;
    }
  }

  saveState(state);
  log(`Done. BELOW_TARGET=${belowTarget} TOTAL=${products.length}`);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
