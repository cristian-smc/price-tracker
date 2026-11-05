/**
 * Product detail view — sparkline chart + metadata + actions.
 *
 * @param {{
 *   product: import('../../shared/types').Product,
 *   history: import('../../shared/types').HistoryPoint[],
 *   onBack: () => void,
 *   onEdit: (id: string) => void,
 *   onDelete: (id: string) => void,
 *   onCheckNow: (id: string) => void,
 *   onToggleEnabled: (id: string, enabled: boolean) => void,
 *   onToggleNotification: (id: string, enabled: boolean) => void,
 *   onToggleStockCheck: (id: string, enabled: boolean) => void,
 * }} opts
 */

import { displayPrice } from '../components/currency-badge.js';
import { renderSparkline } from '../components/sparkline.js';
import { applyAffiliate } from '../../shared/affiliate.js';
import { referenceCurrency, normalizeCurrency, trackingHealth, trustedHistory } from '../../shared/product-state.js';

export function renderProductDetail({
  product,
  history,
  settings,
  onBack,
  onEdit,
  onDelete,
  onCheckNow,
  onToggleEnabled,
  onToggleNotification,
  onToggleStockCheck,
  onAddSource,
  onRemoveSource,
  onRepair,
  onDiscover,
}) {
  const currency = referenceCurrency(product);
  const verifiedHistory = trustedHistory(product, history);
  const earlierHistory = history.filter((point) => point.currency !== currency);
  const wrap = document.createElement('div');
  wrap.className = 'detail-view';

  // ── Back button ───────────────────────────────────────────────────────────
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1L5 8l6 7"/></svg> Back`;
  backBtn.addEventListener('click', onBack);
  wrap.appendChild(backBtn);

  // ── Thumbnail + name ──────────────────────────────────────────────────────
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;align-items:flex-start;gap:12px;';
  const headerImg = makeDetailImage(product);
  if (headerImg) headerRow.appendChild(headerImg);
  const nameEl = document.createElement('h2');
  nameEl.textContent = product.name;
  nameEl.title = product.name;
  headerRow.appendChild(nameEl);
  wrap.appendChild(headerRow);

  // ── Price row ─────────────────────────────────────────────────────────────
  const priceRow = document.createElement('div');
  priceRow.className = 'price-row';

  const priceBig = document.createElement('span');
  priceBig.className = 'price-big';
  priceBig.textContent = displayPrice(product.currentPrice, currency);
  priceRow.appendChild(priceBig);

  if (product.targetPrice !== null) {
    const target = document.createElement('span');
    target.className = 'price-target';
    target.textContent = `Target: ${displayPrice(product.targetPrice, currency)}`;
    priceRow.appendChild(target);
  }

  if (product.sellThreshold != null) {
    const sell = document.createElement('span');
    sell.className = 'price-target';
    sell.textContent = `Sell: ${displayPrice(product.sellThreshold, currency)}`;
    sell.style.color = 'var(--warning)';
    priceRow.appendChild(sell);
  }

  wrap.appendChild(priceRow);
  const health = trackingHealth(product, product.intervalMinutes, product.enabled);
  const healthPanel = document.createElement('div'); healthPanel.className = `health-panel health-${health.state}`;
  const heading = document.createElement('strong'); heading.textContent = health.label;
  const explanation = document.createElement('p'); explanation.textContent = health.detail;
  const unit = document.createElement('p'); unit.textContent = `Watch currency: ${currency}. Other currencies are shown separately, without conversion.`;
  healthPanel.append(heading, explanation, unit);
  if (onRepair) {
    const repair = document.createElement('button'); repair.type = 'button'; repair.className = 'btn btn-secondary'; repair.textContent = 'Repair price selector';
    repair.addEventListener('click', async () => { repair.disabled = true; try { await onRepair(product.id, product.sources?.[0]?.id ?? null); } catch (err) { explanation.textContent = err.message; } finally { repair.disabled = false; } });
    healthPanel.appendChild(repair);
  }
  wrap.appendChild(healthPanel);
  const tags = document.createElement('div'); tags.className = 'organization-chips';
  for (const value of [product.group, ...(product.tags ?? [])].filter(Boolean)) { const chip = document.createElement('span'); chip.className = 'badge tag'; chip.textContent = value; tags.appendChild(chip); }
  if (tags.childNodes.length) wrap.appendChild(tags);

  // ── Price stats (initial / lowest / highest) ──────────────────────────────
  if (product.statsCurrency === currency && (product.initialPrice != null || product.lowestPrice != null || product.highestPrice != null)) {
    const stats = document.createElement('div');
    stats.className = 'price-stats';

    if (product.initialPrice != null) {
      stats.appendChild(makePriceStat('Initial', displayPrice(product.initialPrice, currency), ''));
    }
    if (product.lowestPrice != null) {
      stats.appendChild(makePriceStat('Lowest', displayPrice(product.lowestPrice, currency), 'low'));
    }
    if (product.highestPrice != null) {
      stats.appendChild(makePriceStat('Highest', displayPrice(product.highestPrice, currency), 'high'));
    }
    wrap.appendChild(stats);
  }

  // ── Check now (inline, below price stats) ────────────────────────────────
  const checkBtn = document.createElement('button');
  checkBtn.className = 'btn btn-primary';
  checkBtn.style.alignSelf = 'flex-start';
  checkBtn.textContent = 'Check now';
  const status = document.createElement('div');
  status.className = 'action-status'; status.setAttribute('aria-live', 'polite');
  wrap.appendChild(status);
  async function runAction(button, action, pending = 'Saving…') {
    const label = button.textContent;
    button.disabled = true; button.textContent = pending;
    status.textContent = ''; status.removeAttribute('role');
    try { await action(); status.textContent = 'Done.'; }
    catch (err) { status.setAttribute('role', 'alert'); status.textContent = err.message || 'Action failed. Please try again.'; }
    finally { button.disabled = false; button.textContent = label; }
  }
  checkBtn.addEventListener('click', () => runAction(checkBtn, () => onCheckNow(product.id), 'Checking…'));
  wrap.appendChild(checkBtn);

  // ── Sparkline ─────────────────────────────────────────────────────────────
  const chartContainer = document.createElement('div');
  chartContainer.className = 'sparkline-container';
  chartContainer.appendChild(renderSparkline(verifiedHistory.length ? verifiedHistory : earlierHistory, { width: 340, height: 64, currency }));
  wrap.appendChild(chartContainer);
  if (earlierHistory.length) {
    const note = document.createElement('p'); note.className = 'hint';
    note.textContent = verifiedHistory.length ? `${earlierHistory.length} earlier observations are preserved below. Their currency is unverified and they do not affect current comparisons.` : 'Earlier history is shown as recorded. Its currency is unverified; values have not been converted and do not affect current comparisons.';
    wrap.appendChild(note);
    if (verifiedHistory.length) {
      const earlier = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = `Earlier history (${earlierHistory.length} points · unverified currency)`;
      const chart = document.createElement('div'); chart.className = 'sparkline-container';
      chart.appendChild(renderSparkline(earlierHistory, { width: 340, height: 64, currency }));
      earlier.append(summary, chart); wrap.appendChild(earlier);
    }
  }

  // ── Meta grid ─────────────────────────────────────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'meta-grid';

  meta.appendChild(makeMetaItem('Check interval', `Every ${product.intervalMinutes} min`));
  meta.appendChild(makeMetaItem('Last attempt', product.lastChecked ? formatRelativeTime(product.lastChecked) : '—'));
  meta.appendChild(makeMetaItem('Price observed', product.lastObserved ? formatRelativeTime(product.lastObserved) : 'Unknown'));
  meta.appendChild(makeMetaItem('History points', String(history.length)));

  if (product.consecutiveErrors > 0) {
    meta.appendChild(makeMetaItem('Errors', `${product.consecutiveErrors} consecutive`));
  }

  wrap.appendChild(meta);

  // ── URL + copy button ─────────────────────────────────────────────────────
  const bestSource = product.sources?.find((s) => s.id === product.bestSourceId);
  const displayUrl = bestSource?.canonicalUrl ?? bestSource?.url ?? product.canonicalUrl ?? product.url;

  const urlWrap = document.createElement('div');
  urlWrap.className = 'field';
  urlWrap.style.gap = '4px';

  const urlHeader = document.createElement('div');
  urlHeader.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const urlLabel = document.createElement('span');
  urlLabel.style.cssText = 'font-size:11px;color:var(--text-muted);flex:1;';
  urlLabel.textContent = 'URL';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-url-btn';
  copyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 011-1h8"/></svg> Copy`;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(displayUrl).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 011-1h8"/></svg> Copy`;
      }, 1500);
    });
  });

  urlHeader.appendChild(urlLabel);
  urlHeader.appendChild(copyBtn);

  const urlLink = document.createElement('a');
  urlLink.href = applyAffiliate(displayUrl, settings ?? {});
  urlLink.target = '_blank';
  urlLink.rel = 'noopener noreferrer';
  urlLink.style.cssText = 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:var(--accent)';
  urlLink.textContent = displayUrl;
  urlLink.title = displayUrl;

  urlWrap.appendChild(urlHeader);
  urlWrap.appendChild(urlLink);
  wrap.appendChild(urlWrap);

  // ── Sources ───────────────────────────────────────────────────────────────
  const sources = product.sources ?? [];
  wrap.appendChild(buildSourcesSection(product, sources, onAddSource, onRemoveSource, settings, onRepair, onDiscover));

  // ── Notification toggle ───────────────────────────────────────────────────
  const notifRow = document.createElement('div');
  notifRow.className = 'toggle-row';
  const notifLabel = document.createElement('span');
  notifLabel.textContent = 'Notifications for this product';
  const notifLabel2 = document.createElement('label');
  notifLabel2.className = 'toggle';
  const notifInput = document.createElement('input');
  notifInput.type = 'checkbox';
  notifInput.checked = product.notificationEnabled !== false;
  notifInput.setAttribute('aria-label', notifLabel.textContent);
  notifInput.addEventListener('change', () => saveToggle(notifInput, onToggleNotification));
  const notifSlider = document.createElement('span');
  notifSlider.className = 'toggle-slider';
  notifLabel2.appendChild(notifInput);
  notifLabel2.appendChild(notifSlider);
  notifRow.appendChild(notifLabel);
  notifRow.appendChild(notifLabel2);
  wrap.appendChild(notifRow);

  // ── Stock check toggle ────────────────────────────────────────────────────
  const stockRow = document.createElement('div');
  stockRow.className = 'toggle-row';
  const stockLabel = document.createElement('span');
  stockLabel.textContent = 'Check stock status';
  stockLabel.title = 'When enabled, out-of-stock items are hidden and price alerts are paused. When disabled, price alerts trigger regardless of stock status.';
  const stockLabel2 = document.createElement('label');
  stockLabel2.className = 'toggle';
  const stockInput = document.createElement('input');
  stockInput.type = 'checkbox';
  stockInput.checked = product.checkStockEnabled !== false;
  stockInput.setAttribute('aria-label', stockLabel.textContent);
  stockInput.addEventListener('change', () => saveToggle(stockInput, onToggleStockCheck));
  async function saveToggle(input, action) {
    const value = input.checked;
    input.disabled = true;
    try { await action(product.id, value); }
    catch (err) { input.checked = !value; status.setAttribute('role', 'alert'); status.textContent = err.message || 'Could not save preference.'; }
    finally { input.disabled = false; }
  }
  const stockSlider = document.createElement('span');
  stockSlider.className = 'toggle-slider';
  stockLabel2.appendChild(stockInput);
  stockLabel2.appendChild(stockSlider);
  stockRow.appendChild(stockLabel);
  stockRow.appendChild(stockLabel2);
  wrap.appendChild(stockRow);

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => onEdit(product.id));

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn btn-secondary';
  toggleBtn.textContent = product.enabled ? 'Pause' : 'Resume';
  toggleBtn.addEventListener('click', () => runAction(toggleBtn, () => onToggleEnabled(product.id, !product.enabled)));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Stop tracking "${product.name}"?`)) {
      runAction(deleteBtn, () => onDelete(product.id), 'Deleting…');
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(toggleBtn);
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);

  return wrap;
}

