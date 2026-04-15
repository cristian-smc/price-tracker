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
 * }} opts
 */

import { displayPrice } from '../components/currency-badge.js';
import { renderSparkline } from '../components/sparkline.js';
import { applyAffiliate } from '../../shared/affiliate.js';

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
  onAddSource,
  onRemoveSource,
}) {
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
  headerRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  if (product.thumbnail) {
    const img = document.createElement('img');
    img.src = product.thumbnail;
    img.alt = '';
    img.style.cssText = 'width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--border);flex-shrink:0;';
    headerRow.appendChild(img);
  }
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
  priceBig.textContent = displayPrice(product.currentPrice, product.currency);
  priceRow.appendChild(priceBig);

  if (product.targetPrice !== null) {
    const target = document.createElement('span');
    target.className = 'price-target';
    target.textContent = `Target: ${displayPrice(product.targetPrice, product.currency)}`;
    priceRow.appendChild(target);
  }

  if (product.sellThreshold != null) {
    const sell = document.createElement('span');
    sell.className = 'price-target';
    sell.textContent = `Sell: ${displayPrice(product.sellThreshold, product.currency)}`;
    sell.style.color = 'var(--warning)';
    priceRow.appendChild(sell);
  }

  wrap.appendChild(priceRow);

  // ── Price stats (initial / lowest / highest) ──────────────────────────────
  if (product.initialPrice != null || product.lowestPrice != null || product.highestPrice != null) {
    const stats = document.createElement('div');
    stats.className = 'price-stats';

    if (product.initialPrice != null) {
      stats.appendChild(makePriceStat('Initial', displayPrice(product.initialPrice, product.currency), ''));
    }
    if (product.lowestPrice != null) {
      stats.appendChild(makePriceStat('Lowest', displayPrice(product.lowestPrice, product.currency), 'low'));
    }
    if (product.highestPrice != null) {
      stats.appendChild(makePriceStat('Highest', displayPrice(product.highestPrice, product.currency), 'high'));
    }
    wrap.appendChild(stats);
  }

  // ── Sparkline ─────────────────────────────────────────────────────────────
  const chartContainer = document.createElement('div');
  chartContainer.className = 'sparkline-container';
  chartContainer.appendChild(renderSparkline(history, { width: 340, height: 64, currency: product.currency ?? 'USD' }));
  wrap.appendChild(chartContainer);

  // ── Meta grid ─────────────────────────────────────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'meta-grid';

  meta.appendChild(makeMetaItem('Check interval', `Every ${product.intervalMinutes} min`));
  meta.appendChild(makeMetaItem('Last checked', product.lastChecked ? formatRelativeTime(product.lastChecked) : '—'));
  meta.appendChild(makeMetaItem('History points', String(history.length)));

  if (product.consecutiveErrors > 0) {
    meta.appendChild(makeMetaItem('Errors', `${product.consecutiveErrors} consecutive`));
  }

  wrap.appendChild(meta);

  // ── URL + copy button ─────────────────────────────────────────────────────
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
    navigator.clipboard.writeText(product.canonicalUrl ?? product.url).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 011-1h8"/></svg> Copy`;
      }, 1500);
    });
  });

  urlHeader.appendChild(urlLabel);
  urlHeader.appendChild(copyBtn);

  const urlLink = document.createElement('a');
  urlLink.href = applyAffiliate(product.canonicalUrl ?? product.url, settings ?? {});
  urlLink.target = '_blank';
  urlLink.rel = 'noopener noreferrer';
  urlLink.style.cssText = 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:var(--accent)';
  urlLink.textContent = product.canonicalUrl ?? product.url;
  urlLink.title = product.canonicalUrl ?? product.url;

  urlWrap.appendChild(urlHeader);
  urlWrap.appendChild(urlLink);
  wrap.appendChild(urlWrap);

  // ── Sources ───────────────────────────────────────────────────────────────
  const sources = product.sources ?? [];
  wrap.appendChild(buildSourcesSection(product, sources, onAddSource, onRemoveSource, settings));

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
  notifInput.addEventListener('change', () => onToggleNotification(product.id, notifInput.checked));
  const notifSlider = document.createElement('span');
  notifSlider.className = 'toggle-slider';
  notifLabel2.appendChild(notifInput);
  notifLabel2.appendChild(notifSlider);
  notifRow.appendChild(notifLabel);
  notifRow.appendChild(notifLabel2);
  wrap.appendChild(notifRow);

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const checkBtn = document.createElement('button');
  checkBtn.className = 'btn btn-primary';
  checkBtn.textContent = 'Check now';
  checkBtn.addEventListener('click', () => {
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<span class="spinner"></span> Checking…';
    onCheckNow(product.id);
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => onEdit(product.id));

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn btn-secondary';
  toggleBtn.textContent = product.enabled ? 'Pause' : 'Resume';
  toggleBtn.addEventListener('click', () => onToggleEnabled(product.id, !product.enabled));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Stop tracking "${product.name}"?`)) {
      onDelete(product.id);
    }
  });

  actions.appendChild(checkBtn);
  actions.appendChild(editBtn);
  actions.appendChild(toggleBtn);
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);

  return wrap;
}

// ── Sources section ───────────────────────────────────────────────────────────

function buildSourcesSection(product, sources, onAddSource, onRemoveSource, settings) {
  const section = document.createElement('div');
  section.className = 'sources-section';

  const header = document.createElement('div');
  header.className = 'sources-header';
  const headerLabel = document.createElement('span');
  headerLabel.className = 'label';
  headerLabel.textContent = sources.length > 1 ? `Sources (${sources.length})` : 'Sources';
  header.appendChild(headerLabel);
  section.appendChild(header);

  if (sources.length > 0) {
    const list = document.createElement('div');
    list.className = 'source-list';
    for (const source of sources) {
      list.appendChild(buildSourceItem(source, product, sources.length, onRemoveSource, settings));
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

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = '+ Add';
  addBtn.style.flexShrink = '0';

  const errEl = document.createElement('span');
  errEl.className = 'add-source-error';

  addBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    try { new URL(url); } catch { errEl.textContent = 'Invalid URL'; return; }
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
    } catch {
      errEl.textContent = 'Failed to add source';
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

function buildSourceItem(source, product, totalSources, onRemoveSource, settings) {
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
    priceEl.textContent = displayPrice(source.currentPrice, source.currency ?? product.currency);
    if (source.id === product.bestSourceId) {
      priceEl.classList.add('best');
    }
  }

  left.appendChild(label);
  left.appendChild(priceEl);
  item.appendChild(left);

  if (totalSources > 1) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'source-remove';
    removeBtn.title = 'Remove this source';
    removeBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4a1 1 0 011 1h2v1H3V3h2a1 1 0 011-1zm7 3H3l.8 9.1A1 1 0 004.8 15h6.4a1 1 0 001-.9L13 5z"/></svg>`;
    removeBtn.addEventListener('click', () => onRemoveSource(product.id, source.id));
    item.appendChild(removeBtn);
  }

  return item;
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
