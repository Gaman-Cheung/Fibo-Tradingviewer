/** Pure presentation validation/geometry. No ranking, prices or persistence. */
export const SCAN_WINDOWS=Object.freeze([
  { id:'1', label:'Yesterday', description:'相对前一交易日' },
  { id:'3', label:'3D Fast', description:'近 3 个交易日' },
  { id:'13', label:'13D Swing', description:'近 13 个交易日' },
  { id:'60', label:'60D Regime', description:'近 60 个交易日' },
]);
export const SCAN_PANELS=Object.freeze([
  { id:'strong', title:'当下最强', center:'中心＝强度最高' },
  { id:'strengthening', title:'快速变强', center:'中心＝提升最快' },
  { id:'weak', title:'当下最弱', center:'中心＝强度最低' },
  { id:'weakening', title:'快速变弱', center:'中心＝下降最快' },
]);
const scopes=new Set(['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET']);
const text=value=>typeof value==='string' && value.trim().length>0 && value.length<=200;
const number=value=>typeof value==='number' && Number.isFinite(value);
export function officialDate(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
function points(value) {
  if (!Array.isArray(value)||value.length>8) return null;
  const seen=new Set(), result=[];
  for (const p of value) {
    if (!p||!text(p.themeKey)||!text(p.label)||!number(p.radius)||p.radius<0||p.radius>1||seen.has(p.themeKey)) return null;
    seen.add(p.themeKey);
    result.push({themeKey:p.themeKey,label:p.label,radius:p.radius});
  }
  return result;
}
export function normalizeScan(input,scope) {
  if (!input||input.presentationVersion!==1||!scopes.has(scope)||input.scope!==scope
    ||!officialDate(input.tradeDate)||!text(input.algorithmVersion)||!text(input.universeVersion)
    ||!text(input.coverageLabel)) return null;
  const strong=points(input.levels?.strong), weak=points(input.levels?.weak);
  if (!strong||!weak) return null;
  const windows={};
  for (const {id} of SCAN_WINDOWS) {
    const w=input.windows?.[id];
    if (w==null) continue; // Unavailable window is not fabricated from a shorter history.
    const strengthening=points(w.strengthening),weakening=points(w.weakening);
    if (!officialDate(w.baselineDate)||w.baselineDate>=input.tradeDate||!strengthening||!weakening) return null;
    windows[id]={baselineDate:w.baselineDate,strengthening,weakening};
  }
  return {presentationVersion:1,scope,tradeDate:input.tradeDate,algorithmVersion:input.algorithmVersion,
    universeVersion:input.universeVersion,coverageLabel:input.coverageLabel,levels:{strong,weak},windows};
}
export function normalizeRegime(input) {
  if (!input||input.presentationVersion!==1||!officialDate(input.tradeDate)||!text(input.algorithmVersion)
    ||!text(input.coverageLabel)||!text(input.label)||!text(input.explanation)
    ||!number(input.value)||input.value<0||input.value>100) return null;
  return {presentationVersion:1,tradeDate:input.tradeDate,algorithmVersion:input.algorithmVersion,
    coverageLabel:input.coverageLabel,label:input.label,explanation:input.explanation,value:input.value};
}
export function scanPanelPoints(scan,panel,windowId) {
  if (!scan) return null;
  return panel==='strong'||panel==='weak'?scan.levels[panel]:scan.windows[windowId]?.[panel]??null;
}
/** Stable angle depends only on Theme Group, never rank, scope or window. */
export function themeAngle(key) {
  let hash=2166136261;
  for (const char of key) { hash^=char.codePointAt(0);hash=Math.imul(hash,16777619); }
  return (hash>>>0)/4294967296*Math.PI*2-Math.PI/2;
}
export function scanGeometry(items,width,height) {
  const cx=width/2,cy=height/2,r=Math.max(0,Math.min(width*.28,height*.34));
  const nodes=items.map(p=>{
    const angle=themeAngle(p.themeKey),distance=r*p.radius;
    return {...p,x:cx+Math.cos(angle)*distance,y:cy+Math.sin(angle)*distance,
      side:Math.cos(angle)>=0?'right':'left',labelY:cy+Math.sin(angle)*r};
  });
  for (const side of ['left','right']) {
    const sorted=nodes.filter(p=>p.side===side).sort((a,b)=>a.labelY-b.labelY);
    sorted.forEach((p,i)=>{p.labelY=Math.max(16+i*22,p.labelY,i?sorted[i-1].labelY+22:16);});
    for(let i=sorted.length-1;i>=0;i--) sorted[i].labelY=Math.min(sorted[i].labelY,height-16-(sorted.length-1-i)*22);
  }
  return {cx,cy,r,nodes};
}