// ── Sources section ───────────────────────────────────────────────────────────

function buildSourcesSection(product, sources, onAddSource, onRemoveSource, settings, onRepair, onDiscover) {
  const section = document.createElement('div');
  section.className = 'sources-section';

  const header = document.createElement('div');
  header.className = 'sources-header';
  const headerLabel = document.createElement('span');
  headerLabel.className = 'label';
  headerLabel.textContent = sources.length > 1 ? `Sources (${sources.length})` : 'Sources';
  header.appendChild(headerLabel);
  const find = document.createElement('button'); find.type='button';find.className='find-stores';
  find.textContent='Find other stores';find.title='Compare product images and add another store without leaving the popup.';
  find.disabled=!onDiscover;find.addEventListener('click',()=>onDiscover?.(product.id));
  header.appendChild(find);
  section.appendChild(header);
  const discoveryHint = document.createElement('p'); discoveryHint.className = 'hint'; discoveryHint.textContent = 'Search and visually compare other stores, or add a product URL directly.'; section.appendChild(discoveryHint);

  if (sources.length > 0) {
    const list = document.createElement('div');
    list.className = 'source-list';
    const reference = referenceCurrency(product);
    const currencies = [...new Set(sources.map((s) => normalizeCurrency(s.currency) ?? 'Unknown'))].sort((a, b) => a === reference ? -1 : b === reference ? 1 : a.localeCompare(b));
    for (const currency of currencies) {
      const heading = document.createElement('div'); heading.className = 'source-currency-heading';
      heading.textContent = currency === reference ? `${currency} · compared stores` : `${currency} · Not compared`;
      list.appendChild(heading);
      const group = sources.filter((s) => (normalizeCurrency(s.currency) ?? 'Unknown') === currency).sort((a, b) => (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity));
      for (const source of group) list.appendChild(buildSourceItem(source, product, sources.length, onRemoveSource, settings, onRepair));
    }
    section.appendChild(list);
  }

  // Add source form
  const addRow = document.createElement('div');
  addRow.className = 'add-source-row';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://other-store.com/same-product';
  urlInput.className = 'add-source-input';
  urlInput.setAttribute('aria-label', 'Additional store URL');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = '+ Add';
  addBtn.style.flexShrink = '0';

  const errEl = document.createElement('span');
  errEl.className = 'add-source-error';
  errEl.setAttribute('role', 'alert');

  addBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { errEl.textContent = 'Enter an HTTP or HTTPS URL'; urlInput.focus(); return; }
    errEl.textContent = '';
    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    try {
      const resp = await onAddSource(product.id, url);
      if (resp?.error) {
        errEl.textContent = resp.error === 'already_added' ? 'URL already added' : resp.error;
        addBtn.disabled = false;
        addBtn.textContent = '+ Add';
      }
      if (!resp?.error) urlInput.value = '';
    } catch (err) {
      errEl.textContent = err.message || 'Failed to add source';
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = '+ Add';
    }
  });

  addRow.appendChild(urlInput);
  addRow.appendChild(addBtn);
  section.appendChild(addRow);
  section.appendChild(errEl);

  return section;
}

