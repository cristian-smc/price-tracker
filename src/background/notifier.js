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
import { NOTIFY_COOLDOWN_MULTIPLIER } from '../shared/constants.js';

export async function maybeNotify(product, previousPrice) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return null;
  if (product.notificationEnabled === false) return null;

  const now = Date.now();
  const cooldownMs = product.intervalMinutes * NOTIFY_COOLDOWN_MULTIPLIER * 60 * 1000;
  if (product.lastNotified && (now - product.lastNotified) < cooldownMs) return null;

  const event = detectEvent(product, previousPrice);
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
  if (settings.mobilePushUrl) sendMobilePush(settings.mobilePushUrl, title, message);

  return notifId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectEvent(product, previousPrice) {
  const { currentPrice, targetPrice, sellThreshold } = product;

  if (currentPrice !== null && targetPrice !== null && currentPrice < targetPrice) {
    return 'price_drop';
  }
  if (currentPrice !== null && sellThreshold !== null && currentPrice > sellThreshold &&
      (previousPrice === null || previousPrice <= sellThreshold)) {
    return 'sell_alert';
  }
  return null;
}

function buildMessage(event, product) {
  const cur = formatPrice(product.currentPrice, product.currency ?? 'USD');
  if (event === 'price_drop') {
    const target = formatPrice(product.targetPrice, product.currency ?? 'USD');
    return { title: `Price drop: ${product.name}`, message: `Now ${cur} — below your target of ${target}` };
  }
  const threshold = formatPrice(product.sellThreshold, product.currency ?? 'USD');
  return { title: `Sell alert: ${product.name}`, message: `Price rose to ${cur} — above your sell threshold of ${threshold}` };
}

function playSound() {
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND' }).catch(() => {});
}

function sendMobilePush(url, title, message) {
  fetch(url, {
    method: 'POST',
    headers: { 'Title': title, 'Content-Type': 'text/plain' },
    body: message,
  }).catch(() => {}); // fire-and-forget
}
