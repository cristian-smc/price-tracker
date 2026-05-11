/**
 * Price string parser.
 * Always returns { value: number (integer minor units), currency: string } or null.
 *
 * Handles:
 *  - $1,299.99  →  { value: 129999, currency: 'USD' }
 *  - € 1.299,99 →  { value: 129999, currency: 'EUR' }  (comma-as-decimal)
 *  - 1 299,99 zł → { value: 129999, currency: 'PLN' }  (space thousands)
 *  - JPY 15000  →  { value: 15000,  currency: 'JPY' }  (zero-decimal)
 *  - from $29.99 / Sale $89.99 → strip leading/trailing words
 *  - $29.99 – $49.99 (range) → lower value
 *  - <del>$99</del> <ins>$79</ins> (was/now markup) → <ins> value
 */

// ISO 4217 zero-decimal currencies (value is already in major units = minor units)
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

// Symbol → ISO 4217 code
const SYMBOL_MAP = {
  '$': 'USD',
  'US$': 'USD',
  'USD': 'USD',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
  '¥': 'JPY',
  'JPY': 'JPY',
  '￥': 'JPY',
  'CN¥': 'CNY',
  'CNY': 'CNY',
  '₩': 'KRW',
  'KRW': 'KRW',
  'A$': 'AUD',
  'AUD': 'AUD',
  'C$': 'CAD',
  'CAD': 'CAD',
  'CHF': 'CHF',
  'Fr.': 'CHF',
  'zł': 'PLN',
  'PLN': 'PLN',
  'Kč': 'CZK',
  'CZK': 'CZK',
  'Ft': 'HUF',
  'HUF': 'HUF',
  '₹': 'INR',
  'INR': 'INR',
  'R$': 'BRL',
  'BRL': 'BRL',
  'MXN': 'MXN',
  'MX$': 'MXN',
  'SEK': 'SEK',
  'kr': 'SEK',   // ambiguous; SEK is most common in e-commerce
  'NOK': 'NOK',
  'DKK': 'DKK',
  'NZD': 'NZD',
  'NZ$': 'NZD',
  'SGD': 'SGD',
  'S$': 'SGD',
  'HKD': 'HKD',
  'HK$': 'HKD',
  'TWD': 'TWD',
  'NT$': 'TWD',
  '₺': 'TRY',
  'TRY': 'TRY',
  '₽': 'RUB',
  'RUB': 'RUB',
  '₴': 'UAH',
  'UAH': 'UAH',
  '₪': 'ILS',
  'ILS': 'ILS',
  'RON': 'RON',
  'Lei': 'RON',
  'lei': 'RON',
  'AED': 'AED',
  'SAR': 'SAR',
  '﷼': 'SAR',
  'THB': 'THB',
  '฿': 'THB',
  'MYR': 'MYR',
  'RM': 'MYR',
  'IDR': 'IDR',
  'Rp': 'IDR',
  'PHP': 'PHP',
  '₱': 'PHP',
};

// Build a sorted (longest-first) list of known symbols for greedy matching
const KNOWN_SYMBOLS = Object.keys(SYMBOL_MAP).sort((a, b) => b.length - a.length);

/**
 * Strip HTML tags and decode entities from a string (plain-text pre-processing).
 * The offscreen parser handles real DOM; this handles strings already extracted.
 * @param {string} str
 * @returns {string}
 */
function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&');
}

/**
 * Given raw text from a was/now pattern, prefer the <ins> content.
 * Returns the string to parse, unchanged if no <ins> found.
 * @param {string} raw
 * @returns {string}
 */
function extractNowPrice(raw) {
  const insMatch = /<ins[^>]*>([\s\S]*?)<\/ins>/i.exec(raw);
  return insMatch ? insMatch[1] : raw;
}

/**
 * Detect whether this string uses comma-as-decimal (European) formatting.
 * Rule: last separator (., or ,) with exactly 2 digits after = decimal point.
 * @param {string} s cleaned numeric string with separators
 * @returns {'dot'|'comma'}
 */
