/**
 * Syncs the product list to a secret GitHub Gist so the Termux companion
 * can download the latest product list without manual file transfers.
 *
 * Called after any product list change (add / update / delete).
 * Silently no-ops if no token is configured.
 */

import { getProducts, getSettings, updateSettings } from '../shared/storage.js';

const GIST_API = 'https://api.github.com/gists';
const FILENAME  = 'pricewatch.json';

/**
 * Build the Termux-compatible product payload from raw storage products.
 * @param {Record<string, object>} products
 * @returns {object}
 */
function buildPayload(products) {
  const list = Object.values(products).map((p) => ({
    id:              p.id,
    name:            p.name,
    url:             p.canonicalUrl ?? p.url,
    targetPrice:     p.targetPrice  ?? null,
    currency:        p.currency     ?? 'USD',
    enabled:         p.enabled,
    intervalMinutes: p.intervalMinutes,
    priceSelector:   p.selectors?.price ?? null,
  }));
  return { exported: new Date().toISOString(), products: list };
}

/**
 * Push the current product list to GitHub Gist.
 * Creates the Gist on first call and stores its ID in settings.
 * @returns {Promise<{ ok: boolean, gistId?: string, error?: string }>}
 */
export async function syncToGist() {
  const settings = await getSettings();
  const { gistToken, gistId } = settings;

  if (!gistToken) return { ok: false, error: 'no_token' };

  const products = await getProducts();
  const content  = JSON.stringify(buildPayload(products), null, 2);

  const headers = {
    'Authorization':        `Bearer ${gistToken}`,
    'Content-Type':         'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    if (gistId) {
      const resp = await fetch(`${GIST_API}/${gistId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ files: { [FILENAME]: { content } } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        if (resp.status === 401) await updateSettings({ gistToken: '' });
        throw new Error(`HTTP ${resp.status}`);
      }
      return { ok: true, gistId };
    } else {
      const resp = await fetch(GIST_API, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: 'PriceWatch companion product list',
          public: false,
          files: { [FILENAME]: { content } },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        if (resp.status === 401) await updateSettings({ gistToken: '' });
        throw new Error(`HTTP ${resp.status}`);
      }
      const data    = await resp.json();
      const newId   = data.id;
      await updateSettings({ gistId: newId });
      return { ok: true, gistId: newId };
    }
  } catch (err) {
    console.error('[gist-sync] sync failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Verify a token by fetching its rate-limit info (no scope needed for that).
 * Returns { ok, login } or { ok: false, error }.
 */
export async function verifyGistToken(token) {
  try {
    const resp = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization':        `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { ok: true, login: data.login };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
