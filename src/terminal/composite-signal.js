/** Pure Composite Signal scoring and classification. */
export function calculateTechnicalScore(input) {
  const { trend, rsi, macd, previous, volumeRatio, current:c, high:h, levels, fiboScore } = input;
  const trendScore = trend === 'uptrend' ? 2 : (trend === 'downtrend' ? -3 : 0);
  let rsiScore = 0;
  if (Number.isFinite(rsi)) {
  if (rsi <= 30) rsiScore = 2;
  else if (rsi <= 45) rsiScore = 1;
  else if (rsi >= 70) rsiScore = -2;
  }
  const macdScore = macd === 'divergence' ? 2 : (macd === 'bullish' ? 1 : (macd === 'bearish' ? -1 : 0));
  const momentumScore = Math.min(3, rsiScore + macdScore);
  
  let volumeScore = 0;
  let volumeText = '5日量比未填';
  if (Number.isFinite(previous) && previous > 0 && Number.isFinite(volumeRatio) && volumeRatio > 0) {
  const move = (c - previous) / previous;
  if (volumeRatio >= 2.5) {
  if (move > 0.002) { volumeScore = 1; volumeText = '异常放量上涨：加速 / 强分歧'; }
  else if (move < -0.002) { volumeScore = -2; volumeText = '异常放量下跌：恐慌 / 出货风险'; }
  else { volumeScore = 0; volumeText = '异常放量：等待方向确认'; }
  } else if (move > 0.002 && volumeRatio >= 1.5) { volumeScore = 1; volumeText = '明显放量上涨确认'; }
  else if (move > 0.002 && volumeRatio <= 0.8) { volumeScore = -1; volumeText = '缩量反弹'; }
  else if (move < -0.002 && volumeRatio >= 1.5) { volumeScore = -2; volumeText = '明显放量下跌风险'; }
  else if (move < -0.002 && volumeRatio <= 0.8) { volumeScore = 1; volumeText = '缩量回调'; }
  else if (volumeRatio >= 1.2) volumeText = `温和放量 (${volumeRatio.toFixed(2)}x)`;
  else volumeText = `正常量能 (${volumeRatio.toFixed(2)}x)`;
  } else if (Number.isFinite(volumeRatio) && volumeRatio > 0) {
  if (volumeRatio >= 2.5) volumeText = '异常放量：缺少 Prev Close，等待方向确认';
  else if (volumeRatio >= 1.5) volumeText = '明显放量：缺少 Prev Close';
  else if (volumeRatio >= 1.2) volumeText = '温和放量：缺少 Prev Close';
  else if (volumeRatio <= 0.8) volumeText = '明显缩量：缺少 Prev Close';
  else volumeText = '正常量能：缺少 Prev Close';
  }
  let strengthBonus = 0;
  if (trend === 'uptrend' && c >= h && (macd === 'bullish' || volumeScore > 0)) strengthBonus = 2;
  else if (trend === 'uptrend' && c >= levels['38.2%']) strengthBonus = 1;
  const totalScore = fiboScore + trendScore + momentumScore + volumeScore + strengthBonus;
  return { trendScore, rsiScore, macdScore, momentumScore, volumeScore, volumeText, strengthBonus, totalScore };
}

export function classifyCompositeSignal(input) {
  if (input.structureBroken) return 'Structure Invalid';
  if (input.totalScore < 1) return 'Avoid';
  if (input.totalScore < 3) return 'Watch';
  if (!input.hasEntry) return 'Wait Better Entry';
  if (!input.hasStop) return 'Risk Plan Pending';
  if (!input.riskValid) return 'Invalid Stop';
  if (input.totalScore >= 6 && input.sniperAllowed) return 'Sniper Buy';
  if (input.firstBarrierTight) return 'Wait Reclaim';
  if (input.goodRR) return 'Good Setup';
  return 'Wait Better Entry';
}
