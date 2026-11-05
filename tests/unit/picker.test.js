import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
const script = readFileSync(new URL('../../src/content/picker.js', import.meta.url), 'utf8');
beforeEach(() => {
  document.body.innerHTML = '';
  window.__priceWatchPickerActive = false;
  global.CSS = { escape: (s) => String(s).replaceAll('"', '\\"') };
  global.chrome = { runtime: { sendMessage: jest.fn(async () => ({ ok: true })) } };
});
test.each(['data-test', 'data-testid'])('picked %s selector resolves to the original nested node', (attribute) => {
  document.body.innerHTML = `<span ${attribute}="product-price"><b>$49.99</b></span>`;
  const target = document.querySelector('b');
  window.eval(script);
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  target.click();
  const { selector } = chrome.runtime.sendMessage.mock.calls[0][0];
  expect(document.querySelector(selector)).toBe(target);
  expect(window.__priceWatchPickerActive).toBe(false);
});
