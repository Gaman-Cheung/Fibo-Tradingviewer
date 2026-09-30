/** Pure presentation validation/geometry. No ranking, prices or persistence. */
export const SCAN_WINDOWS=Object.freeze([
  { id:'1', label:'Yesterday', description:'相对前一交易日' },
  { id:'3', label:'3D Fast', description:'近 3 个交易日' },
  { id:'13', label:'13D Swing', description:'近 13 个交易日' },
  { id:'60', label:'60D Regime', description:'近 60 个交易日' },
]);
export const SCAN_PANELS=Object.freeze([
  { id:'strong', title:'Strongest', center:'中心＝强度最高' },
  { id:'strengthening', title:'Strengthening', center:'中心＝提升最快' },
  { id:'weak', title:'Weakest', center:'中心＝强度最低' },
  { id:'weakening', title:'Weakening', center:'中心＝下降最快' },
]);
const THEME_ZH=Object.freeze({agriculture:'农业',ai_computing:'人工智能与算力',automotive:'汽车',automobile:'汽车',banking:'银行',business_services:'商业服务',chemicals:'化工',chemicals_materials:'化工与材料',coal:'煤炭',communications:'通信',construction:'建筑',consumer:'消费',consumer_electronics:'消费电子',data_digital:'数据与数字经济',defense:'国防',defense_aerospace:'国防军工',electronics:'电子',energy:'能源',environmental:'环保',finance:'金融',food_beverage:'食品饮料',healthcare:'医疗健康',high_technology:'高科技',industrial_goods:'工业品',information_innovation:'信息创新',information_technology:'信息技术',internet:'互联网',machinery:'机械',machinery_industrial:'机械工业',manufacturing:'制造业',materials:'材料',media_gaming:'传媒与游戏',metals:'有色金属',new_energy:'新能源',new_energy_vehicle:'新能源汽车',new_hardware:'新硬件',oil_gas:'石油与天然气',real_estate:'房地产',research_services:'科研服务',securities:'证券',software:'软件',software_security:'软件与网络安全',state_owned_reform:'国企改革',technology:'科技',transportation:'交通运输',utilities:'公用事业',well_off_industry:'大消费升级',csi_a50:'A50',szse50:'深证50',csi300:'沪深300',szse100:'深证100',csi_a500:'中证A500',csi2000:'中证2000',csi1000:'中证1000',biotechnology:'生物科技',medical_devices:'医疗器械',dividend:'红利',dividend_low_vol:'红利低波',innovative_drugs:'创新药',green_power:'绿色电力',value:'价值',hk_automobile:'港股汽车',convertible_bond:'可转债',hang_seng_tech:'恒生科技',france_equity:'法国股票',germany_equity:'德国股票',energy_chemical_futures:'能源化工期货',treasury_30y:'30年国债',nasdaq100:'纳斯达克100',bond_market:'债券市场',sse50:'上证50',sse180:'上证180',sse_composite:'上证综指',star50:'科创50',chinext:'创业板',cni2000:'中证2000',csi500:'中证500',csi_a500:'中证A500'});
const THEME_EN=Object.freeze({ai_computing:'AI & Computing',business_services:'Business Services',chemicals_materials:'Chemicals & Materials',consumer_electronics:'Consumer Electronics',data_digital:'Data & Digital',defense_aerospace:'Defense & Aerospace',food_beverage:'Food & Beverage',high_technology:'High Technology',industrial_goods:'Industrial Goods',information_technology:'Information Technology',machinery_industrial:'Machinery & Industrial',new_energy_vehicle:'New Energy Vehicle',software_security:'Software & Security',state_owned_reform:'State-owned Reform',well_off_industry:'Well-off Industry',csi_a50:'CSI A50',csi300:'CSI 300',csi_a500:'CSI A500',csi1000:'CSI 1000',csi2000:'CSI 2000',szse50:'SZSE 50',szse100:'SZSE 100',star50:'STAR 50',chinext:'ChiNext',cni2000:'CNI 2000',dividend_low_vol:'Dividend Low Vol',energy_chemical_futures:'Energy Chemicals',treasury_30y:'30Y Treasury',hang_seng_tech:'Hang Seng Tech',hk_automobile:'HK Automobile',france_equity:'France Equity',germany_equity:'Germany Equity',nasdaq100:'NASDAQ 100',bond_market:'Bond Market'});
const scopes=new Set(['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET']);
const text=value=>typeof value==='string' && value.trim().length>0 && value.length<=200;
const number=value=>typeof value==='number' && Number.isFinite(value);
const hasCjk=value=>/[\u3400-\u9fff]/.test(value||'');
const englishTitle=key=>String(key||'').replace(/^exposure_.+$/,'Theme exposure').replace(/_/g,' ').replace(/\b\w/g,char=>char.toUpperCase());
export function themeDisplay(point) {
  const label=String(point?.label||'').trim(),key=String(point?.themeKey||''),cjk=hasCjk(label);
  const chinese=THEME_ZH[key]||(cjk?label:`主题 · ${key||'未命名'}`);
  const english=THEME_EN[key]||(cjk?englishTitle(key):label||englishTitle(key));
  return {chinese,english};
}
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
    if (!sorted.length) continue;
    const gap=Math.min(26,Math.max(22,(height-38)/Math.max(1,sorted.length-1)));
    sorted.forEach((p,i)=>{p.labelY=Math.max(22+i*gap,p.labelY,i?sorted[i-1].labelY+gap:22);});
    for(let i=sorted.length-1;i>=0;i--) sorted[i].labelY=Math.min(sorted[i].labelY,height-16-(sorted.length-1-i)*gap);
  }
  return {cx,cy,r,nodes};
}
