import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_CONTEXT_CACHE_TTL_MS,
  createMarketContextRefreshCoalescer,
  isMarketContextCacheStale,
  marketContextCacheStamp,
  shanghaiDayKey,
} from '../../src/apps/market-context-cache.js';

test('Market Context cache uses a five-minute boundary and never mutates its entry',()=>{
  const loaded=Date.parse('2026-08-18T10:00:00Z');
  const entry={ payload:{date:'2026-08-18'},...marketContextCacheStamp(loaded) };
  const before=structuredClone(entry);
  assert.equal(MARKET_CONTEXT_CACHE_TTL_MS,300000);
  assert.equal(isMarketContextCacheStale(entry,loaded+299999),false);
  assert.equal(isMarketContextCacheStale(entry,loaded+300000),true);
  assert.deepEqual(entry,before);
});

test('Market Context cache expires across the Shanghai day boundary',()=>{
  const beforeMidnight=Date.parse('2026-08-18T15:59:59Z');
  const afterMidnight=Date.parse('2026-08-18T16:00:01Z');
  const entry={...marketContextCacheStamp(beforeMidnight)};
  assert.equal(shanghaiDayKey(beforeMidnight),'2026-08-18');
  assert.equal(shanghaiDayKey(afterMidnight),'2026-08-19');
  assert.equal(isMarketContextCacheStale(entry,afterMidnight),true);
});

test('focus and visibility refresh requests coalesce into one callback',()=>{
  let callbackCount=0;
  let scheduled=null;
  let timerCount=0;
  const coalescer=createMarketContextRefreshCoalescer(()=>{callbackCount+=1;},{
    setTimer(callback){timerCount+=1;scheduled=callback;return timerCount;},
    clearTimer(){scheduled=null;},
  });
  coalescer.request();
  coalescer.request();
  assert.equal(timerCount,1);
  assert.equal(callbackCount,0);
  scheduled();
  assert.equal(callbackCount,1);
  coalescer.request();
  assert.equal(timerCount,2);
  coalescer.cancel();
});
