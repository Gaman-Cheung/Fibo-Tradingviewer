import copy
from datetime import date
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from scripts.publish_market_insights import capacity_guard, snapshot_from, publish
from scripts.market_insights import SCOPES, basket_symbols
from scripts.market_insights_trial import run_trial
try:
    from .test_market_insights_trial import fixture
except ImportError:
    from test_market_insights_trial import fixture


def publication_data():
    data,calendar=fixture()
    item=copy.deepcopy(data['etf_catalog'][0]);item.update(code='510003',radar_scope='CROSS_ASSET',theme_group='cross')
    data['etf_catalog'].append(item)
    data['etf_rows'] += [{**r,'code':'510003'} for r in data['etf_rows'] if r['code']=='510001']
    data['checkpoints']={scope:dict(last_status='ok',latest_trade_date=calendar[-1],synced_at=calendar[-1]+'T12:00:00Z') for scope in ('CN_A','CN_INDEX','CN_PULSE','CN_ETF')}
    data['pulse']=dict(trade_date=calendar[-1],algorithm_version=1,calculation_id='pulse-one',pulse_score=50)
    return data


class PublicationTests(unittest.TestCase):
    def test_snapshot_is_deterministic_and_independently_versioned(self):
        data=publication_data()
        a=snapshot_from(data);b=snapshot_from(copy.deepcopy(data))
        self.assertEqual(a,b)
        self.assertEqual(a['algorithm_version'],'insights-v1')
        self.assertEqual(set(a['scans']),set(SCOPES))
        self.assertIsNone(a['regime']) # no substitute score when basket missing
        self.assertIn('regimeMissing',a['coverage'])
        self.assertFalse(run_trial(data)['publishable']) # CLI remains read only

    def test_source_failures_do_not_generate_publishable_snapshot(self):
        for scope in ('CN_A','CN_INDEX','CN_PULSE','CN_ETF'):
            for field,value in [('last_status','error'),('latest_trade_date','2000-01-01'),('synced_at',None)]:
                data=publication_data();data['checkpoints'][scope][field]=value
                with self.assertRaises(ValueError): snapshot_from(data)
        data=publication_data();data['pulse']['trade_date']='2000-01-01'
        with self.assertRaises(ValueError): snapshot_from(data)
        data=publication_data();data['etf_catalog'][-1]['radar_enabled']=False
        with self.assertRaises(ValueError): snapshot_from(data)

    def test_capacity_guard(self):
        today=date(2026,9,29)
        self.assertEqual(capacity_guard('75','2026-09-22',today),75)
        for value in ('74.99',None,'NaN','Infinity'):
            with self.assertRaises(ValueError): capacity_guard(value,'2026-09-29',today)
        for day in ('2026-09-21','2026-09-30','',None):
            with self.assertRaises(ValueError): capacity_guard('100',day,today)

    def test_one_rpc_no_other_writes(self):
        snapshot=snapshot_from(publication_data());calls=[]
        def request(url,**kwargs):
            calls.append((url,kwargs));return SimpleNamespace(status_code=200,json=lambda:snapshot['calculation_id'])
        with patch.dict(os.environ,SUPABASE_URL='https://example.invalid',SUPABASE_SERVICE_ROLE_KEY='test-only'):
            publish(snapshot,100,request)
            self.assertEqual(len(calls),1)
            self.assertTrue(calls[0][0].endswith('/rpc/publish_market_insights'))
            with self.assertRaises(RuntimeError): publish(snapshot,100,lambda *a,**k:SimpleNamespace(status_code=500))
            with self.assertRaises(RuntimeError): publish(snapshot,100,lambda *a,**k:SimpleNamespace(status_code=200,json=lambda:'wrong'))

    def test_basket_matches_reviewed_manifest_and_excludes_financials(self):
        import csv
        root=Path(__file__).resolve().parents[2]
        expected={theme:set() for theme in basket_symbols()}
        with (root/'scripts/universe/etf_universe_v2.csv').open(encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                if row['theme_group'] in expected and row['radar_enabled']=='true': expected[row['theme_group']].add(row['market']+':'+row['code'])
        self.assertEqual(basket_symbols(),expected)
        self.assertEqual(len(expected),6)

    def test_migration_and_workflow_contract(self):
        root=Path(__file__).resolve().parents[2]
        sql=(root/'supabase/migrations/20260929_market_insights.sql').read_text()
        self.assertIn('create table if not exists public.market_insights_snapshot',sql)
        self.assertIn('enable row level security',sql)
        self.assertIn('security invoker',sql)
        self.assertIn('pg_advisory_xact_lock',sql)
        self.assertIn('limit 60',sql)
        self.assertNotIn('delete from public.market_daily_bar',sql)
        self.assertNotIn('update public.market_sync_checkpoint',sql)
        workflow=(root/'.github/workflows/sync-baostock.yml').read_text()
        self.assertIn("vars.INSIGHTS_ENABLED == 'true'",workflow)
        self.assertLess(workflow.index('python scripts/sync_baostock.py'),workflow.index('python scripts/publish_market_insights.py'))


if __name__=='__main__': unittest.main()
