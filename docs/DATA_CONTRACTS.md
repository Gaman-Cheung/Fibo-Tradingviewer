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
| `tv_trend_tracker_state_v1` | Tracker MA visibility, Scenario preferences and other Tracker-only state keyed by permanent ID; legacy `current/vr` fields are migration input only |

Migrations are ordered, versioned and idempotent in `src/core/migrations.js`.

Tracker Scenario state keeps `horizon`, `target`, `targetDate` and `maProjectionScenario` per permanent ID. `maProjectionScenario` accepts only `flat`, `trend` or `custom`; legacy, missing or invalid values migrate idempotently to `trend`. Historical `scenarioMode` values are accepted on read, ignored and omitted from the next normalized write: Flat, Trend continuation and valid Custom target price projections are always calculated together, while only the selected Scenario extends the checked MAs. Reset restores the three Scenario inputs and, when Custom becomes unavailable, changes `maProjectionScenario` to `trend`; it never touches Current, VR, MA visibility or another permanent ID.

Look First keeps Prev Close in `p`, its source mode in `pm` (`auto` or `manual`) and the Auto source trading date in `pd` (`YYYY-MM-DD` or empty). These fields travel unchanged through backups and `v6_data`; mode remains per permanent ID even when multiple instruments share the same Market/Code.

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
- Current and five-day VR remain manual per permanent ID, but have exactly one canonical storage location: Look First `c` for Current and Then Leap `v` for VR. Tracker inputs are proxies into those rows and must never own a second live copy.
- Shared Current/VR reads and writes use exact `instrument.id` only. A missing row may be created only for an ID present in Pool; duplicate Tickers or Market/Code values never share the manual value.
- Legacy Tracker `current/vr` values fill only blank canonical fields. Non-empty Terminal fields always win. Successfully reconciled legacy copies are removed; unknown IDs are retained for a later Pool restore. The reconciliation is versioned, idempotent and also runs after imports or cloud Pulls.
- Same-device tabs synchronize these two canonical storage keys through browser storage events. Cross-device synchronization remains explicit Push/Pull through existing `v6_data/v7_data`; Supabase Realtime is not part of this contract.
- Terminal Auto Prev Close reads the latest traded row for the Pool instrument's explicit Market/Code. It may reuse one market request for duplicate symbols, but writes `p/pm/pd` only to each exact permanent ID. Manual mode never changes another instrument.
- Service-role credentials may exist only in protected server-side secrets or the ignored local `.env.local` used by the manual synchronization launcher. They must never enter browser code, tracked files, backups or cloud payloads.

## Index Radar market contract

- Index prices reuse `market_daily_bar` and its `(provider,market,code,trade_date)` key. Index rows use official raw closes; they are not front-adjusted. High/Low may exist only in synchronizer memory for Retest classification and are never persisted.
- `market_index_catalog` is keyed by `(provider,market,code)` and owns the index name, `category`, `theme_group`, `theme_label`, Radar enablement, universe version and per-symbol backfill state.
- Allowed catalog categories are `broad`, `sector`, `theme`, `style`, `strategy`, `fund`, `bond` and `other`. Only active `sector`/`theme` rows explicitly enabled by the versioned seed may rank.
- Universe v1 is the 507-code map in `scripts/index_catalog_seed_v1.py`. A future code absent from that map is stored as `other`, remains disabled and emits a synchronization warning; names are never used to guess it into Radar.
- `market_index_radar_snapshot` is keyed by `(provider,trade_date)`. It stores algorithm/universe versions, benchmark Market/Code, universe and eligible counts, coverage, `computed_at`, and an ordered `leaders` JSON array of at most five entries.
- Each leader carries Market/Code/name/category/theme, rank/raw rank, score and score breakdown, official return/RS/MA metrics, event/risk arrays, trend breakdown and final-list appearance counts. It contains no user ID, Pool ID or permanent instrument ID.
- `CN_INDEX` is an independent `market_sync_checkpoint.scope`; it cannot advance or overwrite `CN_A`. Per-index resumability is stored in the catalog. A failed coverage/benchmark/publication step records `CN_INDEX.last_status=error`, preserves the latest valid snapshot and performs no retention deletion.
- Authenticated browser users may read catalog/snapshots. Only the Service Role used by the Action or ignored local launcher may write them.
- The browser reads only the latest snapshot through `src/core/index-radar-repository.js`; it never loads the 507 histories or calculates the leaderboard.
