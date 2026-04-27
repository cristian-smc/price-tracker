/**
 * Product list view — renders tracked products as clickable cards.
 * Supports: thumbnail, % change badge, search, sort, filter, drag-reorder,
 *           pause-all / resume-all.
 */

import { displayPrice, createWarningBadge } from '../components/currency-badge.js';

/**
 * @param {Record<string, import('../../shared/types').Product>} products
 * @param {{
 *   onSelect: (id:string) => void,
 *   onAdd: () => void,
 *   onPauseAll: () => void,
 *   onResumeAll: () => void,
 *   onReorder: (id:string, newOrder:number) => void,
 *   sortBy?: string,
 *   filterBy?: string,
 * }} handlers
 */
export function renderProductList(products, {
  onSelect, onAdd, onPauseAll, onResumeAll, onCheckAll, onReorder,
  sortBy = 'created', filterBy = 'all',
}) {
  const entries = Object.values(products);

  const wrap = document.createElement('div');

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
      </svg>
      <p><strong>Start tracking prices</strong></p>
      <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Open any product page, then click <strong>+</strong> to add it.<br>PriceWatch will check the price automatically<br>and notify you when it drops.</p>
    `;
    wrap.appendChild(empty);
    return wrap;
  }

  // ── Search bar ─────────────────────────────────────────────────────────────
  const searchBar = document.createElement('div');
  searchBar.className = 'search-bar';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search…';
  searchInput.setAttribute('aria-label', 'Search products');

  const sortSelect = document.createElement('select');
  sortSelect.setAttribute('aria-label', 'Sort by');
  for (const [val, label] of [['created','Newest'],['name','Name'],['price','Price'],['last_checked','Last checked'],['manual','Custom order']]) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === sortBy) opt.selected = true;
    sortSelect.appendChild(opt);
  }

  const filterSelect = document.createElement('select');
  filterSelect.setAttribute('aria-label', 'Filter');
  for (const [val, label] of [['all','All'],['active','Active'],['paused','Paused'],['drop','Below target']]) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === filterBy) opt.selected = true;
    filterSelect.appendChild(opt);
  }

  searchBar.appendChild(searchInput);
  searchBar.appendChild(sortSelect);
  searchBar.appendChild(filterSelect);
  wrap.appendChild(searchBar);

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'list-toolbar';

  const pauseAllBtn = document.createElement('button');
  pauseAllBtn.className = 'btn-sm';
  pauseAllBtn.type = 'button';
  pauseAllBtn.textContent = 'Pause all';
  pauseAllBtn.addEventListener('click', onPauseAll);

  const resumeAllBtn = document.createElement('button');
  resumeAllBtn.className = 'btn-sm';
  resumeAllBtn.type = 'button';
  resumeAllBtn.textContent = 'Resume all';
  resumeAllBtn.addEventListener('click', onResumeAll);

  const checkAllBtn = document.createElement('button');
  checkAllBtn.className = 'btn-sm';
  checkAllBtn.type = 'button';
  checkAllBtn.textContent = 'Check all';
  checkAllBtn.addEventListener('click', async () => {
    checkAllBtn.disabled = true;
    checkAllBtn.textContent = 'Checking…';
    await onCheckAll();
    checkAllBtn.textContent = 'Check all';
    checkAllBtn.disabled = false;
  });

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  toolbar.appendChild(pauseAllBtn);
  toolbar.appendChild(resumeAllBtn);
  toolbar.appendChild(checkAllBtn);
  toolbar.appendChild(spacer);
  wrap.appendChild(toolbar);

  // ── List ───────────────────────────────────────────────────────────────────
  const list = document.createElement('div');
  list.className = 'product-list';
  wrap.appendChild(list);

  // Reactive render on search/sort/filter changes
  const renderList = () => {
    list.innerHTML = '';
    const query = searchInput.value.toLowerCase();
    const sort  = sortSelect.value;
    const filter = filterSelect.value;

    let filtered = entries.filter((p) => {
      if (query && !p.name.toLowerCase().includes(query) && !p.url.toLowerCase().includes(query)) return false;
      if (filter === 'active') return p.enabled;
      if (filter === 'paused') return !p.enabled;
      if (filter === 'drop') return p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice;
      return true;
    });

    filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'price') return (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity);
      if (sort === 'last_checked') return (b.lastChecked ?? 0) - (a.lastChecked ?? 0);
      if (sort === 'manual') return (b.sortOrder ?? b.createdAt) - (a.sortOrder ?? a.createdAt);
      return b.createdAt - a.createdAt; // default: newest first
    });

    for (const p of filtered) {
      list.appendChild(buildCard(p, onSelect, onReorder));
    }
  };

  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);
  filterSelect.addEventListener('change', renderList);

  renderList();
  return wrap;
}

function buildCard(p, onSelect, onReorder) {
  const card = document.createElement('div');
  card.className = 'product-card' + (p.enabled ? '' : ' paused');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.dataset.id = p.id;
  card.dataset.sortOrder = p.sortOrder ?? p.createdAt;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  // Thumbnail → site favicon fallback → placeholder SVG
  const thumbImg = document.createElement('img');
  thumbImg.className = 'thumb';
  thumbImg.alt = '';
  thumbImg.loading = 'lazy';
  if (p.thumbnail) {
    thumbImg.src = p.thumbnail;
    thumbImg.addEventListener('error', () => { thumbImg.replaceWith(makeThumbnailPlaceholder()); });
  } else {
    try {
      const { hostname } = new URL(p.canonicalUrl ?? p.url);
      thumbImg.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
      thumbImg.style.cssText = 'object-fit:contain;padding:10px;background:var(--surface);box-sizing:border-box;';
      thumbImg.addEventListener('error', () => { thumbImg.replaceWith(makeThumbnailPlaceholder()); });
    } catch {
      inner.appendChild(makeThumbnailPlaceholder());
    }
  }
  if (thumbImg.src) inner.appendChild(thumbImg);

  const body = document.createElement('div');
  body.className = 'card-body';

  const checkStock = p.checkStockEnabled !== false;
  const isPriceDrop = p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice && (checkStock ? p.inStock !== false : true);
  const priceStr = displayPrice(p.currentPrice, p.currency);

  // Row 1: name + price
  const row1 = document.createElement('div');
  row1.className = 'row1';

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = p.name;
  nameEl.title = p.name;

  const priceEl = document.createElement('span');
  priceEl.className = 'price' + (isPriceDrop ? ' drop' : '');
  priceEl.textContent = priceStr;

  row1.appendChild(nameEl);
  row1.appendChild(priceEl);
  body.appendChild(row1);

  body.appendChild(makeRow2(p));
  inner.appendChild(body);

  // Drag handle
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.innerHTML = `<svg viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="4" r="1.2"/><circle cx="8" cy="4" r="1.2"/><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="8" cy="12" r="1.2"/></svg>`;
  handle.addEventListener('mousedown', (e) => {
    // Only initiate drag from handle
    card.setAttribute('draggable', 'true');
    e.stopPropagation();
  });
  handle.addEventListener('click', (e) => e.stopPropagation());

  card.appendChild(inner);
  card.appendChild(handle);

  // Click/keyboard to select
  const select = () => onSelect(p.id);
  card.addEventListener('click', select);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') select(); });

  // Drag events for reordering
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.setAttribute('draggable', 'false');
    card.classList.remove('dragging');
    document.querySelectorAll('.product-card').forEach((el) => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    card.classList.toggle('drag-over-top', isTop);
    card.classList.toggle('drag-over-bottom', !isTop);
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over-top', 'drag-over-bottom');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === p.id) return;

    const rect = card.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const targetOrder = p.sortOrder ?? p.createdAt;

    // Use midpoint between adjacent cards so sortOrders never collide.
    // The list is sorted descending, so previousElementSibling has a higher
    // sortOrder (appears above) and nextElementSibling has a lower sortOrder.
    let newOrder;
    if (insertBefore) {
      let prev = card.previousElementSibling;
      while (prev?.dataset.id === draggedId) prev = prev.previousElementSibling;
      const prevOrder = prev ? Number.parseFloat(prev.dataset.sortOrder) : targetOrder + 2;
      newOrder = (prevOrder + targetOrder) / 2;
    } else {
      let next = card.nextElementSibling;
      while (next?.dataset.id === draggedId) next = next.nextElementSibling;
      const nextOrder = next ? Number.parseFloat(next.dataset.sortOrder) : targetOrder - 2;
      newOrder = (targetOrder + nextOrder) / 2;
    }

    onReorder(draggedId, newOrder);
  });

  return card;
}

function makeThumbnailPlaceholder() {
  const el = document.createElement('div');
  el.className = 'thumb-placeholder';
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>`;
  return el;
}

