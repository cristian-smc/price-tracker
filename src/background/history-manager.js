/**
 * Thin orchestration layer over storage.appendHistory.
 * Centralises the "should we record this point?" logic.
 */

import { appendHistory, getSettings } from '../shared/storage.js';

/**
 * Record a price observation for a product.
 * Always records — deduplication/pruning happens inside storage.appendHistory.
 *
 * @param {string} productId
 * @param {{ price: number|null }} observation
 */
export async function recordObservation(productId, observation) {
  const settings = await getSettings();
  await appendHistory(productId, { price: observation.price ?? 0 }, settings.historyMaxPoints);
}
