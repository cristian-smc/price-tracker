/**
 * Visual element picker — injected into the active tab by the popup.
 *
 * Shows a highlight overlay when the user hovers over elements.
 * On click, captures the element's CSS selector and sends it back
 * to the extension via chrome.runtime.sendMessage({ type: 'PICKER_RESULT', selector }).
 * Pressing Escape cancels.
 *
 * Avoids injecting twice if already active.
 */

(function () {
  if (window.__priceWatchPickerActive) return;
  window.__priceWatchPickerActive = true;

  // ── Overlay element ───────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__pw-picker-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    background: 'rgba(37,99,235,0.18)',
    border: '2px solid #2563eb',
    borderRadius: '3px',
    boxSizing: 'border-box',
    transition: 'all 0.05s ease',
    display: 'none',
  });
  document.body.appendChild(overlay);

  // ── Instruction banner ────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = '__pw-picker-banner';
  banner.textContent = 'PriceWatch: click the price element. Press Esc to cancel.';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    background: '#1e293b',
    color: '#f8fafc',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    pointerEvents: 'none',
  });
  document.body.appendChild(banner);

  // ── Track current target ──────────────────────────────────────────────────
  let currentTarget = null;

  function highlightElement(el) {
    if (!el || el === overlay || el === banner) return;
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'block',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  // ── CSS selector generation ───────────────────────────────────────────────

  /**
   * Build a reasonably specific CSS selector for an element.
   * Prefers id → data attributes → class chain → tag path.
   * Stops at <body>.
   * @param {Element} el
   * @returns {string}
   */
  function buildSelector(el) {
    const parts = [];
    let current = el;

    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        return `#${CSS.escape(current.id)}${parts.length ? ' ' + parts.join(' ') : ''}`;
      }

      // Prefer data-testid / data-test / itemprop
      const dataTestId = current.getAttribute('data-testid') || current.getAttribute('data-test');
      if (dataTestId) {
        part = `${part}[data-testid="${CSS.escape(dataTestId)}"]`;
        parts.unshift(part);
        break;
      }
      const itemprop = current.getAttribute('itemprop');
      if (itemprop === 'price') {
        part = `[itemprop="price"]`;
        parts.unshift(part);
        break;
      }

      // Class-based: use up to 2 stable-looking classes (no state classes)
      const stableClasses = Array.from(current.classList)
        .filter((c) => !/active|selected|hover|focus|open|visible|hidden|disabled/i.test(c))
        .slice(0, 2);

      if (stableClasses.length > 0) {
        part += stableClasses.map((c) => `.${CSS.escape(c)}`).join('');
      } else {
        // nth-child fallback
        const siblings = Array.from(current.parentElement?.children ?? []);
        const idx = siblings.indexOf(current) + 1;
        part += `:nth-child(${idx})`;
      }

      parts.unshift(part);
      current = current.parentElement;

      // Stop if we have a reasonably specific selector already
      if (parts.length >= 3) break;
    }

    return parts.join(' > ');
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function onMouseOver(e) {
    highlightElement(e.target);
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!currentTarget) return cleanup();

    const selector = buildSelector(currentTarget);
    cleanup();

    chrome.runtime.sendMessage({ type: 'PICKER_RESULT', selector });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      chrome.runtime.sendMessage({ type: 'PICKER_RESULT', selector: null, cancelled: true });
    }
  }

  function cleanup() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    banner.remove();
    window.__priceWatchPickerActive = false;
  }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
