/**
 * Owns exchange/code normalization for external market-data providers.
 * Allowed dependencies: none. Forbidden: DOM, storage, network and algorithms.
 */
export const MARKET_OPTIONS = Object.freeze(['SH', 'SZ', 'BJ', 'HK', 'US', 'OTHER']);
export const BAOSTOCK_MARKETS = Object.freeze(['SH', 'SZ']);

export function normalizeMarket(value) {
  const market = String(value || '').trim().toUpperCase();
  return MARKET_OPTIONS.includes(market) ? market : market;
}

export function normalizeSecurityCode(value) {
  return String(value || '').trim().replace(/^(?:sh|sz)\./i, '');
}

export function inferMainlandMarket(code) {
  const clean = normalizeSecurityCode(code);
  if (!/^\d{6}$/.test(clean)) return '';
  if (/^(?:6|9)/.test(clean)) return 'SH';
  if (/^(?:0|2|3)/.test(clean)) return 'SZ';
  if (/^(?:4|8)/.test(clean)) return 'BJ';
  return '';
}

export function migrateLegacyMarket(market, code) {
  const current = String(market || '').trim().toUpperCase();
  if (MARKET_OPTIONS.includes(current)) return current;
  if (current === 'CN-A') return inferMainlandMarket(code) || current;
  // INDEX and OTHER are intentionally not guessed: the same numeric index code
  // may exist on both exchanges.
  return current || 'OTHER';
}

export function toBaoStockCode(market, code) {
  const normalizedMarket = normalizeMarket(market);
  const normalizedCode = normalizeSecurityCode(code);
  if (!BAOSTOCK_MARKETS.includes(normalizedMarket)) return { ok:false, error:'BaoStock v1 only supports SH and SZ.' };
  if (!/^\d{6}$/.test(normalizedCode)) return { ok:false, error:'Code must contain exactly six digits.' };
  return { ok:true, value:`${normalizedMarket.toLowerCase()}.${normalizedCode}`, market:normalizedMarket, code:normalizedCode };
}
