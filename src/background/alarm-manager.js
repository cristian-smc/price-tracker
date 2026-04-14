/**
 * Manages per-product chrome.alarms.
 * One alarm per product, named ALARM_PREFIX + productId.
 * Alarm fires at the product's intervalMinutes cadence.
 */

import { getProducts } from '../shared/storage.js';
import { alarmName } from '../shared/utils.js';

/**
 * Ensure an alarm exists for the given product with the correct period.
 * Creates it if missing; recreates it if the period changed.
 * @param {{ id: string, intervalMinutes: number, enabled: boolean }} product
 */
export async function syncAlarm(product) {
  const name = alarmName(product.id);

  if (!product.enabled) {
    await chrome.alarms.clear(name);
    return;
  }

  const existing = await chrome.alarms.get(name);
  if (existing && existing.periodInMinutes === product.intervalMinutes) return;

  // (Re)create with correct period. delayInMinutes=1 gives the worker a moment to settle.
  await chrome.alarms.create(name, {
    delayInMinutes: 1,
    periodInMinutes: product.intervalMinutes,
  });
}

/**
 * Sync alarms for all products — call on service worker startup to re-register
 * alarms that may have been lost if Chrome cleared them (e.g. extension update).
 */
export async function syncAllAlarms() {
  const products = await getProducts();
  await Promise.all(Object.values(products).map(syncAlarm));
}

/**
 * Remove the alarm for a product (call when a product is deleted or disabled).
 * @param {string} productId
 */
export async function clearAlarm(productId) {
  await chrome.alarms.clear(alarmName(productId));
}
