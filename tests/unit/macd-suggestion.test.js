import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTerminalMacd, detectCloseMacdDivergence } from '../../src/tracker/macd-suggestion.js';

test('Terminal MACD suggestion uses the conservative cross and zero-axis mapping', () => {
  assert.equal(classifyTerminalMacd({dif:-1,dea:-2,cross:'golden',zeroAxis:'below'}).value,'bullish');
  assert.equal(classifyTerminalMacd({dif:2,dea:1,cross:'none',zeroAxis:'above'}).value,'bullish');
  assert.equal(classifyTerminalMacd({dif:1,dea:2,cross:'death',zeroAxis:'above'}).value,'bearish');
  assert.equal(classifyTerminalMacd({dif:-2,dea:-1,cross:'none',zeroAxis:'below'}).value,'bearish');
  assert.equal(classifyTerminalMacd({dif:-1,dea:-2,cross:'none',zeroAxis:'below'}).value,'neutral');
  assert.equal(classifyTerminalMacd({dif:null,dea:null,cross:'none',zeroAxis:'unknown'}).value,'neutral');
});

test('close/DIF divergence scanner reports candidates without producing a Terminal score value', () => {
  const bullish=[...Array(30).fill(120),115,110,105,100,95,90,85,80,70,60,70,80,90,100,...Array(10).fill(100),90,80,70,59,70,80];
  const bearish=bullish.map(value=>200-value);
  const dates=bullish.map((_,index)=>`D${String(index).padStart(2,'0')}`);
  const bullishResult=detectCloseMacdDivergence(bullish,dates);
  const bearishResult=detectCloseMacdDivergence(bearish,dates);
  assert.equal(bullishResult.bullish?.kind,'bullish');
  assert.equal(bullishResult.bullish?.second.close,59);
  assert.equal(bearishResult.bearish?.kind,'bearish');
  assert.equal(Object.prototype.hasOwnProperty.call(bullishResult,'value'),false);
});
