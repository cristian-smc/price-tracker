import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../src/options/options.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
let fail, imported;
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers(); fail = false; imported = false;
  document.body.innerHTML = html;
  global.Notification = { permission: 'granted' };
  global.chrome = {
    runtime: { sendMessage: jest.fn(async (msg) => {
      if (msg.type === 'GET_SETTINGS') return { settings: { defaultCurrency: 'EUR', defaultInterval: 60 } };
      if (fail) return { error: 'Storage quota exceeded' };
      if (msg.type === 'IMPORT_BACKUP') imported = true;
      return { ok: true, added: 2 };
    }) },
    storage: { sync: { get: jest.fn(async () => ({})), clear: jest.fn(async () => {}), set: jest.fn(async () => {}) }, local: { get: jest.fn(async () => ({})), clear: jest.fn(async () => {}), set: jest.fn(async () => {}) } },
  };
  global.confirm = jest.fn(() => false);
  await import('../../src/options/options.js');
});
afterEach(() => jest.useRealTimers());
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
test('failed settings save reports error not success and resets controls', async () => {
  fail = true; document.getElementById('btn-save').click(); await flush();
  expect(document.getElementById('save-status').textContent).toContain('quota');
  expect(document.getElementById('save-status').getAttribute('role')).toBe('alert');
  expect(document.getElementById('btn-save').disabled).toBe(false);
  jest.advanceTimersByTime(4000);
  expect(document.getElementById('save-status').classList.contains('hidden')).toBe(false);
});
test('failed bulk import retains entered URLs and reports error', async () => {
  fail = true; const input = document.getElementById('bulk-urls'); input.value = 'https://example.com/item';
  document.getElementById('btn-bulk-import').click(); await flush();
  expect(input.value).toBe('https://example.com/item');
  expect(document.getElementById('bulk-status').textContent).toContain('quota');
});
test('failed Gist action shows error and restores button', async () => {
  fail = true; document.getElementById('gist-token').value = 'test-only-placeholder';
  document.getElementById('btn-gist-sync').click(); await flush();
  expect(document.getElementById('gist-status').textContent).toContain('quota');
  expect(document.getElementById('btn-gist-sync').disabled).toBe(false);
});

test('backup replacement asks permission before any storage mutation', async () => {
  const input = document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [{ text: async () => JSON.stringify({ sync: {}, local: {} }) }] });
  input.dispatchEvent(new Event('change')); await flush();
  expect(confirm).toHaveBeenCalled();
  expect(imported).toBe(false);
  expect(chrome.storage.sync.clear).not.toHaveBeenCalled();
  expect(chrome.storage.local.clear).not.toHaveBeenCalled();
});
