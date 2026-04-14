/**
 * Currency display helpers for the popup.
 * Wraps formatPrice from shared/currency.js with DOM helpers.
 */

import { formatPrice } from '../../shared/currency.js';

/**
 * Returns a formatted price string.
 * @param {number|null} minorUnits
 * @param {string} currency
 * @returns {string}
 */
export function displayPrice(minorUnits, currency) {
  if (minorUnits == null) return '—';
  return formatPrice(minorUnits, currency ?? 'USD');
}

/**
 * Create a stock badge element.
 * @param {string} stock  STOCK_STATUS.*
 * @returns {HTMLElement}
 */
export function createStockBadge(stock) {
  const span = document.createElement('span');
  span.className = 'badge';
  if (stock === 'in_stock') {
    span.classList.add('in-stock');
    span.textContent = 'In stock';
  } else if (stock === 'out_of_stock') {
    span.classList.add('out-of-stock');
    span.textContent = 'Out of stock';
  } else {
    span.classList.add('unknown');
    span.textContent = 'Unknown';
  }
  return span;
}

/**
 * Create a warning badge for selector drift or consecutive errors.
 * @param {'drift'|'error'} type
 * @param {number} count
 * @returns {HTMLElement}
 */
export function createWarningBadge(type, count) {
  const span = document.createElement('span');
  span.className = `badge ${type}`;
  span.title = type === 'drift'
    ? 'Price selector may have changed — will auto-detect next check'
    : `${count} consecutive fetch error${count !== 1 ? 's' : ''}`;
  span.textContent = type === 'drift' ? '⚠ Selector drift' : `⚠ ${count} error${count !== 1 ? 's' : ''}`;
  return span;
}
