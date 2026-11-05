/** Reject transport failures and worker error envelopes consistently in UI callers. */
export async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || typeof response !== 'object') throw new Error('The extension did not respond. Please try again.');
  if (response.error) {
    const copy = {
      already_tracked: 'This URL is already tracked. Open it from your product list.',
      already_added: 'This store URL is already added.',
      last_source: 'Keep at least one source for this product.',
    };
    const error = new Error(copy[response.error] ?? response.error);
    error.code = response.error;
    error.response = response;
    throw error;
  }
  return response;
}
