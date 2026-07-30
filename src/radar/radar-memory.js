/**
 * Pure Leadership Memory aggregation over final Index Radar snapshots.
 * Allowed dependencies: Radar snapshot normalization only.
 * Forbidden: browser elements, persistence/network clients, Pool identity and raw market data.
 */
import { normalizeRadarSnapshot } from './radar-view-model.js';

export const LEADERSHIP_MEMORY_VERSION = 1;
export const LEADERSHIP_MEMORY_HISTORY_LIMIT = 60;
export const LEADERSHIP_MEMORY_WINDOWS = Object.freeze([
  Object.freeze({ id:'yesterday', label:'Yesterday', target:1, kind:'snapshot' }),
  Object.freeze({ id:'fast3', label:'3D Fast', target:3, kind:'rolling' }),
  Object.freeze({ id:'swing13', label:'13D Swing', target:13, kind:'rolling' }),
  Object.freeze({ id:'regime60', label:'60D Regime', target:60, kind:'rolling' }),
]);

const rankPoints = rank => Math.max(0,6-Math.min(5,Math.max(1,Number(rank)||5)));
const lexicalCompare = (left,right) => {
  const a=String(left||'').toLocaleLowerCase();
  const b=String(right||'').toLocaleLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};

export function radarThemeKey(leader) {
  const group=String(leader?.themeGroup||'').trim();
  if (group) return `theme:${group}`;
  return `symbol:${String(leader?.market||'').toUpperCase()}:${String(leader?.code||'')}`;
}

function displayLabel(leader) {
  return String(leader?.themeLabel || leader?.themeGroup || leader?.name || `${leader?.market||''}.${leader?.code||''}`);
}

function dailyThemeLeaders(snapshot) {
  const groups=new Map();
  for (const leader of snapshot?.leaders||[]) {
    const key=radarThemeKey(leader);
    const existing=groups.get(key);
    if (!existing || Number(leader.rank) < Number(existing.rank)) groups.set(key,leader);
  }
  return groups;
}

function normalizedHistory(rows,latestRow) {
  const latest=normalizeRadarSnapshot(latestRow);
  const byDate=new Map();
  for (const row of Array.isArray(rows)?rows:[]) {
    const snapshot=normalizeRadarSnapshot(row);
    if (snapshot && !byDate.has(snapshot.tradeDate)) byDate.set(snapshot.tradeDate,snapshot);
  }
  if (latest) byDate.set(latest.tradeDate,latest);
  const ordered=[...byDate.values()].sort((a,b)=>b.tradeDate.localeCompare(a.tradeDate));
  const reference=latest || ordered[0] || null;
  if (!reference) return [];
  return ordered.filter(snapshot =>
    snapshot.algorithmVersion === reference.algorithmVersion
    && snapshot.universeVersion === reference.universeVersion
  ).slice(0,LEADERSHIP_MEMORY_HISTORY_LIMIT);
}

function aggregateRollingWindow(snapshots,definition) {
  const daily=snapshots.slice(0,definition.target);
  const groups=new Map();
  daily.forEach((snapshot,sessionOffset)=>{
    for (const [key,leader] of dailyThemeLeaders(snapshot)) {
      let item=groups.get(key);
      if (!item) {
        item={
          key,
          themeGroup:String(leader.themeGroup||''),
          themeLabel:String(leader.themeLabel||''),
          displayLabel:displayLabel(leader),
          representative:leader,
          points:0,
          appearances:0,
          rankTotal:0,
          lastSeenDate:snapshot.tradeDate,
          lastSeenSessionsAgo:sessionOffset,
          currentRank:sessionOffset===0?Number(leader.rank):null,
        };
        groups.set(key,item);
      }
      item.points+=rankPoints(leader.rank);
      item.appearances+=1;
      item.rankTotal+=Number(leader.rank)||5;
      if (sessionOffset < item.lastSeenSessionsAgo) {
        item.lastSeenDate=snapshot.tradeDate;
        item.lastSeenSessionsAgo=sessionOffset;
        item.representative=leader;
        item.displayLabel=displayLabel(leader);
      }
      if (sessionOffset===0) item.currentRank=Number(leader.rank)||null;
    }
  });
  const denominator=Math.max(1,5*daily.length);
  const leaders=[...groups.values()].map(item=>({
    ...item,
    averageRank:item.appearances?item.rankTotal/item.appearances:0,
    leadershipScore:item.points/denominator*100,
    isCurrent:item.currentRank!==null,
  })).sort((a,b)=>
    b.points-a.points
    || b.appearances-a.appearances
    || a.averageRank-b.averageRank
    || a.lastSeenSessionsAgo-b.lastSeenSessionsAgo
    || lexicalCompare(a.displayLabel,b.displayLabel)
    || lexicalCompare(a.key,b.key)
  ).map((item,index)=>({ ...item, rank:index+1 }));
  return {
    ...definition,
    sessionsUsed:daily.length,
    complete:daily.length>=definition.target,
    leaders,
    daily,
  };
}

