/**
 * Orchestrates a full price-check cycle for a single product.
 *
 * Steps:
 *  1. Load product record
 *  2. Fetch + extract price/stock
 *  3. Detect selector drift (3 consecutive nulls → clear stored selector)
 *  4. Update product record
 *  5. Append history
 *  6. Maybe fire notification
 *  7. Persist updated product
 */

import { getProduct, saveProduct } from '../shared/storage.js';
import { fetchAndExtract } from './fetcher.js';
import { tabFetchAndExtract } from './tab-fetcher.js';
import { recordObservation } from './history-manager.js';
import { maybeNotify } from './notifier.js';
import { DRIFT_STRIKE_LIMIT, STOCK_STATUS } from '../shared/constants.js';

/**
 * Run a full price-check cycle for the given product ID.
 * @param {string} productId
 */
export async function checkProduct(productId) {
  const product = await getProduct(productId);
  if (!product || !product.enabled) return;

  const previousPrice = product.currentPrice;
  const previousStock = product.currentStock ?? STOCK_STATUS.UNKNOWN;

  // Choose fetch strategy
  let result;
  if (product.requiresTabExtraction) {
    result = await tabFetchAndExtract(product);
  } else {
    result = await fetchAndExtract(product);
    // If raw fetch signals SPA, flip the flag and retry with tab strategy
    if (result.requiresTabExtraction) {
      const updated = { ...product, requiresTabExtraction: true };
      await saveProduct(updated);
      result = await tabFetchAndExtract(updated);
    }
  }

  // ── Error handling ────────────────────────────────────────────────────────
  if (result.error) {
    const consecutiveErrors = (product.consecutiveErrors ?? 0) + 1;
    await saveProduct({ ...product, consecutiveErrors, lastChecked: Date.now() });
    return;
  }

  // ── Selector drift detection ──────────────────────────────────────────────
  let selectors = { ...product.selectors };
  let consecutiveNulls = product.consecutiveNulls ?? 0;

  if (result.price === null) {
    consecutiveNulls += 1;
    if (consecutiveNulls >= DRIFT_STRIKE_LIMIT) {
      // Clear user-defined selector so auto-detection runs again next cycle
      selectors = { price: null, stock: null };
      consecutiveNulls = 0;
    }
  } else {
    consecutiveNulls = 0;
    // If the offscreen discovered a reliable selector, persist it for next time
    if (result.selectorUsed && result.strategy === 4 && !selectors.price) {
      selectors.price = result.selectorUsed;
    }
  }

  // ── Update product record ─────────────────────────────────────────────────
  const updatedProduct = {
    ...product,
    currentPrice: result.price ?? product.currentPrice,
    currentStock: result.stock ?? product.currentStock,
    currency: result.currency ?? product.currency,
    lastChecked: Date.now(),
    consecutiveErrors: 0,
    consecutiveNulls,
    selectors,
    requiresTabExtraction: result.requiresTabExtraction ?? product.requiresTabExtraction,
  };

  // ── History ───────────────────────────────────────────────────────────────
  if (result.price !== null) {
    await recordObservation(productId, { price: result.price, stock: result.stock });
  }

  // ── Notification ──────────────────────────────────────────────────────────
  const notifId = await maybeNotify(updatedProduct, previousPrice, previousStock);
  if (notifId) {
    updatedProduct.lastNotified = Date.now();
  }

  await saveProduct(updatedProduct);
}
