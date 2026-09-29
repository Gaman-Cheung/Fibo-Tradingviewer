// Synthetic presentation fixture. Never imported by production modules.
export function insightsFixture(scope='SECTOR_INDEX') {
  const point=(themeKey,label,radius)=>({themeKey,label,radius});
  const strong=[point('tech','科技主题',.2),point('bank','银行',.7)];
  const weak=[point('medicine','医药',.2),point('tech','科技主题',.7)];
  return {status:'ready',scan:scope==='MARKET_PULSE'?null:{
    presentationVersion:1,scope,tradeDate:'2026-09-28',algorithmVersion:'TEST-ONLY',universeVersion:'TEST-ONLY',coverageLabel:'测试覆盖 2 / 2',
    levels:{strong,weak},windows:{
      '1':{baselineDate:'2026-09-25',strengthening:strong,weakening:weak},
      '3':{baselineDate:'2026-09-23',strengthening:strong.map(p=>({...p,radius:1-p.radius})),weakening:weak.map(p=>({...p,radius:1-p.radius}))},
      '13':{baselineDate:'2026-09-09',strengthening:[],weakening:[]},
    },
  },regime:{presentationVersion:1,tradeDate:'2026-09-28',algorithmVersion:'TEST-ONLY',coverageLabel:'测试覆盖',value:62,label:'测试状态',explanation:'仅用于验证界面，不是真实市场判断。'}};
}

// Synthetic DB wire format for testing the real repository (not a source stub).
export function insightsWireFixture() {
  return {provider:'baostock',trade_date:'2026-09-28',algorithm_version:'insights-v1',universe_version:2,
    presentation_version:1,calculation_id:'test-only',
    scans:Object.fromEntries(['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET'].map(scope=>[scope,{
      ...insightsFixture(scope).scan,algorithmVersion:'insights-v1',universeVersion:'live-reviewed-catalog-v2',
    }])),regime:{...insightsFixture().regime,algorithmVersion:'insights-v1'}};
}
