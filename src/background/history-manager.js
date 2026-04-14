/**
 * Thin orchestration layer over storage.appendHistory.
 * Centralises the "should we record this point?" logic.
 */

import { appendHistory, getSettings } from '../shared/storage.js';
import { STOCK_STATUS } from '../shared/constants.js';

/**
 * Record a price + stock observation for a product.
 * Always records — deduplication/pruning happens inside storage.appendHistory.
 *
 * @param {string} productId
 * @param {{ price: number|null, stock: string }} observation
 */
export async function recordObservation(productId, observation) {
  const settings = await getSettings();
  await appendHistory(productId, {
    price: observation.price ?? 0,
    stock: observation.stock ?? STOCK_STATUS.UNKNOWN,
  }, settings.historyMaxPoints);
}
