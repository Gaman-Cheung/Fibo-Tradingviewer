import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReversePickup, reversePickupRailPosition } from '../../src/apps/reverse-pickup-widget.js';

test('Reverse Pickup calculates three temporary retracement levels',()=>{
  const result=calculateReversePickup({anchor:80,close:100,current:90});
  assert.deepEqual(result.levels,{level382:92.36,level500:90,level618:87.64});
  assert.equal(result.zone.label,'接近主计划价');
});

test('Reverse Pickup rejects invalid anchor ranges without persistence',()=>{
  assert.equal(calculateReversePickup({anchor:100,close:100}),null);
  assert.equal(calculateReversePickup({anchor:'',close:100}),null);
  assert.equal(calculateReversePickup({anchor:80,close:100,current:''}).current,null);
});

test('Reverse Pickup places current price on the fixed anchor-to-close rail',()=>{
  assert.deepEqual(reversePickupRailPosition({anchor:30,close:32,current:31}),{percent:50,rawPercent:50,state:'inside',label:'区间内'});
  assert.equal(reversePickupRailPosition({anchor:30,close:32,current:48}).state,'above');
  assert.equal(reversePickupRailPosition({anchor:30,close:32,current:48}).percent,100);
  assert.equal(reversePickupRailPosition({anchor:30,close:32,current:28}).state,'below');
  assert.equal(reversePickupRailPosition({anchor:30,close:32,current:28}).percent,0);
});
