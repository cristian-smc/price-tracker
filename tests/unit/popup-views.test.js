import { jest } from '@jest/globals';
import { renderAddProduct } from '../../src/popup/views/add-product.js';
import { renderProductList } from '../../src/popup/views/product-list.js';
import { renderProductDetail } from '../../src/popup/views/product-detail.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const p = { id: 'p1', name: 'Widget', url: 'https://example.com/item', enabled: true, currency: 'JPY', targetPrice: 15000,
  sellThreshold: 20000, currentPrice: 14000, intervalMinutes: 60, createdAt: 1, sources: [{ id: 's1', url: 'https://example.com/item', selectors: { price: '.new' } }] };
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
beforeEach(() => { document.body.innerHTML = ''; global.chrome = { runtime: { id: 'test' } }; });
test('new form honors saved defaults and submits using their currency', async () => {
  let submitted;
  const view = renderAddProduct({ settings: { defaultInterval: 60, defaultCurrency: 'JPY' }, prefillUrl: p.url, prefillName: p.name, onSave: async (data) => { submitted = data; } });
  document.body.append(view);
  expect(view.querySelector('select').value).toBe('60');
  view.querySelector('#field-targetPrice').value = '15000';
  button(view, 'Start tracking').click(); await tick();
  expect(submitted).toMatchObject({ targetPrice: 15000, currency: 'JPY', intervalMinutes: 60 });
});
test('JPY edit preserves threshold units and reads the primary source selector', async () => {
  let submitted;
  const view = renderAddProduct({ product: p, onSave: async (data) => { submitted = data; } });
  document.body.append(view);
  expect(view.querySelector('#field-targetPrice').value).toBe('15000');
  expect(view.querySelector('#field-selector').value).toBe('.new');
  button(view, 'Save').click(); await tick();
  expect(submitted).toMatchObject({ targetPrice: 15000, sellThreshold: 20000 });
});
test('submit awaits save, prevents duplicates, preserves fields and permits retry', async () => {
  let reject;
  const onSave = jest.fn(() => new Promise((_resolve, r) => { reject = r; }));
  const view = renderAddProduct({ prefillUrl: p.url, prefillName: p.name, onSave });
  document.body.append(view);
  const form = view.matches('form') ? view : view.querySelector('form');
  expect(form).not.toBeNull();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(button(view, 'Saving').disabled).toBe(true);
  reject(new Error('Already tracked')); await tick();
  expect(view.querySelector('[role="alert"]').textContent).toContain('Already tracked');
  expect(view.querySelector('#field-url').value).toBe(p.url);
  expect(button(view, 'Start tracking').disabled).toBe(false);
});
test('invalid product protocol focuses URL and never submits', () => {
  const onSave = jest.fn();
  const view = renderAddProduct({ prefillUrl: 'file:///tmp/product', prefillName: 'Widget', onSave });
  document.body.append(view); button(view, 'Start tracking').click();
  expect(onSave).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(view.querySelector('#field-url'));
});
test('list retains query and reports/reset no matches', () => {
  let state;
  const view = renderProductList({ p1: p }, { sortBy: 'name', filterBy: 'active', searchQuery: 'missing', onStateChange: (s) => { state = s; } });
  document.body.append(view);
  expect(view.querySelector('input').value).toBe('missing');
  expect(view.textContent).toContain('No matching products');
  button(view, 'Clear filters').click();
  expect(view.querySelectorAll('.product-card')).toHaveLength(1);
  expect(state).toMatchObject({ searchQuery: '', filterBy: 'all' });
});
test('list bulk action recovers controls after failure', async () => {
  const view = renderProductList({ p1: p }, { onCheckAll: async () => { throw new Error('Quota exceeded'); } });
  document.body.append(view);
  button(view, 'Check all').click(); await tick();
  expect(button(view, 'Check all').disabled).toBe(false);
  expect(view.querySelector('[role="alert"]').textContent).toContain('Quota exceeded');
});
test('card metadata spans beneath the picture and name-price area', () => {
  const view=renderProductList({p1:p},{});
  const open=view.querySelector('.card-open');
  expect(open.querySelector('.card-body .row2')).toBeNull();
  expect(open.querySelector(':scope > .row2')).not.toBeNull();
});

