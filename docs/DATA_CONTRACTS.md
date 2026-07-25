# Data Contracts

## Permanent identity

- Each logical instrument has one stable, non-empty `id`.
- Two rows may have identical Tickers and must still retain different IDs.
- Rename operations change `ticker`/`n`, never `id`.
- Look First, Then Leap, Pool and Wave link only through the exact ID.
- Trend Tracker also links only through the exact ID. Shared Market/Code values never merge instrument state.
- Ticker fallback is allowed only during legacy migration when exactly one candidate exists and the ID is unused.
- If historical rows share an ID, the richest Look First row retains it and every other row receives a fresh ID.

## Local storage

| Key | Value |
|---|---|
| `tv_lookfirst_data_v3` | Look First row array |
| `tv_thenleap_data_v3` | Then Leap row array |
| `tv_instrument_pool_v1` | `{version, items, tombstones}` |
| `wave_matrix_tabs_v3` | Wave app state and tabs |
| `tv_active_instrument_id` | Active permanent ID |
| `tv_header_marquee_v1` | Shared marquee text |
| `tv_header_tips_v1` | Shared Pro Tips text |
| `tv_trend_tracker_state_v1` | Tracker preferences and per-instrument inputs keyed by permanent ID |

Migrations are ordered, versioned and idempotent in `src/core/migrations.js`.

## Supabase

Table: `fibo_data`; conflict key: `user_id`.

- `v6_data`: Look First rows. Row zero may carry `__header_notes_v1` and `__instrument_pool_v1` for backward compatibility.
- `v7_data`: Then Leap rows.
- `wp_data`: Wave state plus `instrumentPool` and `uiNotes`.

Existing columns and metadata carriers must remain readable. A new schema must be additive until a tested migration exists.

## Market data

- Pool remains `{id,ticker,code,market,...}`; no second market-code identity field exists.
- Market uses `SH`, `SZ`, `BJ`, `HK`, `US` or `OTHER`. BaoStock v1 accepts only SH/SZ and a six-digit Code.
- Legacy `CN-A` is inferred only for unambiguous ordinary stock prefixes. Legacy `INDEX` is never guessed.
- Existing additive keys remain `(user_id,instrument_id)` for bindings, `(provider,market,code,trade_date)` for legacy closes, `(provider,market,code)` for legacy sync state, and `user_id` for Tracker state.
- The full-market key is `(provider,market,code,trade_date)` in `market_daily_bar`; it is shared market data and must never include or merge by `instrument.id`.
- `market_daily_bar` stores only official raw `close`, `pct_chg`, trading status and synchronization metadata. Tracker reconstructs BaoStock's front-adjusted sequence from these official returns, anchored to the latest raw close.
- `market_sync_checkpoint` has one `(provider,scope)` row for idempotent backfill progress and global freshness. A cursor advances only after every batch for that date succeeds.
- Full-market data retains the latest 400 official trading sessions. Incomplete or abnormally small snapshots never advance the checkpoint or trigger retention deletion.
- `market_daily_close` and `market_sync_state` remain readable compatibility fallbacks and are not dropped or repurposed.
- Current and five-day VR remain manual per permanent ID.
- Service-role credentials may exist only in protected server-side secrets or the ignored local `.env.local` used by the manual synchronization launcher. They must never enter browser code, tracked files, backups or cloud payloads.
