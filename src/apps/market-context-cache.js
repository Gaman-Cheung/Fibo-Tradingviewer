/** Page-session freshness helpers for Market Pulse and Radar snapshots. */

export const MARKET_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Shanghai',
  year:'numeric',
  month:'2-digit',
  day:'2-digit',
});

export function shanghaiDayKey(value=Date.now()) {
  const date=value instanceof Date?value:new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts=Object.fromEntries(
    SHANGHAI_DATE_FORMATTER.formatToParts(date)
      .filter(part=>part.type!=='literal')
      .map(part=>[part.type,part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function marketContextCacheStamp(now=Date.now()) {
  const loadedAt=Number(now);
  return Object.freeze({ loadedAt,loadedShanghaiDay:shanghaiDayKey(loadedAt) });
}

export function isMarketContextCacheStale(entry,now=Date.now(),ttlMs=MARKET_CONTEXT_CACHE_TTL_MS) {
  if (!entry) return true;
  const current=Number(now);
  const loadedAt=Number(entry.loadedAt);
  if (!Number.isFinite(current) || !Number.isFinite(loadedAt)) return true;
  const age=current-loadedAt;
  if (age<0 || age>=ttlMs) return true;
  const loadedDay=String(entry.loadedShanghaiDay||shanghaiDayKey(loadedAt));
  return !loadedDay || loadedDay!==shanghaiDayKey(current);
}

export function createMarketContextRefreshCoalescer(callback,{ delayMs=75,setTimer=setTimeout,clearTimer=clearTimeout }={}) {
  let timer=null;
  return Object.freeze({
    request() {
      if (timer!==null) return;
      timer=setTimer(()=>{
        timer=null;
        callback();
      },delayMs);
    },
    cancel() {
      if (timer===null) return;
      clearTimer(timer);
      timer=null;
    },
  });
}
