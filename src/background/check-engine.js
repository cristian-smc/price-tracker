/**
 * Orchestrates a full price-check cycle for a single product.
 *
 * Multi-source support: a product can have multiple source URLs.
 * All sources are checked on each alarm; the best price (lowest) wins.
 * Legacy products (no sources array) are migrated lazily on first check.
 */

import { getProduct, saveProduct } from '../shared/storage.js';
import { fetchAndExtract } from './fetcher.js';
import { tabFetchAndExtract } from './tab-fetcher.js';
import { recordObservation } from './history-manager.js';
import { maybeNotify } from './notifier.js';
import { updateBadge } from './badge-manager.js';
import { generateId } from '../shared/utils.js';
import { DRIFT_STRIKE_LIMIT, AUTO_DISABLE_ERROR_LIMIT } from '../shared/constants.js';

export async function checkProduct(productId) {
  let product = await getProduct(productId);
  if (product?.enabled !== true) return;

  // Lazy migration: wrap single URL into sources array
  product = ensureSources(product);

  const previousPrice = product.currentPrice;

  // Check every source
  const updatedSources = [];
  let anySucceeded = false;
  for (const source of product.sources) {
    const updated = await checkOneSource(source);
    updatedSources.push(updated);
    if (updated.consecutiveErrors === 0) anySucceeded = true;
  }

  if (!anySucceeded) {
    const consecutiveErrors = (product.consecutiveErrors ?? 0) + 1;
    await saveProduct({
      ...product,
      sources: updatedSources,
      consecutiveErrors,
      enabled: consecutiveErrors >= AUTO_DISABLE_ERROR_LIMIT ? false : product.enabled,
      lastChecked: Date.now(),
    });
    await updateBadge();
    return;
  }

  const bestSource = pickBestSource(updatedSources);
  const newPrice = bestSource?.currentPrice ?? product.currentPrice;
  const priceFields = computePriceFields(product, newPrice);

  const updatedProduct = {
    ...product,
    sources: updatedSources,
    bestSourceId: bestSource?.id ?? null,
    url: updatedSources[0]?.url ?? product.url,
    canonicalUrl: bestSource?.canonicalUrl ?? product.canonicalUrl,
    currentPrice: newPrice,
    currency: bestSource?.currency ?? product.currency,
    thumbnail: bestSource?.thumbnail ?? product.thumbnail,
    lastChecked: Date.now(),
    consecutiveErrors: 0,
    consecutiveNulls: 0,
    ...priceFields,
  };

  await maybeRecord(productId, updatedProduct.currentPrice);
  const notifId = await maybeNotify(updatedProduct, previousPrice);
  if (notifId) updatedProduct.lastNotified = Date.now();

  await saveProduct(updatedProduct);
  await updateBadge();
}

// ── Source migration ──────────────────────────────────────────────────────────

/**
 * Wraps a legacy product (no sources) into the multi-source shape.
 * Exported for use in service-worker ADD_SOURCE handler.
 * @param {import('../shared/types').Product} product
 */
export function ensureSources(product) {
  if (product.sources?.length) return product;
  const source = {
    id: generateId(),
    url: product.url,
    canonicalUrl: product.canonicalUrl ?? null,
    label: hostnameOf(product.url),
    selectors: { price: product.selectors?.price ?? null },
    requiresTabExtraction: product.requiresTabExtraction ?? false,
    currentPrice: product.currentPrice,
    currency: product.currency ?? null,
    thumbnail: product.thumbnail ?? null,
    lastChecked: product.lastChecked ?? null,
    consecutiveErrors: product.consecutiveErrors ?? 0,
    consecutiveNulls: product.consecutiveNulls ?? 0,
  };
  return { ...product, sources: [source], bestSourceId: source.id };
}

// ── Per-source check ──────────────────────────────────────────────────────────

