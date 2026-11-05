import { normalizeCandidateUrl, compareIdentity, compareVisual, hashDistance } from '../../src/shared/discovery.js';
import { parseSearchRss, extractProductMetadata, imageDimensions, hashProductImage } from '../../src/offscreen/discovery-tools.js';
test('candidate URLs reject executable/private/credential targets and preserve variants',()=>{
  for(const url of ['javascript:alert(1)','http://localhost/a','http://localhost.:8080/a','http://127.0.0.1/a','http://10.0.0.1/a','https://user:pass@store.example/a','http://[::1]/a'])expect(normalizeCandidateUrl(url)).toBeNull();
  expect(normalizeCandidateUrl('https://store.example/p?variant=red&utm_source=test#price')).toBe('https://store.example/p?variant=red');
});
test('RSS keeps real candidate links, deduplicates and rejects a challenge',()=>{
  const xml='<rss><channel><item><title>Camera</title><link>https://shop.example/camera</link></item><item><link>https://shop.example/camera#x</link></item><item><link>javascript:alert(1)</link></item><item><link>https://www.bing.com/other</link></item></channel></rss>';
  expect(parseSearchRss(xml).candidates).toEqual([{url:'https://shop.example/camera',title:'Camera',snippet:''}]);
  expect(()=>parseSearchRss('<html>Verify you are human</html>')).toThrow(/blocked|unavailable/);
});
test('metadata extracts product identity and relative thumbnail',()=>{
  const doc=new DOMParser().parseFromString('<script type="application/ld+json">{"@type":"Product","name":"Camera X100","mpn":"X100","gtin13":"1234567890123","brand":{"name":"Acme"},"image":"/camera.png"}</script><link rel="canonical" href="/camera">','text/html');
  expect(extractProductMetadata(doc,'https://shop.example/path')).toMatchObject({title:'Camera X100',brand:'Acme',mpn:'X100',image:'https://shop.example/camera.png',canonicalUrl:'https://shop.example/camera',isProduct:true});
});
test('identifier and explicit variant conflicts are warning evidence, not fake certainty',()=>{
  expect(compareIdentity({title:'Phone X100 128GB',mpn:'X100'},{title:'Phone X200 256GB',mpn:'X200'})).toMatchObject({conflict:true,rank:-5});
  expect(compareIdentity({title:'Phone X100',mpn:'X100'},{title:'Phone X100',mpn:'X100'}).evidence).toContain('MPN agrees');
});
test('oversized compressed image header is rejected before decoding',async()=>{
  const bytes=new Uint8Array(24);const view=new DataView(bytes.buffer);
  view.setUint32(0,0x89504e47);view.setUint32(4,0x0d0a1a0a);view.setUint32(12,0x49484452);view.setUint32(16,8192);view.setUint32(20,8192);
  expect(imageDimensions(bytes,'image/png')).toEqual([8192,8192]);
  let decoded=false;global.createImageBitmap=async()=>{decoded=true;throw new Error('should not decode');};
  expect(await hashProductImage({base64:btoa(String.fromCharCode(...bytes)),mime:'image/png'})).toEqual({hash:null,preview:null});
  expect(decoded).toBe(false);delete global.createImageBitmap;
});
test('visual evidence never claims identity and missing hashes stay unknown',()=>{
  const hash='01'.repeat(32);
  expect(hashDistance(hash,hash)).toBe(0);
  expect(compareVisual({hash},{hash}).label).toMatch(/not identity proof/);
  expect(compareVisual({hash},{hash:'10'.repeat(32)}).label).toMatch(/different/);
  expect(compareVisual({hash:null},{hash}).label).toBe('Visual comparison unavailable');
});
