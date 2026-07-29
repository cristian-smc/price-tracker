/**
 * Integration tests for the check-engine cycle.
 * Uses manual mocks for chrome.* APIs and the fetcher.
 *
 * Run with: npx jest tests/integration/check-engine.test.js
 */

import { jest } from '@jest/globals';

// ── Chrome API mock ───────────────────────────────────────────────────────────
// Products/settings live in chrome.storage.sync, history in chrome.storage.local
// (see src/shared/storage.js) — both need their own backing store.

const syncData = {};
const localData = {};

function makeStorageArea(store) {
  return {
    get: jest.fn(async (keys) => {
      if (keys === null || keys === undefined) return { ...store };
      const result = {};
      const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      for (const k of ks) result[k] = store[k];
      return result;
    }),
    set: jest.fn(async (items) => { Object.assign(store, items); }),
    remove: jest.fn(async (keys) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete store[k];
    }),
    clear: jest.fn(async () => { for (const k of Object.keys(store)) delete store[k]; }),
  };
}

global.chrome = {
  storage: {
    sync: makeStorageArea(syncData),
    local: makeStorageArea(localData),
  },
  notifications: {
    create: jest.fn(async () => {}),
  },
  action: {
    setBadgeText: jest.fn(async () => {}),
    setBadgeBackgroundColor: jest.fn(async () => {}),
  },
  runtime: {
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: jest.fn(async () => {}),
  },
};

// ── Mock fetcher ──────────────────────────────────────────────────────────────
// Native ESM (no babel transform) doesn't hoist jest.mock() above static
// imports, so fetcher.js's real module-level `chrome.runtime.getURL()` call
// would run before the mock registers. unstable_mockModule + dynamic import
// (both after the chrome global above is set up) avoids that ordering issue.

jest.unstable_mockModule('../../src/background/fetcher.js', () => ({
  fetchAndExtract: jest.fn(),
}));
jest.unstable_mockModule('../../src/background/tab-fetcher.js', () => ({
  tabFetchAndExtract: jest.fn(),
}));

const { fetchAndExtract } = await import('../../src/background/fetcher.js');
const { checkProduct } = await import('../../src/background/check-engine.js');
const { saveProduct, getProduct, getHistory } = await import('../../src/shared/storage.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProduct(overrides = {}) {
  return {
    id: 'test-product-1',
    url: 'https://example.com/product',
    name: 'Test Widget',
    targetPrice: 5000,       // $50.00
    currency: 'USD',
    intervalMinutes: 15,
    enabled: true,
    selectors: { price: null },
    requiresTabExtraction: false,
    currentPrice: 7000,      // $70.00
    inStock: true,
    lastChecked: null,
    lastNotified: null,
    consecutiveErrors: 0,
    consecutiveNulls: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Result shape returned by fetchAndExtract()/tabFetchAndExtract() (see fetcher.js). */
function makeFetchResult(overrides = {}) {
  return {
    price: null, currency: null, strategy: null, selectorUsed: null,
    thumbnail: null, inStock: null, requiresTabExtraction: false,
    canonicalUrl: null, error: null,
    ...overrides,
  };
}

async function setSettings(patch) {
  await chrome.storage.sync.set({ settings: { notificationsEnabled: true, historyMaxPoints: 500, ...patch } });
}

beforeEach(async () => {
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkProduct', () => {
  test('updates currentPrice and appends history on successful fetch', async () => {
    const product = makeProduct();
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 6500, currency: 'USD', inStock: true, strategy: 2, selectorUsed: 'json-ld',
    }));

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.currentPrice).toBe(6500);
    expect(updated.consecutiveErrors).toBe(0);
    expect(updated.lastChecked).toBeGreaterThan(0);

    const history = await getHistory('test-product-1');
    expect(history.length).toBe(1);
    expect(history[0].price).toBe(6500);
  });

  test('fires notification when price drops below target', async () => {
    const product = makeProduct({ currentPrice: 7000, targetPrice: 5000 });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 4500, currency: 'USD', inStock: true, strategy: 2, selectorUsed: 'json-ld',
    }));

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notifId, opts] = chrome.notifications.create.mock.calls[0];
    expect(notifId).toMatch(/^price_test-product-1_/);
    expect(opts.title).toContain('Price drop');
  });

  test('does not fire notification when price is above target', async () => {
    const product = makeProduct({ currentPrice: 7000, targetPrice: 5000 });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 6000, currency: 'USD', inStock: true, strategy: 2,
    }));

    await checkProduct('test-product-1');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('increments consecutiveErrors on fetch error, does not update price', async () => {
    const product = makeProduct({ currentPrice: 7000 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult({ error: 'HTTP 503' }));

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.consecutiveErrors).toBe(1);
    expect(updated.currentPrice).toBe(7000); // unchanged
  });

  test('clears selector after DRIFT_STRIKE_LIMIT consecutive nulls', async () => {
    const product = makeProduct({ selectors: { price: '.old-selector' }, consecutiveNulls: 2 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult());

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.sources[0].selectors.price).toBeNull();
    expect(updated.sources[0].consecutiveNulls).toBe(0);
  });

  test('skips disabled products', async () => {
    const product = makeProduct({ enabled: false });
    await saveProduct(product);

    await checkProduct('test-product-1');

    expect(fetchAndExtract).not.toHaveBeenCalled();
  });

  test('fires back-in-stock notification', async () => {
    const product = makeProduct({
      inStock: false,
      currentPrice: 7000,
      targetPrice: 9999, // above current so no price-drop notif
    });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 7000, currency: 'USD', inStock: true, strategy: 2,
    }));

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [, opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.title).toContain('Back in stock');
  });
});
