// Injected at document_start in the MAIN world by tabFetchAndExtract().
// Overrides the Page Visibility API so SPAs continue loading content even
// when the window is minimized — lets us avoid the visible-window flash.
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
