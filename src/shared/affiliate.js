/**
 * Affiliate link injection.
 * Transforms product URLs to include affiliate parameters for supported retailers.
 *
 * Add new retailers by pushing entries to RULES. Each rule needs:
 *   match  — RegExp tested against the URL hostname
 *   apply  — (URL object, settings) => string
 */

const RULES = [
  {
    // Amazon — all storefronts. Takes priority over Skimlinks (higher commission rate).
    match: /\bamazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|com\.mx|nl|pl|se|sg|ae|com\.tr)$/,
    apply: (u, settings) => {
      if (!settings.affiliateAmazonTag) return null;
      u.searchParams.set('tag', settings.affiliateAmazonTag);
      return u.toString();
    },
  },
  {
    // Skimlinks — catches any other merchant they support (40,000+ retailers).
    // Amazon is excluded above so it always uses the higher Associates rate.
    match: /.*/,
    apply: (u, settings) => {
      if (!settings.affiliateSkimlinksId) return null;
      return `https://go.skimlinks.com/?id=${encodeURIComponent(settings.affiliateSkimlinksId)}&url=${encodeURIComponent(u.toString())}`;
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