function detectDecimalSeparator(s) {
  // Find all separator positions
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  const afterDot = lastDot >= 0 ? s.length - lastDot - 1 : -1;
  const afterComma = lastComma >= 0 ? s.length - lastComma - 1 : -1;

  // Separator is decimal unless exactly 3 digits follow it (thousands pattern)
  if (lastDot > lastComma) {
    // dot is last separator
    if (afterDot !== 3) return 'dot';
    return 'comma'; // dot is thousands separator (e.g. 1.299,99)
  }
  if (lastComma > lastDot) {
    // comma is last separator
    if (afterComma !== 3) return 'comma';
    return 'dot';
  }
  // no separator at all → no decimal
  return 'dot';
}

/**
 * Convert a cleaned numeric string + currency code → integer minor units.
 * @param {string} numStr e.g. "1,299.99" or "1.299,99"
 * @param {string} currency ISO 4217
 * @returns {number|null}
 */
function toMinorUnits(numStr, currency) {
  const isZeroDecimal = ZERO_DECIMAL.has(currency);

  // Remove spaces (thousands separator variant: "1 299,99")
  const cleaned = numStr.replaceAll(/\s/g, '');

  if (!cleaned || !/\d/.test(cleaned)) return null;

  const sep = detectDecimalSeparator(cleaned);

  let normalized;
  if (sep === 'dot') {
    // dots are decimal OR thousands — remove commas (thousands), keep dot (decimal)
    normalized = cleaned.replaceAll(',', '');
  } else {
    // commas are decimal — remove dots (thousands), replace comma with dot
    normalized = cleaned.replaceAll('.', '').replace(',', '.');
  }

  const float = Number.parseFloat(normalized);
  if (Number.isNaN(float)) return null;

  if (isZeroDecimal) {
    return Math.round(float);
  }
  return Math.round(float * 100);
}

/**
 * Detect currency symbol/code in a string. Returns { currency, remainder }.
 * @param {string} s
 * @returns {{ currency: string, remainder: string }}
 */
function extractCurrency(s) {
  for (const sym of KNOWN_SYMBOLS) {
    const idx = s.indexOf(sym);
    if (idx >= 0) {
      const remainder = (s.slice(0, idx) + s.slice(idx + sym.length)).trim();
      return { currency: SYMBOL_MAP[sym], remainder };
    }
  }
  return { currency: 'USD', remainder: s }; // fallback
}

/**
 * Parse a single price string. Returns { value, currency } or null.
 * @param {string} raw
 * @returns {{ value: number, currency: string }|null}
 */
export function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Handle was/now markup (<del>/<ins>)
  let str = raw.includes('<ins') ? extractNowPrice(raw) : raw;

  // Strip any remaining HTML
  str = stripHtml(str);

  return parsePriceStr(str);
}

/** Internal: parse a clean (HTML-stripped) price string. */
function parsePriceStr(str) {
  // Handle price ranges — take lower value
  if (/\d\s*[–—]\s*\d/.test(str)) {
    const parts = str.split(/\s*[–—]\s*/);
    if (parts.length === 2) {
      const a = parsePriceStr(parts[0]);
      const b = parsePriceStr(parts[1]);
      if (a && b) return a.value <= b.value ? a : b;
      return a || b;
    }
  }

  // Strip leading non-price words ("from", "Sale", "Was:", "Only", etc.)
  str = str.replace(/^[a-z\s]+(?=[€£¥₩₹₺₽₴₪฿₱$]|\d)/i, '');
  // Strip trailing non-price words (but not currency codes like "Lei", "RON")
  str = str.replace(/(?<=\d)\s+[a-z]{4,}[a-z\s]*$/i, '');
  str = str.trim();

  const { currency, remainder } = extractCurrency(str);

  // Extract numeric portion: digits, commas, dots, spaces between digits
  const numMatch = /[\d\s,.]+/.exec(remainder);
  if (!numMatch) return null;

  const value = toMinorUnits(numMatch[0].trim(), currency);
  if (value === null || value <= 0) return null;

  return { value, currency };
}

/**
 * Format minor-unit integer back to a human-readable price string.
 * @param {number} minorUnits
 * @param {string} currency ISO 4217
 * @param {string} [locale]
 * @returns {string}
 */
export function formatPrice(minorUnits, currency, locale = 'en-US') {
  const isZeroDecimal = ZERO_DECIMAL.has(currency);
  const major = isZeroDecimal ? minorUnits : minorUnits / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(isZeroDecimal ? 0 : 2)}`;
  }
}
