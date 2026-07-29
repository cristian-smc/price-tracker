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

export async function maybeNotify(product, previousPrice, previousInStock = null) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return null;
  if (product.notificationEnabled === false) return null;

  const event = detectEvent(product, previousPrice, previousInStock);
  if (!event) return null;

  const now = Date.now();

  // Back-in-stock bypasses the cooldown — it's a one-shot edge trigger
  if (event !== 'back_in_stock') {
    const cooldownMs = product.intervalMinutes * NOTIFY_COOLDOWN_MULTIPLIER * 60 * 1000;
    if (product.lastNotified && (now - product.lastNotified) < cooldownMs) return null;
  }

  const { title, message } = buildMessage(event, product);
  // Product IDs may themselves contain '_' (see generateId's alphabet), so the
  // timestamp is appended after the LAST '_' and parsed back with lastIndexOf.
  const notifId = `price_${product.id}_${now}`;
  const hostname = hostnameFromUrl(product.canonicalUrl ?? product.url);

  await chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title,
    message,
    contextMessage: hostname,
    priority: 2,
    buttons: [{ title: 'View product' }],
  });

  if (settings.soundEnabled) playSound();
  if (settings.mobilePushUrl) await sendMobilePush(settings.mobilePushUrl, title, message, product.canonicalUrl ?? product.url, hostname);

  return notifId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectEvent(product, previousPrice, previousInStock) {
  const { currentPrice, targetPrice, sellThreshold, inStock, checkStockEnabled } = product;

  // Only process stock status if stock checking is enabled
  if (checkStockEnabled !== false) {
    // Back-in-stock: was confirmed OOS last run, now available
    if (inStock === true && previousInStock === false) return 'back_in_stock';

    // Suppress price/sell alerts when confirmed out of stock
    if (inStock === false) return null;
  }

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
  if (event === 'back_in_stock') {
    return { title: `Back in stock: ${product.name}`, message: `Now available at ${cur}` };
  }
  if (event === 'price_drop') {
    const target = formatPrice(product.targetPrice, product.currency ?? 'USD');
    return { title: `Price drop: ${product.name}`, message: `Now ${cur} — below your target of ${target}` };
  }
  const threshold = formatPrice(product.sellThreshold, product.currency ?? 'USD');
  return { title: `Sell alert: ${product.name}`, message: `Price rose to ${cur} — above your sell threshold of ${threshold}` };
}

/**
 * Extract the product ID from a notification ID built by maybeNotify().
 * Product IDs may contain '_', so this splits on the LAST '_' (the timestamp
 * separator) rather than the first, and strips the fixed 'price_' prefix.
 * @param {string} notificationId
 * @returns {string|null}
 */
export function productIdFromNotification(notificationId) {
  if (!notificationId?.startsWith('price_')) return null;
  const withoutPrefix = notificationId.slice('price_'.length);
  const lastUnderscore = withoutPrefix.lastIndexOf('_');
  if (lastUnderscore < 0) return null;
  return withoutPrefix.slice(0, lastUnderscore);
}

function hostnameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function playSound() {
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND' }).catch(() => {});
}

async function sendMobilePush(url, title, message, productUrl, hostname) {
  try {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(title);
    const base64 = btoa(String.fromCodePoint(...encoded));
    const rfc2047Title = `=?UTF-8?B?${base64}?=`;

    const headers = {
      'Title': rfc2047Title,
      'Content-Type': 'text/plain; charset=utf-8',
    };
    // ntfy: Click header makes the whole notification tap-to-open;
    // Actions adds a "View" button. Both are no-ops on generic webhooks.
    if (productUrl) {
      headers['Click']   = productUrl;
      headers['Actions'] = `view, View product, ${productUrl}, clear=true`;
    }
    const body = hostname ? `${message}\n\n${hostname}` : message;

    await fetch(url, { method: 'POST', headers, body });
  } catch {
    // network failure — push is best-effort, don't surface to user
  }
}