function makePctBadge(p) {
  if (p.initialPrice == null || p.currentPrice == null || p.initialPrice === 0) return null;
  const pct = ((p.currentPrice - p.initialPrice) / p.initialPrice) * 100;
  const badge = document.createElement('span');
  let pctClass = 'pct-same';
  if (pct < -0.5) pctClass = 'pct-down';
  else if (pct > 0.5) pctClass = 'pct-up';
  badge.className = `badge ${pctClass}`;
  badge.textContent = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
  badge.title = 'Change since first tracked';
  return badge;
}

function makeRow2(p) {
  const row2 = document.createElement('div');
  row2.className = 'row2';

  const pctBadge = makePctBadge(p);
  if (pctBadge) row2.appendChild(pctBadge);

  const checkStock = p.checkStockEnabled !== false;
  const isPriceDrop = p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice && (checkStock ? p.inStock !== false : true);
  if (checkStock) {
    if (p.inStock === false) {
      const oos = document.createElement('span');
      oos.className = 'badge oos';
      oos.textContent = 'Out of stock';
      oos.title = 'Currently out of stock — price drop notifications paused';
      row2.appendChild(oos);
    } else if (p.inStock === true) {
      const ins = document.createElement('span');
      ins.className = 'badge ins';
      ins.textContent = 'In stock';
      ins.title = 'In stock';
      row2.appendChild(ins);
    }
  }
  if (p.targetPrice !== null) {
    const target = document.createElement('span');
    target.title = 'Target price';
    target.textContent = `↓ ${displayPrice(p.targetPrice, p.currency)}`;
    target.style.color = isPriceDrop ? 'var(--success)' : 'var(--text-muted)';
    row2.appendChild(target);
  }

  if (p.lastChecked) {
    const when = document.createElement('span');
    when.textContent = formatRelativeTime(p.lastChecked);
    row2.appendChild(when);
  }

  if (p.consecutiveErrors >= 3) {
    row2.appendChild(createWarningBadge('error', p.consecutiveErrors));
  } else if (p.consecutiveNulls >= 2) {
    row2.appendChild(createWarningBadge('drift', p.consecutiveNulls));
  }

  return row2;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
