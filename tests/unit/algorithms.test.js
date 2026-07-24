import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoPlan, getStopCandidates, movePct } from '../../src/terminal/fibonacci.js';
import { calculateTechnicalScore, classifyCompositeSignal } from '../../src/terminal/composite-signal.js';
import { buildWaveModel } from '../../src/wave/wave-model.js';

test('Fibonacci plan preserves current target and stop rules', () => {
  const plan = getAutoPlan(100, 50, 70);
  assert.equal(plan.stage, 'recovery');
  assert.equal(plan.support.price, 69.1);
  assert.equal(plan.t1.price, 75);
  assert.equal(plan.t2.price, 100);
  assert.equal(movePct(75, 50), 50);
  const stops = getStopCandidates(plan, 70, 50);
  assert.ok(Math.abs(stops.structure.price - 60.3965) < 1e-9);
  assert.equal(stops.structure.tooWide, true);
  assert.equal(stops.fixed5.price, 66.5);
});

test('Composite Signal scoring and execution gates remain separate', () => {
  const score = calculateTechnicalScore({
    trend:'downtrend', rsi:25, macd:'divergence', previous:100,
    volumeRatio:2.5, current:99, high:120, levels:{'38.2%':105}, fiboScore:4
  });
  assert.deepEqual(
    { trend:score.trendScore, momentum:score.momentumScore, volume:score.volumeScore, total:score.totalScore },
    { trend:-3, momentum:3, volume:-2, total:2 }
  );
  assert.equal(classifyCompositeSignal({ structureBroken:false, totalScore:2 }), 'Watch');
  assert.equal(classifyCompositeSignal({ structureBroken:false, totalScore:6, hasEntry:false }), 'Wait Better Entry');
  assert.equal(classifyCompositeSignal({ structureBroken:false, totalScore:6, hasEntry:true, hasStop:true, riskValid:true, sniperAllowed:true, firstBarrierTight:false, goodRR:true }), 'Sniper Buy');
});

test('Wave macro model is deterministic and DOM-free', () => {
  const model = buildWaveModel({
    main:{ p0:0, p1:100, p2:50, p3:null, p4:null, p5:null, a:null, b:null },
    retrace:[0.382,0.618], extend:[1.272,1.618], subWaves:[], format:value => value.toFixed(2),
    ratios:{ W4_RETRACE:[0.382], W5_BY_W1:[0.618,1.272], W5_BY_W3:[0.618], W5_BY_03:[0.618], ABC_A:[0.382], ABC_B:[0.382], ABC_C:[0.618] }
  });
  assert.equal(model.dir, 1);
  assert.equal(model.w1Len, 100);
  assert.deepEqual(model.wave2.map(item => item.price), [61.8,38.2]);
  assert.deepEqual(model.wave3.map(item => item.prices[0]), [177.2,211.8]);
  assert.equal(model.validation.valid, true);
});

