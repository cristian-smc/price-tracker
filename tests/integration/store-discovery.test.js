/** @jest-environment node */
import { jest } from '@jest/globals';
let product;
const offscreen=jest.fn();
jest.unstable_mockModule('../../src/shared/storage.js',()=>({getProduct:async()=>product}));
jest.unstable_mockModule('../../src/background/fetcher.js',()=>({offscreenRequest:offscreen}));
const {discoverStores,analyzeStoreUrl}=await import('../../src/background/store-discovery.js');
function response(url,type='text/html',body='fixture') {const r=new Response(body,{headers:{'content-type':type}});Object.defineProperty(r,'url',{value:url});return r;}
beforeEach(()=>{
  product={id:'p',name:'Camera X100',url:'https://original.example/camera',currency:'USD',referenceCurrency:'USD',sources:[]};
  offscreen.mockReset().mockImplementation(async(type,data)=>{
    if(type==='PARSE_SEARCH_RSS')return {candidates:[{url:'https://store.example/camera',title:'Camera X100'}]};
    if(type==='HASH_PRODUCT_IMAGE')return {hash:null,preview:null};
    return {price:19900,currency:'USD',metadata:{title:'Camera X100',mpn:'X100',isProduct:true,image:null,canonicalUrl:data.url.includes('store.')?'https://different.example/uninspected':null}};
  });
  global.fetch=jest.fn(async(url)=>response(url,url.includes('bing.com')?'application/rss+xml':'text/html'));
});
test('action URL stays bound to inspected page rather than unverified canonical',async()=>{
  const result=await analyzeStoreUrl('p','https://store.example/camera');
  expect(result.candidates[0]).toMatchObject({url:'https://store.example/camera',title:'Camera X100',merchant:'store.example'});
  expect(fetch.mock.calls.every(([,options])=>options.redirect==='error'&&options.credentials==='omit')).toBe(true);
});
test('blocked provider preserves reference and returns manual-fallback warning',async()=>{
  fetch.mockImplementation(async(url)=>{if(url.includes('bing.com'))throw new Error('blocked');return response(url);});
  const result=await discoverStores('p','Camera X100');expect(result.candidates).toEqual([]);expect(result.warnings.join(' ')).toMatch(/paste a store URL/);
});
test('deleted watch never returns candidates to attach to another record',async()=>{
  fetch.mockImplementation(async(url)=>{if(url.includes('store.example'))product=null;return response(url);});
  await expect(analyzeStoreUrl('p','https://store.example/camera')).rejects.toThrow(/deleted/);
});
