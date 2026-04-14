/**
 * Daily digest notification — summarises price changes since last digest.
 */

import { getProducts, getSettings } from '../shared/storage.js';
import { formatPrice } from '../shared/currency.js';
import { ALARM_DIGEST, STORAGE_KEYS } from '../shared/constants.js';

/** Schedule (or reschedule) the daily digest alarm based on current settings. */
export async function syncDigestAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM_DIGEST);

  if (!settings.dailyDigestEnabled) return;

  const now = new Date();
  const next = new Date();
  next.setHours(settings.dailyDigestHour ?? 9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delayMs = next.getTime() - now.getTime();
  await chrome.alarms.create(ALARM_DIGEST, {
    delayInMinutes: delayMs / 60_000,
    periodInMinutes: 24 * 60,
  });
}

/** Fire the daily digest notification. */
export async function fireDigest() {
  const settings = await getSettings();
  if (!settings.notificationsEnabled || !settings.dailyDigestEnabled) return;

  const products = await getProducts();
  const lastTs = await getLastDigestTs();
  const entries = Object.values(products).filter((p) => p.enabled);

  const drops   = entries.filter((p) => p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice);
  const errors  = entries.filter((p) => p.consecutiveErrors >= 3);
  const oos     = entries.filter((p) => p.currentStock === 'out_of_stock');

  if (drops.length === 0 && errors.length === 0) return;

  const lines = [];
  if (drops.length > 0) {
    lines.push(`${drops.length} product${drops.length > 1 ? 's' : ''} below target:`);
    for (const p of drops.slice(0, 3)) {
      lines.push(`  • ${p.name} — ${formatPrice(p.currentPrice, p.currency)}`);
    }
    if (drops.length > 3) lines.push(`  … and ${drops.length - 3} more`);
  }
  if (errors.length > 0) {
    lines.push(`${errors.length} product${errors.length > 1 ? 's' : ''} with fetch errors`);
  }

  await chrome.notifications.create(`digest_${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: 'PriceWatch Daily Digest',
    message: lines.join('\n'),
    priority: 1,
  });

  await setLastDigestTs(Date.now());
}

async function getLastDigestTs() {
  const r = await chrome.storage.local.get(STORAGE_KEYS.DIGEST_LAST);
  return r[STORAGE_KEYS.DIGEST_LAST] ?? 0;
}

async function setLastDigestTs(ts) {
  await chrome.storage.local.set({ [STORAGE_KEYS.DIGEST_LAST]: ts });
}