async function checkOneSource(source) {
  const target = {
    url: source.url,
    canonicalUrl: source.canonicalUrl,
    selectors: source.selectors ?? { price: null },
    requiresTabExtraction: source.requiresTabExtraction ?? false,
    // True only on the first attempt when we've never extracted a price — used by
    // doFetch to trigger a one-shot tab discovery for dynamic sites (e.g. Google
    // Flights) whose raw HTML fetch won't contain prices regardless of SPA detection.
    neverExtracted: source.currentPrice == null && (source.consecutiveNulls ?? 0) === 0,
  };

  const result = await doFetch(target);

  if (result.error) {
    return {
      ...source,
      consecutiveErrors: (source.consecutiveErrors ?? 0) + 1,
      lastChecked: Date.now(),
    };
  }

  const { selectors, consecutiveNulls } = resolveSelectorsForSource(source, result);

  return {
    ...source,
    canonicalUrl: result.canonicalUrl ?? source.canonicalUrl,
    selectors,
    requiresTabExtraction: result.requiresTabExtraction ?? source.requiresTabExtraction,
    currentPrice: result.price ?? source.currentPrice,
    currency: result.currency ?? source.currency,
    thumbnail: result.thumbnail ?? source.thumbnail,
    lastChecked: Date.now(),
    consecutiveErrors: 0,
    consecutiveNulls,
  };
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function doFetch(target) {
  // Always attempt the cheap HTTP path first — even when requiresTabExtraction is
  // stored on the source. This auto-clears stale flags (set by old discovery logic)
  // for server-rendered sites, and avoids opening a tab unless truly necessary.
  // Pass requiresTabExtraction:false so fetchAndExtract doesn't short-circuit.
  const result = await fetchAndExtract({ ...target, requiresTabExtraction: false });

  // HTTP found a price — done, no tab needed. Return with flag cleared.
  if (result.price !== null) {
    return { ...result, requiresTabExtraction: false };
  }

  // Open a tab only when the response proves a real browser is required:
  // • fetchAndExtract detected an SPA shell (looksLikeSpa), or
  // • HTTP errored on a source already confirmed to need a browser.
  if (result.requiresTabExtraction || (result.error && target.requiresTabExtraction)) {
    return tabFetchAndExtract({ ...target, requiresTabExtraction: true });
  }

  return result;
}

// ── Selector drift ────────────────────────────────────────────────────────────

function resolveSelectorsForSource(source, result) {
  let selectors = { ...source.selectors };
  let consecutiveNulls = source.consecutiveNulls ?? 0;

  if (result.price === null) {
    consecutiveNulls += 1;
    if (consecutiveNulls >= DRIFT_STRIKE_LIMIT) {
      selectors = { price: null };
      consecutiveNulls = 0;
    }
  } else {
    consecutiveNulls = 0;
    if (result.selectorUsed && result.strategy === 4 && selectors.price == null) {
      selectors.price = result.selectorUsed;
    }
  }
  return { selectors, consecutiveNulls };
}

// ── Best source selection ─────────────────────────────────────────────────────

function pickBestSource(sources) {
  const withPrice = sources.filter((s) => s.currentPrice != null && s.consecutiveErrors === 0);
  if (withPrice.length > 0) {
    return withPrice.reduce((best, s) => s.currentPrice < best.currentPrice ? s : best);
  }
  return sources[0] ?? null;
}

// ── Price stats ───────────────────────────────────────────────────────────────

function computePriceFields(product, newPrice) {
  const initialPrice = product.initialPrice ?? newPrice;
  const lowestPrice  = newPrice == null ? product.lowestPrice  : Math.min(newPrice, product.lowestPrice  ?? newPrice);
  const highestPrice = newPrice == null ? product.highestPrice : Math.max(newPrice, product.highestPrice ?? newPrice);
  return { initialPrice, lowestPrice, highestPrice };
}

// ── History recording ─────────────────────────────────────────────────────────

async function maybeRecord(productId, newPrice) {
  if (newPrice == null) return;
  await recordObservation(productId, { price: newPrice });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}
