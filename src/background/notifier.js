/**
 * Desktop notification dispatch.
 *
 * New in v2:
 *  - Per-product notificationEnabled flag
 *  - Sell-threshold alerts (price rises above sellThreshold)
 *  - Notification sound via offscreen Web Audio API
 */

import { formatPrice } from '../shared/currency.js';
import { getSettings } from '../shared/storage.js';
import { NOTIFY_COOLDOWN_MULTIPLIER, STOCK_STATUS } from '../shared/constants.js';

export async function maybeNotify(product, previousPrice, previousStock) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return null;
  if (product.notificationEnabled === false) return null;

  const now = Date.now();
  const cooldownMs = product.intervalMinutes * NOTIFY_COOLDOWN_MULTIPLIER * 60 * 1000;
  if (product.lastNotified && (now - product.lastNotified) < cooldownMs) return null;

  const event = detectEvent(product, previousPrice, previousStock);
  if (!event) return null;

  const { title, message } = buildMessage(event, product);
  const notifId = `price_${product.id}_${now}`;

  await chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title,
    message,
    priority: 2,
  });

  if (settings.soundEnabled) playSound();

  return notifId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectEvent(product, previousPrice, previousStock) {
  const { currentPrice, targetPrice, sellThreshold, currentStock } = product;

  if (currentPrice !== null && targetPrice !== null && currentPrice < targetPrice) {
    return 'price_drop';
  }
  if (currentPrice !== null && sellThreshold !== null && currentPrice > sellThreshold &&
      (previousPrice === null || previousPrice <= sellThreshold)) {
    return 'sell_alert';
  }
  if (previousStock === STOCK_STATUS.OUT_OF_STOCK && currentStock === STOCK_STATUS.IN_STOCK) {
    return 'back_in_stock';
  }
  return null;
}

function buildMessage(event, product) {
  const cur = formatPrice(product.currentPrice, product.currency ?? 'USD');
  if (event === 'price_drop') {
    const target = formatPrice(product.targetPrice, product.currency ?? 'USD');
    return { title: `Price drop: ${product.name}`, message: `Now ${cur} — below your target of ${target}` };
  }
  if (event === 'sell_alert') {
    const threshold = formatPrice(product.sellThreshold, product.currency ?? 'USD');
    return { title: `Sell alert: ${product.name}`, message: `Price rose to ${cur} — above your sell threshold of ${threshold}` };
  }
  return { title: `Back in stock: ${product.name}`, message: 'The item is available again.' };
}

function playSound() {
  // Ask the offscreen document to play a short beep via Web Audio API.
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND' }).catch(() => {});
}
