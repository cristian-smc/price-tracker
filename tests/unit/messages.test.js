import { jest } from '@jest/globals';
import { sendMessage } from '../../src/shared/messages.js';
beforeEach(() => { global.chrome = { runtime: { sendMessage: jest.fn() } }; });
test('success response remains available to the caller', async () => {
  chrome.runtime.sendMessage.mockResolvedValue({ products: { p1: { name: 'Widget' } } });
  expect(await sendMessage({ type: 'GET_PRODUCTS' })).toEqual({ products: { p1: { name: 'Widget' } } });
});
test('duplicate errors retain useful product and code', async () => {
  chrome.runtime.sendMessage.mockResolvedValue({ error: 'already_tracked', product: { id: 'p1' } });
  const error = await sendMessage({ type: 'ADD_PRODUCT' }).catch((e) => e);
  expect(error.message).toMatch(/already tracked/i);
  expect(error.code).toBe('already_tracked'); expect(error.response.product.id).toBe('p1');
});
test('transport rejection reaches caller and missing response is not success', async () => {
  chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('Disconnected'));
  await expect(sendMessage({ type: 'CHECK_NOW' })).rejects.toThrow('Disconnected');
  chrome.runtime.sendMessage.mockResolvedValue(undefined);
  await expect(sendMessage({ type: 'CHECK_NOW' })).rejects.toThrow(/did not respond/);
});
