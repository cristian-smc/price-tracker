/**
 * Affiliate link injection.
 * Transforms product URLs to include affiliate parameters for supported retailers.
 *
 * Add new retailers by pushing entries to RULES. Each rule needs:
 *   match  — RegExp tested against the URL hostname
 *   apply  — (URL object, settings) => string
 *
 * Publisher tags are used as fallback when the user has not configured their own.
 * Disclosed in the Chrome Web Store listing as required by CWS policy and
 * Amazon Associates ToS.
 */

// ── Publisher defaults (fallback when user has no tag configured) ─────────────
const PUBLISHER_AMAZON_TAG = 'cristiansmc-20';

const RULES = [
  {
    // Amazon — all storefronts
    match: /\bamazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|com\.mx|nl|pl|se|sg|ae|com\.tr)$/,
    apply: (u, settings) => {
      const tag = settings.affiliateAmazonTag || PUBLISHER_AMAZON_TAG;
      if (!tag) return null;
      u.searchParams.set('tag', tag);
      return u.toString();
    },
  },
];

/**
 * Apply affiliate parameters to a URL.
 * Returns the original URL string if no rule matches or no tag is configured.
 *
 * @param {string} url
 * @param {object} settings  — extension settings object from storage
 * @returns {string}
 */
export function applyAffiliate(url, settings) {
  if (!url || !settings) return url;
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const rule of RULES) {
      if (rule.match.test(hostname)) {
        return rule.apply(u, settings) ?? url;
      }
    }
  } catch { /* invalid URL */ }
  return url;
}
