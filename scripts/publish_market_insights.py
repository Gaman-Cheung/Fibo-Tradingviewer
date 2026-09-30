"""Publish approved Insights v1 from stored bars only; old synchronizer untouched.

Default is read-only validation. --publish calls only the new atomic RPC.
Database capacity errors fail this step with a clear warning; old systems are unaffected.
"""
import argparse
import hashlib
import json
import os

try:
    from .market_insights import calculate_insights, VERSION, SCOPES
    from .market_insights_trial import live_input
except ImportError:
    from market_insights import calculate_insights, VERSION, SCOPES
    from market_insights_trial import live_input

CHECKPOINTS = ('CN_A', 'CN_INDEX', 'CN_PULSE', 'CN_ETF')


def snapshot_from(data):
    report = calculate_insights(data)
    payload = report['payload']
    day = payload['tradeDate']
    checkpoints = data.get('checkpoints', {})
    for scope in CHECKPOINTS:
        cp = checkpoints.get(scope, {})
        if cp.get('last_status') != 'ok' or cp.get('latest_trade_date') != day or not cp.get('synced_at'):
            raise ValueError('Source checkpoint incomplete/stale: '+scope)
    pulse = data.get('pulse') or {}
    if pulse.get('trade_date') != day or pulse.get('algorithm_version') != 1 or not pulse.get('calculation_id'):
        raise ValueError('Matching published Pulse v1 required')
    if any(not payload['scans'][scope]['levels']['strong'] for scope in SCOPES):
        raise ValueError('An entire scope has no eligible themes; retain previous snapshot')
    snapshot = {
        'provider':'baostock', 'trade_date':day, 'algorithm_version':VERSION,
        'universe_version':2, 'presentation_version':1,
        'scans':payload['scans'], 'regime':payload['regime'], 'theme_scores':payload['themeScores'],
        'coverage':{scope:{k:v for k,v in report['diagnostics'][scope].items() if k != 'scores'} for scope in SCOPES},
        'source_checkpoints':{scope:{k:checkpoints[scope][k] for k in ('latest_trade_date','last_status','synced_at')} for scope in CHECKPOINTS},
        'pulse_calculation_id':pulse['calculation_id'],
    }
    snapshot['coverage']['regimeMissing'] = report['regimeMissing']
    canonical = json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    snapshot['calculation_id'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return snapshot


def publish(snapshot, request=None):
    if request is None:
        import requests
        request = requests.post
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    response = request(os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/rpc/publish_market_insights',
                       headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},
                       json={'p_snapshot':snapshot}, timeout=(10,90))
    # Never dump credentials, headers or server payloads to Action logs.
    if not 200 <= response.status_code < 300:
        detail=''
        code=''
        try:
            error=response.json()
            code=str(error.get('code') or '')
            detail=': '+str(error.get('message') or error.get('hint') or '')[:240]
        except Exception:
            pass
        if code=='53100':
            detail=': Supabase database storage is full; free database capacity before retrying'
        raise RuntimeError('Insights publication failed, HTTP '+str(response.status_code)+detail+'; only this new snapshot failed, old systems are unaffected')
    if response.json() != snapshot['calculation_id']:
        raise RuntimeError('Publication acknowledgement mismatch; verify new snapshot before retry')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--env-file')
    args = parser.parse_args()
    snapshot = snapshot_from(live_input(args.env_file))
    if args.publish:
        publish(snapshot)
    print(json.dumps({'status':'published' if args.publish else 'validated_read_only',
                      'trade_date':snapshot['trade_date'], 'algorithm_version':VERSION,
                      'calculation_id':snapshot['calculation_id'],
                      'snapshot_json_bytes':len(json.dumps(snapshot,ensure_ascii=False,separators=(',', ':')).encode('utf-8')),
                      'regime_available':snapshot['regime'] is not None}))


if __name__ == '__main__':
    main()
