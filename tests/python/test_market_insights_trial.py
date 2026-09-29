import copy
from datetime import date, timedelta
import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from scripts.market_insights_trial import (build_regime, build_scan, group_bars, metrics, run_trial, basket_symbols, live_input)


def fixture(count=144):
    calendar=[]
    day=date(2026, 1, 1)
    while len(calendar)<count:
        if day.weekday()<5:
            calendar.append(day.isoformat())
        day+=timedelta(days=1)
    indices=[dict(market='SH',code='000300',active=True,radar_enabled=False,universe_version=2)]
    etfs=[]
    index_rows=[]
    etf_rows=[]
    for code, drift, etf in [('000300',.001,False),('000001',.002,False),('000002',-.002,False),('510001',.002,True),('510002',-.002,True)]:
        item=dict(market='SH',code=code,active=True,radar_enabled=True,universe_version=2,
                  category='sector',theme_group=code,theme_label=code,radar_scope='EQUITY_ETF')
        if code!='000300':
            (etfs if etf else indices).append(item)
        for i,day in enumerate(calendar):
            (etf_rows if etf else index_rows).append(dict(market='SH',code=code,trade_date=day,
                close=100*math.exp(drift*i),pct_chg=(math.exp(drift)-1)*100,trade_status=1,amount=30_000_000))
    return dict(index_catalog=indices,etf_catalog=etfs,index_rows=index_rows,etf_rows=etf_rows),calendar


class TrialTests(unittest.TestCase):
    def test_neutral_and_direction(self):
        data,calendar=fixture()
        history=group_bars(data['index_rows'])
        up=metrics(history['SH:000001'],calendar,143)
        down=metrics(history['SH:000002'],calendar,143)
        self.assertGreater(up['score'],50)
        self.assertLess(down['score'],50)
        for row in history['SH:000001'].values(): row['close']=100
        self.assertEqual(metrics(history['SH:000001'],calendar,143)['score'],50)

    def test_no_future_and_scale_invariance(self):
        data,calendar=fixture()
        history=group_bars(data['index_rows'])['SH:000001']
        before=metrics(history,calendar,100)['score']
        for day,row in history.items():
            row['close']*=10000 if day>calendar[100] else 3
        self.assertAlmostEqual(metrics(history,calendar,100)['score'],before)

    def test_constant_trend_does_not_invent_acceleration(self):
        data,_=fixture()
        scan=run_trial(data)['payload']['scans']['EQUITY_ETF']
        for window in scan['windows'].values():
            self.assertEqual(window['strengthening'],[])
            self.assertEqual(window['weakening'],[])

    def test_live_reader_rejects_write_even_from_shared_method(self):
        class FakeRest:
            def __init__(self): pass
            def get_checkpoint(self,scope):
                return self._request('POST','market_sync_checkpoint')
        with patch.dict('sys.modules', {'sync_baostock': SimpleNamespace(SupabaseRest=FakeRest)}), patch.dict('os.environ', {
            'SUPABASE_URL':'https://example.invalid', 'SUPABASE_SERVICE_ROLE_KEY':'test-only'
        }):
            with self.assertRaisesRegex(RuntimeError,'forbids database writes'):
                live_input()

    def test_missing_and_invalid_pct_fail_closed(self):
        data,calendar=fixture()
        history=group_bars(data['etf_rows'])['SH:510001']
        history[calendar[-10]]['pct_chg']=None
        self.assertIsNone(metrics(history,calendar,143,True))
        del history[calendar[-10]]
        self.assertIsNone(metrics(history,calendar,143,True))

    def test_etf_split_uses_returns_not_raw_gap(self):
        data,calendar=fixture()
        history=group_bars(data['etf_rows'])['SH:510001']
        before=metrics(history,calendar,143,True)['score']
        history[calendar[-1]]['close']/=2
        self.assertAlmostEqual(metrics(history,calendar,143,True)['score'],before)

    def test_122_sessions_and_no_padding(self):
        for count,available in [(121,False),(122,True)]:
            data,_=fixture(count)
            report=run_trial(data)
            self.assertEqual('60' in report['payload']['scans']['EQUITY_ETF']['windows'],available)
            self.assertFalse(report['publishable'])
            self.assertGreater(report['storageEstimate']['jsonBytesPerSnapshot'],0)

    def test_same_rep_for_both_endpoints_and_missing_window(self):
        data,calendar=fixture()
        data['etf_catalog'][1]['theme_group']='510001'
        for row in data['etf_rows']:
            if row['code']=='510002': row['amount']=40_000_000
        history=group_bars(data['etf_rows'])
        scan,diagnostics,dated=build_scan(data['etf_catalog'],history,calendar,'EQUITY_ETF')
        self.assertEqual(diagnostics['scores']['510001']['members'][0]['symbol'],'SH:510002')
        self.assertEqual(dated['60']['510001']['members'][0]['symbol'],'SH:510002')
        del history['SH:510002'][calendar[30]]
        scan,diagnostics,_=build_scan(data['etf_catalog'],history,calendar,'EQUITY_ETF')
        self.assertNotIn('60',scan['windows'])
        self.assertIn('510001',diagnostics['windows']['60']['missingThemes'])

    def test_partial_amount_does_not_substitute(self):
        data,calendar=fixture()
        data['etf_catalog'][1]['theme_group']='510001'
        history=group_bars(data['etf_rows'])
        history['SH:510002'][calendar[-1]]['amount']=None
        _,diagnostics,_=build_scan(data['etf_catalog'],history,calendar,'EQUITY_ETF')
        self.assertEqual(diagnostics['excluded']['510001'],'incomplete_theme_amount_history')

    def test_not_mutating_inputs_and_distinct_scope(self):
        data,_=fixture()
        before=copy.deepcopy(data)
        report=run_trial(data)
        self.assertEqual(data,before)
        self.assertEqual(report['payload']['scans']['CROSS_ASSET']['levels']['strong'],[])
        self.assertIsNone(report['payload']['regime'])

    def test_regime_requires_exact_basket_and_same_date(self):
        symbols=basket_symbols()
        latest={theme:dict(score=70,members=[dict(symbol=sorted(codes)[0])]) for theme,codes in symbols.items()}
        past={theme:{**value,'baselineScore':60} for theme,value in latest.items()}
        pulse=dict(trade_date='2026-09-29',algorithm_version=1,pulse_score=80)
        result,error=build_regime('2026-09-29',latest,past,pulse)
        self.assertIsNone(error)
        self.assertAlmostEqual(result['value'],68)
        latest['csi1000']['members'][0]['symbol']='SH:999999'
        self.assertIsNone(build_regime('2026-09-29',latest,past,pulse)[0])
        self.assertIsNone(build_regime('2026-09-28',latest,past,pulse)[0])


if __name__ == '__main__':
    unittest.main()
