import { normalizeOrganization, trackingHealth, referenceCurrency, isComparablePrice, compareWatchPrices, trustedHistory, companionProduct } from '../../src/shared/product-state.js';
test('organization trims/deduplicates without losing valid Unicode tags', () => {
  expect(normalizeOrganization({group:' Electronics ',tags:[' Gift ','gift','🏷️','']})).toEqual({group:'Electronics',tags:['Gift','🏷️']});
  expect(()=>normalizeOrganization({tags:Array.from({length:9},(_,i)=>String(i))})).toThrow(/8/);
  expect(()=>normalizeOrganization({group:'x'.repeat(41)})).toThrow(/40/);
  expect(()=>normalizeOrganization({tags:'not-array'})).toThrow();
});
test('health distinguishes stale/error/unknown/paused from fresh observations', () => {
  const now=1800000;
  expect(trackingHealth({lastObserved:now-1000},15,true,now).state).toBe('healthy');
  expect(trackingHealth({lastObserved:1},5,true,now).state).toBe('stale');
  expect(trackingHealth({currentPrice:100,lastChecked:now},15,true,now).state).toBe('unknown');
  expect(trackingHealth({checkStatus:'no_price'},15,true,now).state).toBe('repair');
  expect(trackingHealth({disabledReason:'errors'},15,false,now).state).toBe('repair');
  expect(trackingHealth({},15,false,now).state).toBe('paused');
});
test('currency safety excludes wrong units and filters unverified historical points', () => {
  const p={currency:'USD',referenceCurrency:'USD',currentPrice:100,lastObserved:Date.now(),checkStatus:'ok'};
  expect(isComparablePrice(p)).toBe(true); expect(isComparablePrice({...p,currency:'EUR'})).toBe(false);
  expect(compareWatchPrices({...p,currency:'USD',referenceCurrency:'USD',currentPrice:1},{currency:'EUR',currentPrice:100000})).toBeGreaterThan(0);
  expect(trustedHistory(p,[{ts:1,price:100},{ts:2,price:200,currency:'EUR'},{ts:3,price:300,currency:'USD'}])).toEqual([{ts:3,price:300,currency:'USD'}]);
  expect(referenceCurrency({...p,currency:'EUR'})).toBe('USD');
});
test('companion export selects matching URL/selector while keeping reference',()=>{
  const p={id:'p',name:'Watch',currency:'USD',referenceCurrency:'USD',bestSourceId:'second',sources:[{id:'first',url:'https://one.example',selectors:{price:'.one'}},{id:'second',url:'https://two.example',selectors:{price:'.two'}}]};
  expect(companionProduct(p)).toMatchObject({url:'https://two.example',priceSelector:'.two',currency:'USD',referenceCurrency:'USD'});
});