function yesterdayWindow(snapshots,definition) {
  const current=snapshots[0]||null;
  const previous=snapshots[1]||null;
  const currentGroups=dailyThemeLeaders(current);
  const leaders=(previous?.leaders||[]).map(leader=>{
    const key=radarThemeKey(leader);
    const currentLeader=currentGroups.get(key);
    const currentRank=currentLeader?Number(currentLeader.rank):null;
    const previousRank=Number(leader.rank)||5;
    return {
      key,
      rank:previousRank,
      themeGroup:String(leader.themeGroup||''),
      themeLabel:String(leader.themeLabel||''),
      displayLabel:displayLabel(leader),
      representative:leader,
      points:rankPoints(previousRank),
      appearances:1,
      averageRank:previousRank,
      leadershipScore:null,
      lastSeenDate:previous.tradeDate,
      lastSeenSessionsAgo:1,
      currentRank,
      isCurrent:currentRank!==null,
      movement:currentRank===null?'out':currentRank<previousRank?'up':currentRank>previousRank?'down':'same',
    };
  }).sort((a,b)=>a.rank-b.rank);
  return {
    ...definition,
    sessionsUsed:previous?1:0,
    complete:Boolean(previous),
    leaders,
    daily:previous?[previous]:[],
  };
}

function currentAppearanceStats(snapshots) {
  const current=snapshots[0];
  if (!current) return {};
  const dailyMaps=snapshots.map(dailyThemeLeaders);
  const stats={};
  for (const [key] of dailyMaps[0]) {
    let consecutive=0;
    for (const map of dailyMaps) {
      if (!map.has(key)) break;
      consecutive+=1;
    }
    stats[key]={
      consecutive,
      days13:dailyMaps.slice(0,13).filter(map=>map.has(key)).length,
      days60:dailyMaps.slice(0,60).filter(map=>map.has(key)).length,
    };
  }
  return stats;
}

export function buildLeadershipMemory(rows,{ latestSnapshot=null }={}) {
  const snapshots=normalizedHistory(rows,latestSnapshot);
  const periods=LEADERSHIP_MEMORY_WINDOWS.map(definition=>
    definition.kind==='snapshot'
      ? yesterdayWindow(snapshots,definition)
      : aggregateRollingWindow(snapshots,definition)
  );
  const latest=snapshots[0]||null;
  return {
    version:LEADERSHIP_MEMORY_VERSION,
    latestTradeDate:latest?.tradeDate||'',
    algorithmVersion:latest?.algorithmVersion||0,
    universeVersion:latest?.universeVersion||0,
    sessionsAvailable:snapshots.length,
    historyTarget:LEADERSHIP_MEMORY_HISTORY_LIMIT,
    complete:snapshots.length>=LEADERSHIP_MEMORY_HISTORY_LIMIT,
    snapshots,
    periods,
    currentAppearances:currentAppearanceStats(snapshots),
  };
}

export function findLeadershipPeriod(memory,periodId) {
  return memory?.periods?.find(period=>period.id===periodId)||null;
}
