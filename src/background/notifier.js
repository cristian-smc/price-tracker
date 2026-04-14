/**
 * Desktop notification dispatch.
 *
 * Fires when:
 *  - Price drop: newPrice < targetPrice AND newPrice < previousPrice
 *  - Back in stock: stock transitions out_of_stock → in_stock
 *
 * Dedup: no re-notify within intervalMinutes * NOTIFY_COOLDOWN_MULTIPLIER minutes.
 */

import { formatPrice } from '../shared/currency.js';
import { getSettings } from '../shared/storage.js';
import { NOTIFY_COOLDOWN_MULTIPLIER, STOCK_STATUS } from '../shared/constants.js';

/**
 * @param {import('../shared/types').Product} product  updated product record (after price applied)
 * @param {number|null} previousPrice  prior currentPrice (minor units)
 * @param {string} previousStock
 */
export async function maybeNotify(product, previousPrice, previousStock) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  const now = Date.now();
  const cooldownMs = product.intervalMinutes * NOTIFY_COOLDOWN_MULTIPLIER * 60 * 1000;
  const recentlyNotified = product.lastNotified && (now - product.lastNotified) < cooldownMs;
  if (recentlyNotified) return;

  const priceDrop = (
    product.currentPrice !== null &&
    product.targetPrice !== null &&
    product.currentPrice < product.targetPrice
  );

  const backInStock = (
    previousStock === STOCK_STATUS.OUT_OF_STOCK &&
    product.currentStock === STOCK_STATUS.IN_STOCK
  );

  if (!priceDrop && !backInStock) return;

  let title, message;
  if (priceDrop) {
    const formattedPrice = formatPrice(product.currentPrice, product.currency ?? 'USD');
    const formattedTarget = formatPrice(product.targetPrice, product.currency ?? 'USD');
    title = `Price drop: ${product.name}`;
    message = `Now ${formattedPrice} — below your target of ${formattedTarget}`;
  } else {
    title = `Back in stock: ${product.name}`;
    message = `The item is available again.`;
  }

  const notifId = `price_${product.id}_${now}`;
  await chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title,
    message,
    priority: 2,
  });

  return notifId;
}