test('card delete confirms and never opens product details', async () => {
  const onSelect = jest.fn(); const onDelete = jest.fn(async () => {});
  global.confirm = jest.fn(() => false);
  const view = renderProductList({ p1: p }, { onSelect, onDelete });
  document.body.append(view);
  const remove = view.querySelector('.card-delete');
  expect(remove.getAttribute('aria-label')).toBe('Delete Widget');
  remove.click(); await tick(); expect(onDelete).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); remove.click(); await tick();
  expect(onDelete).toHaveBeenCalledWith('p1'); expect(onSelect).not.toHaveBeenCalled();
  expect(remove.disabled).toBe(false);
});

test('Space opens a product card without scrolling', () => {
  const onSelect = jest.fn();
  const view = renderProductList({ p1: p }, { onSelect });
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  view.querySelector('.card-open').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(onSelect).toHaveBeenCalledWith('p1');
});

test.each(['created', 'name', 'price', 'last_checked', 'manual'])('below-target products lead the list with sort=%s', (sortBy) => {
  const fresh = { ...p, referenceCurrency: 'JPY', lastObserved: Date.now(), checkStatus: 'ok', inStock: true };
  const entries = {
    above: { ...fresh, id:'above', name:'A above', currentPrice:20000, createdAt:300, sortOrder:300, lastChecked:300 },
    first: { ...fresh, id:'first', name:'B deal', currentPrice:10000, createdAt:200, sortOrder:200, lastChecked:200 },
    second: { ...fresh, id:'second', name:'C deal', currentPrice:12000, createdAt:100, sortOrder:100, lastChecked:100 },
  };
  const view = renderProductList(entries, { sortBy });
  expect([...view.querySelectorAll('.product-card')].map((card)=>card.dataset.id)).toEqual(['first','second','above']);
});

test('empty organization filters stay hidden',()=>{
  const view=renderProductList({p1:p},{});
  expect(view.querySelector('[aria-label="Filter by group"]').hidden).toBe(true);
  expect(view.querySelector('[aria-label="Filter by tag"]').hidden).toBe(true);
});
test('groups and tags participate in search and filtering',()=>{
  const view=renderProductList({p1:{...p,group:'Electronics',tags:['gift']},p2:{...p,id:'p2',group:'Home',tags:['home']}},{searchQuery:'gift'});
  expect(view.querySelectorAll('.product-card')).toHaveLength(1);
  const search=view.querySelector('input'); search.value=''; search.dispatchEvent(new Event('input'));
  const group=view.querySelector('[aria-label="Filter by group"]'); group.value='Home'; group.dispatchEvent(new Event('change'));
  expect(view.querySelectorAll('.product-card')).toHaveLength(1); expect(view.querySelector('.product-card').dataset.id).toBe('p2');
});
test('other-store link opens Google Shopping while retaining manual source input',()=>{
  const view=renderProductDetail({product:p,history:[],settings:{}});
  const link=view.querySelector('a.find-stores');
  expect(link.target).toBe('_blank');
  expect(link.rel).toContain('noopener');
  expect(new URL(link.href).hostname).toBe('www.google.com');
  expect(new URL(link.href).searchParams.get('tbm')).toBe('shop');
  expect(new URL(link.href).searchParams.get('q')).toBe(p.name);
  expect(view.querySelector('.add-source-input')).not.toBeNull();
});

test('older history remains visible without being silently discarded',()=>{
  const view=renderProductDetail({product:p,history:[{ts:100,price:15000},{ts:200,price:14000}],settings:{}});
  expect(view.textContent).not.toContain('Earlier history');
  expect(view.querySelectorAll('.sparkline-container')).toHaveLength(1);
  expect(view.querySelector('.sparkline-container svg')).not.toBeNull();
});
test('source rows preserve currency warnings without manual repair controls',()=>{
  const view=renderProductDetail({product:{...p,referenceCurrency:'JPY',sources:[{id:'one',url:p.url,currency:'JPY',currentPrice:14000},{id:'two',url:'https://other.example',currency:'USD',currentPrice:100}]},history:[],settings:{},onRepair:()=>{}});
  expect(view.textContent).toContain('USD · Not compared'); expect(view.querySelectorAll('.source-repair')).toHaveLength(0);
  expect(view.textContent).not.toContain('Repair price selector');
});

test('detail check recovers controls and announces error', async () => {
  const view = renderProductDetail({ product: p, history: [], settings: {}, onCheckNow: async () => { throw new Error('Offline'); } });
  document.body.append(view); button(view, 'Check now').click(); await tick();
  expect(button(view, 'Check now').disabled).toBe(false);
  expect(view.querySelector('[role="alert"]').textContent).toContain('Offline');
  expect(view.querySelector('input[type="checkbox"]').getAttribute('aria-label')).toBeTruthy();
});
