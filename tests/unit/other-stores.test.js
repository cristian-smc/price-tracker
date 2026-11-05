import { jest } from '@jest/globals';
import { renderOtherStores } from '../../src/popup/views/other-stores.js';
const tick=()=>new Promise((r)=>setTimeout(r,0));
const product={id:'p',name:'Camera X100',currency:'USD',referenceCurrency:'USD',sources:[]};
const candidate={title:'Camera X100',url:'https://shop.example/camera',merchant:'shop.example',price:19900,currency:'EUR',preview:null,evidence:['MPN agrees'],visual:'Visual comparison unavailable'};
const result={reference:{title:product.name,preview:null},candidates:[candidate],warnings:[],provider:'Bing RSS (best effort)'};
beforeEach(()=>{document.body.innerHTML='';});
test('results stay inside popup and require human confirmation before add',async()=>{
  const onAdd=jest.fn(async()=>({product:{sources:[{url:candidate.url}]}}));
  const view=renderOtherStores({product,onSearch:async()=>result,onAdd});document.body.appendChild(view);
  view.querySelector('.discovery-search').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await tick();
  expect(view.textContent).toContain('Not compared');
  const add=view.querySelector('.discovery-actions button');expect(add.disabled).toBe(true);
  const confirm=view.querySelector('.discovery-confirm input');confirm.checked=true;confirm.dispatchEvent(new Event('change'));add.click();await tick();
  expect(onAdd).toHaveBeenCalledWith(candidate.url);expect(add.textContent).toBe('Already added');expect(add.disabled).toBe(true);
});
test('blocked search preserves manual URL comparison and failed add permits retry',async()=>{
  const view=renderOtherStores({product,onSearch:async()=>{throw new Error('Search blocked');},onAnalyze:async()=>result,onAdd:async()=>{throw new Error('Storage quota');}});document.body.appendChild(view);
  view.querySelector('.discovery-search').dispatchEvent(new Event('submit',{cancelable:true}));await tick();expect(view.textContent).toContain('Search blocked');
  view.querySelector('.discovery-paste input').value=candidate.url;view.querySelector('.discovery-paste form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  const confirm=view.querySelector('.discovery-confirm input');confirm.checked=true;confirm.dispatchEvent(new Event('change'));
  const add=view.querySelector('.discovery-actions button');add.click();await tick();expect(add.disabled).toBe(false);expect(view.textContent).toContain('Storage quota');
});
test('untrusted titles render as text, not markup',async()=>{
  const view=renderOtherStores({product,onSearch:async()=>({...result,candidates:[{...candidate,title:'<img src=x onerror=alert(1)>'}]})});document.body.appendChild(view);
  view.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  expect(view.querySelector('h3').textContent).toBe('<img src=x onerror=alert(1)>');expect(view.querySelector('h3 img')).toBeNull();
});