function buildSourceItem(source, product, totalSources, onRemoveSource, settings, onRepair) {
  const item = document.createElement('div');
  item.className = 'source-item' + (source.id === product.bestSourceId ? ' best' : '');

  const left = document.createElement('div');
  left.className = 'source-left';

  const label = document.createElement('a');
  label.className = 'source-label';
  label.textContent = source.label ?? source.url;
  label.title = source.url;
  label.href = applyAffiliate(source.url, settings ?? {});
  label.target = '_blank';
  label.rel = 'noopener noreferrer';
  label.addEventListener('click', (e) => e.stopPropagation());

  const priceEl = document.createElement('span');
  priceEl.className = 'source-price';
  if (source.currentPrice == null) {
    priceEl.textContent = '—';
    priceEl.style.color = 'var(--text-muted)';
  } else {
    priceEl.textContent = normalizeCurrency(source.currency) ? displayPrice(source.currentPrice, source.currency) : `${source.currentPrice} (currency unknown)`;
    if (source.id === product.bestSourceId) {
      priceEl.classList.add('best');
    }
  }

  if (source.inStock === false) {
    const badge = document.createElement('span');
    badge.className = 'badge oos';
    badge.textContent = 'Out of stock';
    priceEl.appendChild(badge);
  } else if (source.inStock === true) {
    const badge = document.createElement('span');
    badge.className = 'badge ins';
    badge.textContent = 'In stock';
    priceEl.appendChild(badge);
  }

  left.appendChild(label);
  left.appendChild(priceEl);
  const health = trackingHealth(source, product.intervalMinutes, product.enabled);
  const status = document.createElement('span'); status.className = `source-health health-${health.state}`; status.textContent = health.label + (source.lastObserved ? ` · ${formatRelativeTime(source.lastObserved)}` : ''); status.title = health.detail; left.appendChild(status);
  item.appendChild(left);
  if (onRepair) {
    const repair = document.createElement('button'); repair.type = 'button'; repair.className = 'source-repair'; repair.textContent = 'Repair'; repair.setAttribute('aria-label', `Repair selector for ${source.label ?? source.url}`);
    repair.addEventListener('click', async () => { repair.disabled = true; try { await onRepair(product.id, source.id); } catch (err) { status.textContent = err.message; } finally { repair.disabled = false; } }); item.appendChild(repair);
  }

  if (totalSources > 1) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'source-remove';
    removeBtn.title = 'Remove this source';
    removeBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4a1 1 0 011 1h2v1H3V3h2a1 1 0 011-1zm7 3H3l.8 9.1A1 1 0 004.8 15h6.4a1 1 0 001-.9L13 5z"/></svg>`;
    removeBtn.setAttribute('aria-label', `Remove source ${source.label ?? source.url}`);
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      try { await onRemoveSource(product.id, source.id); }
      catch (err) {
        const error = document.createElement('span');
        error.className = 'add-source-error'; error.setAttribute('role', 'alert');
        error.textContent = err.message || 'Could not remove source'; item.appendChild(error);
      } finally { removeBtn.disabled = false; }
    });
    item.appendChild(removeBtn);
  }

  return item;
}

function makeDetailImage(product) {
  const img = document.createElement('img');
  img.alt = '';
  if (product.thumbnail) {
    img.src = product.thumbnail;
    img.style.cssText = 'width:108px;height:108px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0;';
  } else {
    try {
      const { hostname } = new URL(product.canonicalUrl ?? product.url);
      img.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
      img.style.cssText = 'width:108px;height:108px;object-fit:contain;padding:20px;box-sizing:border-box;border-radius:6px;border:1px solid var(--border);background:var(--surface);flex-shrink:0;';
    } catch {
      return null;
    }
  }
  img.addEventListener('error', () => img.remove());
  return img;
}

function makePriceStat(label, value, modifier) {
  const stat = document.createElement('div');
  stat.className = 'price-stat';
  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'value' + (modifier ? ` ${modifier}` : '');
  val.textContent = value;
  stat.appendChild(lbl);
  stat.appendChild(val);
  return stat;
}

function makeMetaItem(label, valueOrEl) {
  const item = document.createElement('div');
  item.className = 'meta-item';
  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'value';
  if (typeof valueOrEl === 'string') val.textContent = valueOrEl;
  else val.appendChild(valueOrEl);
  item.appendChild(lbl);
  item.appendChild(val);
  return item;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
