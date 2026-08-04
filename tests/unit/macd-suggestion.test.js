import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerminalMacdSuggestion, classifyTerminalMacd, detectCloseMacdDivergence } from '../../src/tracker/macd-suggestion.js';

test('Terminal MACD suggestion uses the conservative cross and zero-axis mapping', () => {
  assert.equal(classifyTerminalMacd({dif:-1,dea:-2,cross:'golden',zeroAxis:'below'}).value,'bullish');
  assert.equal(classifyTerminalMacd({dif:2,dea:1,cross:'none',zeroAxis:'above'}).value,'bullish');
  assert.equal(classifyTerminalMacd({dif:1,dea:2,cross:'death',zeroAxis:'above'}).value,'bearish');
  assert.equal(classifyTerminalMacd({dif:-2,dea:-1,cross:'none',zeroAxis:'below'}).value,'bearish');
  assert.equal(classifyTerminalMacd({dif:-1,dea:-2,cross:'none',zeroAxis:'below'}).value,'neutral');
  assert.equal(classifyTerminalMacd({dif:null,dea:null,cross:'none',zeroAxis:'unknown'}).value,'neutral');
});

test('Terminal MACD suggestion keeps confirmed momentum after a below-zero Golden Cross', () => {
  const official={dif:-2.5343,dea:-2.5759,histogram:.0830,cross:'golden',zeroAxis:'below'};
  const preview={dif:-2.2443,dea:-2.5095,histogram:.5306,cross:'none',zeroAxis:'below'};
  assert.equal(classifyTerminalMacd(official).value,'bullish');
  const result=classifyTerminalMacd(preview,official);
  assert.equal(result.value,'bullish');
  assert.match(result.reason,/rising.*expanding positive Histogram below zero/i);

  const base=Array.from({length:50},(_,index)=>50-index*.2+Math.sin(index/5)*.1);
  const officialSeries=[...base,40.6];
  assert.equal(buildTerminalMacdSuggestion(officialSeries).snapshot.cross,'golden');
  const previewResult=buildTerminalMacdSuggestion([...officialSeries,40.6]);
  assert.equal(previewResult.snapshot.cross,'none');
  assert.equal(previewResult.snapshot.zeroAxis,'below');
  assert.equal(previewResult.suggestion.value,'bullish');
});

test('opposite-zero-axis continuation requires both lines and Histogram to strengthen', () => {
  const previous={dif:-2.53,dea:-2.58,histogram:.10};
  assert.equal(classifyTerminalMacd({dif:-2.44,dea:-2.50,histogram:.12,cross:'none',zeroAxis:'below'},previous).value,'bullish');
  assert.equal(classifyTerminalMacd({dif:-2.44,dea:-2.50,histogram:.08,cross:'none',zeroAxis:'below'},previous).value,'neutral');
  assert.equal(classifyTerminalMacd({dif:-2.44,dea:-2.60,histogram:.32,cross:'none',zeroAxis:'below'},previous).value,'neutral');
  assert.equal(classifyTerminalMacd({dif:-2.44,dea:-2.50,histogram:.10,cross:'none',zeroAxis:'below'},previous).value,'neutral');
  assert.equal(classifyTerminalMacd({dif:-2.44,dea:-2.50,histogram:.12,cross:'none',zeroAxis:'below'}).value,'neutral');

  const bearishPrevious={dif:2.53,dea:2.58,histogram:-.10};
  const bearish=classifyTerminalMacd({dif:2.24,dea:2.51,histogram:-.54,cross:'none',zeroAxis:'above'},bearishPrevious);
  assert.equal(bearish.value,'bearish');
  assert.match(bearish.reason,/falling.*expanding negative Histogram above zero/i);
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
