// Local PostgreSQL-compatible integration test. No network or Supabase access.
// Install @electric-sql/pglite in a temporary directory; pass its dist/index.js.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'@electric-sql/pglite');
const db=new PGlite();
const sql=fs.readFileSync(new URL('../../supabase/migrations/20260929_market_insights.sql',import.meta.url),'utf8');
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.market_sync_checkpoint(provider text,scope text,latest_trade_date date,last_status text,synced_at timestamptz,primary key(provider,scope));
  create table public.market_pulse_snapshot(provider text,trade_date date,algorithm_version integer,calculation_id text,primary key(provider,trade_date));
  create table public.old_snapshot_sentinel(value text);insert into public.old_snapshot_sentinel values('unchanged');
  grant select,update on public.market_sync_checkpoint,public.market_pulse_snapshot to service_role;`);
await db.exec(sql);await db.exec(sql); // migration idempotence
const scopes=['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET'];
async function input(day){
  const cps=Object.fromEntries(['CN_A','CN_INDEX','CN_PULSE','CN_ETF'].map(scope=>[scope,{latest_trade_date:day,last_status:'ok',synced_at:day+'T12:00:00Z'}]));
  for(const [scope,cp] of Object.entries(cps)) await db.query(`insert into market_sync_checkpoint values ('baostock',$1,$2,'ok',$3) on conflict(provider,scope) do update set latest_trade_date=excluded.latest_trade_date,last_status='ok',synced_at=excluded.synced_at`,[scope,day,cp.synced_at]);
  await db.query(`insert into market_pulse_snapshot values ('baostock',$1,1,$2) on conflict(provider,trade_date) do update set calculation_id=excluded.calculation_id`,[day,'pulse-'+day]);
  return {provider:'baostock',trade_date:day,algorithm_version:'insights-v1',universe_version:2,presentation_version:1,calculation_id:'calc-'+day,
    scans:Object.fromEntries(scopes.map(scope=>[scope,{scope,tradeDate:day,algorithmVersion:'insights-v1',levels:{strong:[{themeKey:'a'}]}}])),regime:null,
    theme_scores:{},coverage:{},source_checkpoints:cps,pulse_calculation_id:'pulse-'+day};
}
async function publish(row,headroom=100){
  await db.exec('set role service_role');
  try{return await db.query('select public.publish_market_insights($1::jsonb,$2::numeric) as id',[JSON.stringify(row),headroom]);}
  finally{await db.exec('reset role');}
}
let row=await input('2026-07-01');
await publish(row);await publish(row);
assert.equal((await db.query('select count(*)::int n from market_insights_snapshot')).rows[0].n,1);
for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select public.publish_market_insights($1::jsonb,100)',[JSON.stringify(row)]));
  await assert.rejects(db.query('delete from market_insights_snapshot'));
  if(role==='anon')await assert.rejects(db.query('select * from market_insights_snapshot'));
  else assert.equal((await db.query('select * from market_insights_snapshot')).rows.length,1);
  await db.exec('reset role');
}
for(const mutate of [r=>r.source_checkpoints.CN_ETF.last_status='error',r=>r.source_checkpoints.CN_INDEX.synced_at='2000-01-01T00:00:00Z',r=>delete r.scans.CROSS_ASSET,r=>r.pulse_calculation_id='wrong',r=>r.scans.EQUITY_ETF.tradeDate='2000-01-01',r=>r.algorithm_version='draft']){
  const bad=structuredClone(row);mutate(bad);await assert.rejects(publish(bad));
}
await assert.rejects(publish(row,74));await assert.rejects(publish(row,null));
for(let i=1;i<62;i++){
  const day=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10);
  row=await input(day);await publish(row);
}
assert.equal((await db.query('select count(*)::int n from market_insights_snapshot')).rows[0].n,60);
assert.equal((await db.query('select min(trade_date)::text as earliest_day from market_insights_snapshot')).rows[0].earliest_day,'2026-07-03');
await db.exec(`create function fail_prune() returns trigger language plpgsql as $$ begin raise exception 'test retention failure'; end $$;
  create trigger fail_prune before delete on market_insights_snapshot for each row execute function fail_prune();`);
row=await input('2026-09-29');await assert.rejects(publish(row));
assert.equal((await db.query("select count(*)::int n from market_insights_snapshot where trade_date='2026-09-29'")).rows[0].n,0);
assert.equal((await db.query('select count(*)::int n from market_insights_snapshot')).rows[0].n,60);
assert.equal((await db.query('select value from old_snapshot_sentinel')).rows[0].value,'unchanged');
await db.close();
console.log('PASS: migration twice; service-only writes; authenticated reads; invalid/stale bundle rejection; idempotent upsert; 60-row retention; atomic rollback; old data untouched.');
