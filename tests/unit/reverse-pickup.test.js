import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReversePickup } from '../../src/apps/reverse-pickup-widget.js';

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
