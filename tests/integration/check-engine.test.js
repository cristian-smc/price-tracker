/**
 * Integration tests for the check-engine cycle.
 * Uses manual mocks for chrome.* APIs and the fetcher.
 *
 * Run with: npx jest tests/integration/check-engine.test.js
 */

// ── Chrome API mock ───────────────────────────────────────────────────────────

const storedData = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (keys === null) return { ...storedData };
        const result = {};
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
        for (const k of ks) result[k] = storedData[k];
        return result;
      }),
      set: jest.fn(async (items) => { Object.assign(storedData, items); }),
      remove: jest.fn(async (keys) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const k of ks) delete storedData[k];
      }),
      clear: jest.fn(async () => { for (const k of Object.keys(storedData)) delete storedData[k]; }),
    },
  },
  notifications: {
    create: jest.fn(async () => {}),
  },
  runtime: {
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: jest.fn(),
  },
};

// ── Mock fetcher ──────────────────────────────────────────────────────────────

jest.mock('../../src/background/fetcher.js', () => ({
  fetchAndExtract: jest.fn(),
}));
jest.mock('../../src/background/tab-fetcher.js', () => ({
  tabFetchAndExtract: jest.fn(),
}));

import { fetchAndExtract } from '../../src/background/fetcher.js';
import { checkProduct } from '../../src/background/check-engine.js';
import { saveProduct, getProduct, getHistory } from '../../src/shared/storage.js';
import { STOCK_STATUS } from '../../src/shared/constants.js';

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
    selectors: { price: null, stock: null },
    requiresTabExtraction: false,
    currentPrice: 7000,      // $70.00
    currentStock: STOCK_STATUS.IN_STOCK,
    lastChecked: null,
    lastNotified: null,
    consecutiveErrors: 0,
    consecutiveNulls: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  // Clear storage between tests
  await chrome.storage.local.clear();
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkProduct', () => {
  test('updates currentPrice and appends history on successful fetch', async () => {
    const product = makeProduct();
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue({
      price: 6500, currency: 'USD', stock: STOCK_STATUS.IN_STOCK,
      strategy: 2, selectorUsed: 'json-ld', requiresTabExtraction: false, error: null,
    });

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

    fetchAndExtract.mockResolvedValue({
      price: 4500, currency: 'USD', stock: STOCK_STATUS.IN_STOCK,
      strategy: 2, selectorUsed: 'json-ld', requiresTabExtraction: false, error: null,
    });

    // Ensure notifications are enabled in settings
    await chrome.storage.local.set({ settings: { notificationsEnabled: true, historyMaxPoints: 500 } });

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notifId, opts] = chrome.notifications.create.mock.calls[0];
    expect(notifId).toMatch(/^price_test-product-1_/);
    expect(opts.title).toContain('Price drop');
  });

  test('does not fire notification when price is above target', async () => {
    const product = makeProduct({ currentPrice: 7000, targetPrice: 5000 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue({
      price: 6000, currency: 'USD', stock: STOCK_STATUS.IN_STOCK,
      strategy: 2, selectorUsed: null, requiresTabExtraction: false, error: null,
    });

    await checkProduct('test-product-1');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('increments consecutiveErrors on fetch error, does not update price', async () => {
    const product = makeProduct({ currentPrice: 7000 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue({
      price: null, currency: null, stock: 'unknown',
      strategy: null, selectorUsed: null, requiresTabExtraction: false, error: 'HTTP 503',
    });

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.consecutiveErrors).toBe(1);
    expect(updated.currentPrice).toBe(7000); // unchanged
  });

  test('clears selector after DRIFT_STRIKE_LIMIT consecutive nulls', async () => {
    const product = makeProduct({ selectors: { price: '.old-selector' }, consecutiveNulls: 2 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue({
      price: null, currency: null, stock: 'unknown',
      strategy: null, selectorUsed: null, requiresTabExtraction: false, error: null,
    });

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.selectors.price).toBeNull();
    expect(updated.consecutiveNulls).toBe(0);
  });

  test('skips disabled products', async () => {
    const product = makeProduct({ enabled: false });
    await saveProduct(product);

    await checkProduct('test-product-1');

    expect(fetchAndExtract).not.toHaveBeenCalled();
  });

  test('fires back-in-stock notification', async () => {
    const product = makeProduct({
      currentStock: STOCK_STATUS.OUT_OF_STOCK,
      currentPrice: 7000,
      targetPrice: 9999, // above current so no price-drop notif
    });
    await saveProduct(product);
    await chrome.storage.local.set({ settings: { notificationsEnabled: true, historyMaxPoints: 500 } });

    fetchAndExtract.mockResolvedValue({
      price: 7000, currency: 'USD', stock: STOCK_STATUS.IN_STOCK,
      strategy: 2, selectorUsed: null, requiresTabExtraction: false, error: null,
    });

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [, opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.title).toContain('Back in stock');
  });
});
