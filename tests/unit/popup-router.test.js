import { jest } from '@jest/globals';
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const product = { id: 'p1', name: 'Widget', url: 'https://example.com/item', currency: 'USD', currentPrice: 2000, targetPrice: null,
  enabled: true, intervalMinutes: 15, createdAt: 1, sources: [] };
let checkResolve, addError, settings, savedThenFail, refreshReject;
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
beforeEach(async () => {
  jest.resetModules(); addError = false; savedThenFail = false; settings = { defaultInterval: 60, defaultCurrency: 'EUR' };
  document.body.innerHTML = '<div id="notif-banner" class="hidden"></div><button id="btn-add">+</button><button id="btn-settings"></button><main id="view-container"></main>';
  global.chrome = {
    runtime: { id: 'test', onMessage: { addListener: jest.fn() }, openOptionsPage: jest.fn(), sendMessage: jest.fn(async (msg) => {
      if (msg.type === 'GET_SETTINGS') return { settings };
      if (msg.type === 'GET_PRODUCTS') { if (savedThenFail === 'deferred') { savedThenFail = false; return new Promise((_r, reject) => { refreshReject = reject; }); } if (savedThenFail === 'fail') { savedThenFail = false; throw new Error('Reload offline'); } return { products: { p1: product } }; }
      if (msg.type === 'GET_HISTORY') return { points: [] };
      if (msg.type === 'CHECK_NOW') return new Promise((r) => { checkResolve = r; });
      if (msg.type === 'ADD_PRODUCT') { if (savedThenFail === true) savedThenFail = 'fail'; if (savedThenFail === 'deferNext') savedThenFail = 'deferred'; return addError ? { error: 'already_tracked', product } : { product }; }
      if (msg.type === 'UPDATE_SETTINGS') { settings = { ...settings, ...msg.data }; return { settings }; }
      return { ok: true };
    }) },
    tabs: { query: jest.fn(async () => [{ url: product.url, title: 'Widget' }]) },
    permissions: { contains: jest.fn(async () => true) },
    storage: { local: { get: jest.fn(async () => ({})), remove: jest.fn() } },
  };
  await import('../../src/popup/popup.js');
});
test('error envelope keeps add form and displays useful duplicate error', async () => {
  addError = true; document.getElementById('btn-add').click(); await tick();
  expect(document.querySelector('select').value).toBe('60');
  button('Start tracking').click(); await tick();
  expect(document.querySelector('form')).not.toBeNull();
  expect(document.querySelector('[role="alert"]').textContent).toMatch(/already|tracked/i);
  expect(document.getElementById('field-url').value).toBe(product.url);
});
test('saved product with failed refresh offers reload rather than another save', async () => {
  document.getElementById('btn-add').click(); await tick();
  savedThenFail = true; button('Start tracking').click(); await tick();
  expect(document.querySelector('form')).toBeNull();
  expect(document.querySelector('[role="alert"]').textContent).toMatch(/saved/i);
  button('Retry loading').click(); await tick();
  expect(document.querySelector('.product-card')).not.toBeNull();
  expect(chrome.runtime.sendMessage.mock.calls.filter(([msg]) => msg.type === 'ADD_PRODUCT')).toHaveLength(1);
});

test('late failed post-save refresh cannot replace a newer Add route', async () => {
  document.getElementById('btn-add').click(); await tick();
  savedThenFail = 'deferNext'; button('Start tracking').click(); await tick();
  document.getElementById('btn-add').click(); await tick();
  document.getElementById('field-name').value = 'New draft';
  refreshReject(new Error('Late load error')); await tick();
  expect(document.querySelector('form')).not.toBeNull();
  expect(document.getElementById('field-name').value).toBe('New draft');
});

test('late check does not navigate away from Back and list state survives', async () => {
  const search = document.querySelector('input[type="search"]'); search.value = 'Wid'; search.dispatchEvent(new Event('input'));
  const sort = document.querySelector('[aria-label="Sort by"]'); sort.value = 'name'; sort.dispatchEvent(new Event('change')); await tick();
  document.querySelector('.card-open').click(); await tick();
  button('Check now').click(); await tick();
  button('Back').click(); await tick();
  checkResolve({ ok: true }); await tick();
  expect(document.querySelector('input[type="search"]').value).toBe('Wid');
  expect(document.querySelector('[aria-label="Sort by"]').value).toBe('name');
  expect(settings.sortBy).toBe('name');
  expect(document.querySelector('.detail-view')).toBeNull();
});
