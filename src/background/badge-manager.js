/**
 * Manages the extension action badge — shows count of products currently
 * below their target price. Clears when count reaches zero.
 */

import { getProducts } from '../shared/storage.js';

export async function updateBadge() {
  const products = await getProducts();
  const count = Object.values(products).filter(
    (p) => p.enabled && p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice
  ).length;

  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}
