/**
 * Product detail view — sparkline chart + full history + actions.
 *
 * @param {{
 *   product: import('../../shared/types').Product,
 *   history: import('../../shared/types').HistoryPoint[],
 *   onBack: () => void,
 *   onEdit: (id: string) => void,
 *   onDelete: (id: string) => void,
 *   onCheckNow: (id: string) => void,
 *   onToggleEnabled: (id: string, enabled: boolean) => void,
 * }} opts
 */

import { displayPrice, createStockBadge } from '../components/currency-badge.js';
import { renderSparkline } from '../components/sparkline.js';

export function renderProductDetail({
  product,
  history,
  onBack,
  onEdit,
  onDelete,
  onCheckNow,
  onToggleEnabled,
}) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-view';

  // ── Back button ───────────────────────────────────────────────────────────
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1L5 8l6 7"/></svg> Back`;
  backBtn.addEventListener('click', onBack);
  wrap.appendChild(backBtn);

  // ── Name ──────────────────────────────────────────────────────────────────
  const nameEl = document.createElement('h2');
  nameEl.textContent = product.name;
  nameEl.title = product.name;
  wrap.appendChild(nameEl);

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

  wrap.appendChild(priceRow);

  // ── Sparkline ─────────────────────────────────────────────────────────────
  const chartContainer = document.createElement('div');
  chartContainer.className = 'sparkline-container';
  const sparkline = renderSparkline(history, { width: 340, height: 64 });
  chartContainer.appendChild(sparkline);
  wrap.appendChild(chartContainer);

  // ── Meta grid ─────────────────────────────────────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'meta-grid';

  meta.appendChild(makeMetaItem('Stock', createStockBadge(product.currentStock ?? 'unknown')));
  meta.appendChild(makeMetaItem('Check interval', `Every ${product.intervalMinutes} min`));
  meta.appendChild(makeMetaItem('Last checked', product.lastChecked ? formatDate(product.lastChecked) : '—'));
  meta.appendChild(makeMetaItem('History points', String(history.length)));

  if (product.consecutiveErrors > 0) {
    meta.appendChild(makeMetaItem('Errors', `${product.consecutiveErrors} consecutive`));
  }

  wrap.appendChild(meta);

  // ── URL ───────────────────────────────────────────────────────────────────
  const urlWrap = document.createElement('div');
  urlWrap.className = 'field';
  const urlLabel = document.createElement('span');
  urlLabel.className = 'field label';
  urlLabel.style.fontSize = '11px'; urlLabel.style.color = 'var(--text-muted)';
  urlLabel.textContent = 'URL';
  const urlLink = document.createElement('a');
  urlLink.href = product.url;
  urlLink.target = '_blank';
  urlLink.rel = 'noopener noreferrer';
  urlLink.style.cssText = 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:var(--accent)';
  urlLink.textContent = product.url;
  urlLink.title = product.url;
  urlWrap.appendChild(urlLabel);
  urlWrap.appendChild(urlLink);
  wrap.appendChild(urlWrap);

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

function formatDate(ts) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts));
}
