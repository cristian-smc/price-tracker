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
 * Create a warning badge for selector drift or consecutive errors.
 * @param {'drift'|'error'} type
 * @param {number} count
 * @returns {HTMLElement}
 */
export function createWarningBadge(type, count) {
  const span = document.createElement('span');
  const plural = count === 1 ? '' : 's';
  span.className = `badge ${type}`;
  span.title = type === 'drift'
    ? 'Price selector may have changed — will auto-detect next check'
    : `${count} consecutive fetch error${plural}`;
  span.textContent = type === 'drift' ? '⚠ Selector drift' : `⚠ ${count} error${plural}`;
  return span;
}
