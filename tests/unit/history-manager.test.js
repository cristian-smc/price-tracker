/**
 * Tests for history storage in src/shared/storage.js (appendHistory + getHistory).
 * Run with: npx jest tests/unit/history-manager.test.js
 */

import { jest } from '@jest/globals';

// ── Chrome storage mock ────────────────────────────────────────────────────

const store = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (keys === null) return { ...store };
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
    },
  },
};

import { appendHistory, getHistory } from '../../src/shared/storage.js';

beforeEach(async () => {
  await chrome.storage.local.clear();
  jest.clearAllMocks();
});

describe('appendHistory', () => {
  test('appends a point to empty history', async () => {
    await appendHistory('p1', { price: 1999 }, 500);
    const pts = await getHistory('p1');
    expect(pts.length).toBe(1);
    expect(pts[0].price).toBe(1999);
    expect(typeof pts[0].ts).toBe('number');
  });

  test('appends multiple points in order', async () => {
    await appendHistory('p1', { price: 3000 }, 500);
    await appendHistory('p1', { price: 2500 }, 500);
    await appendHistory('p1', { price: 2000 }, 500);
    const pts = await getHistory('p1');
    expect(pts.length).toBe(3);
    expect(pts[0].price).toBe(3000);
    expect(pts[2].price).toBe(2000);
  });

  test('prunes to maxPoints', async () => {
    for (let i = 0; i < 10; i++) {
      await appendHistory('p1', { price: i * 100 }, 5);
    }
    const pts = await getHistory('p1');
    expect(pts.length).toBe(5);
    // Should keep the last 5 (most recent)
    expect(pts[0].price).toBe(500);
    expect(pts[4].price).toBe(900);
  });

  test('getHistory returns empty array for unknown product', async () => {
    const pts = await getHistory('nonexistent');
    expect(pts).toEqual([]);
  });

  test('different products have independent history', async () => {
    await appendHistory('p1', { price: 1000 }, 500);
    await appendHistory('p2', { price: 2000 }, 500);
    const p1 = await getHistory('p1');
    const p2 = await getHistory('p2');
    expect(p1.length).toBe(1);
    expect(p2.length).toBe(1);
    expect(p1[0].price).toBe(1000);
    expect(p2[0].price).toBe(2000);
  });
});
