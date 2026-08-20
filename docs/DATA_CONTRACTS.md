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

Tracker Scenario state keeps `horizon`, `target`, `targetDate`, `maProjectionScenario` and `scenarioVisibility` per permanent ID. `maProjectionScenario` accepts only `flat`, `trend` or `custom`; legacy, missing or invalid values migrate idempotently to `trend`. `scenarioVisibility` is exactly `{flat:boolean,trend:boolean,custom:boolean}`; each missing or invalid member migrates to `true`. Historical `scenarioMode` values are accepted on read, ignored and omitted from the next normalized write: Flat, Trend continuation and valid Custom target price projections are always calculated together, while only the selected visible Scenario extends the checked MAs. Eye controls affect chart presentation only: a hidden path and its selected projected MA remain calculated, and the visibility object travels through the existing Tracker JSONB state. Reset restores the three Scenario inputs and, when Custom becomes unavailable, changes `maProjectionScenario` to `trend`; it never changes Scenario visibility, Current, VR, MA visibility or another permanent ID.

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
- `market_daily_bar` stores official raw `close`, `pct_chg`, trading status and synchronization metadata. Nullable `amount` is populated only for ETF rows and is never treated as fund flow. Tracker reconstructs BaoStock's front-adjusted sequence from official returns, anchored to the latest raw close.
- `market_sync_checkpoint` has one `(provider,scope)` row for idempotent backfill progress and global freshness. A cursor advances only after every batch for that date succeeds, except for the explicitly recorded CN_ETF provider-prefix case below.
- A-share and index data retain the latest 400 official trading sessions. ETF rows target 144. Incomplete or abnormally small snapshots never advance a checkpoint or trigger retention deletion.
- `market_daily_close` and `market_sync_state` remain readable compatibility fallbacks and are not dropped or repurposed.
- Current and five-day VR remain manual per permanent ID, but have exactly one canonical storage location: Look First `c` for Current and Then Leap `v` for VR. Tracker inputs are proxies into those rows and must never own a second live copy.
- Shared Current/VR reads and writes use exact `instrument.id` only. A missing row may be created only for an ID present in Pool; duplicate Tickers or Market/Code values never share the manual value.
- Legacy Tracker `current/vr` values fill only blank canonical fields. Non-empty Terminal fields always win. Successfully reconciled legacy copies are removed; unknown IDs are retained for a later Pool restore. The reconciliation is versioned, idempotent and also runs after imports or cloud Pulls.
- Same-device tabs synchronize these two canonical storage keys through browser storage events. Cross-device synchronization remains explicit full-workspace Push/Pull through the existing `v6_data/v7_data`, `wp_data` and Tracker state row; Supabase Realtime is not part of this contract.
- Terminal Auto Prev Close reads the latest traded row for the Pool instrument's explicit Market/Code. It may reuse one market request for duplicate symbols, but writes `p/pm/pd` only to each exact permanent ID. Manual mode never changes another instrument.
- Service-role credentials may exist only in protected server-side secrets or the ignored local `.env.local` used by the manual synchronization launcher. They must never enter browser code, tracked files, backups or cloud payloads.

## Full-workspace cloud synchronization

- Manual Push and Pull from Terminal, Wave and Trend Tracker all call `src/core/workspace-cloud-sync.js`; page controllers only flush their active DOM state and redraw after the shared operation.
- A Push writes the complete local workspace to the existing `fibo_data` row (`v6_data`, `v7_data`, `wp_data`), the complete `trend_tracker_state` JSONB row and exact permanent-ID `market_instrument_bindings`. All three writes must succeed before the shared Push feedback may report success. The writes are idempotent but are not a database transaction; a failed retry may safely repeat them.
- Before Push, the service reads the existing `wp_data` so unknown compatibility fields are preserved. A failure reading that row aborts Push rather than overwriting it with a partial payload.
- Pull reads both user rows before changing local storage. A real read, permission or malformed-state error applies no local section. A missing `fibo_data` row leaves the complete local workspace untouched; a missing legacy `trend_tracker_state` row restores the other cloud sections and retains the local Tracker state.
- Pull replaces explicitly present Look First, Then Leap, Wave, notes and Tracker fields. Missing legacy fields are retained locally, while explicit empty arrays remain valid clears. Instrument Pool is merged only by exact `instrument.id` with its timestamped tombstones; Ticker and Market/Code never merge identity.
- Current and VR remain canonical in Look First `c` and Then Leap `v`; every Pull runs the existing legacy Tracker reconciliation after all sections are staged. Storage writes are rolled back if local application fails.
- Wave authentication/startup performs local initialization only. It never auto-Pulls the full workspace; cloud recovery is an explicit user action from any page.

## Index Radar market contract

- Index prices reuse `market_daily_bar` and its `(provider,market,code,trade_date)` key. Index rows use official raw closes; they are not front-adjusted. High/Low may exist only in synchronizer memory for Retest classification and are never persisted.
- `market_index_catalog` is keyed by `(provider,market,code)` and owns the index name, `category`, `theme_group`, `theme_label`, Radar enablement, universe version and per-symbol backfill state.
- Allowed catalog categories are `broad`, `sector`, `theme`, `style`, `strategy`, `fund`, `bond` and `other`. Only active `sector`/`theme` rows explicitly enabled by the versioned seed may rank.
- Universe v2 is the 507-row reviewed manifest in `scripts/universe/index_universe_v2.csv`; `scripts/index_catalog_seed_v2.py` is its deterministic runtime projection. Every reviewed code has an official-source URL, cross-check, category and review result. Only `sector`/`theme` rows are enabled. A future code absent from v2 is stored as `other`, remains disabled and emits a synchronization warning; runtime names are never used to guess it into Radar.
- `market_index_radar_snapshot` is keyed by `(provider,trade_date)`. It stores algorithm/universe versions, benchmark Market/Code, universe and eligible counts, coverage, `computed_at`, and an ordered `leaders` JSON array of at most five entries.
- Each leader carries Market/Code/name/category/theme, rank/raw rank, score and score breakdown, official return/RS/MA metrics, event/risk arrays, trend breakdown and final-list appearance counts. It contains no user ID, Pool ID or permanent instrument ID.
- Leadership Memory v1 is derived in the browser from at most 60 compatible final snapshots. It groups by `theme_group`, counts one best representative per theme per session and stores no new database row, local key or user state.
- Yesterday uses the prior official snapshot. Rolling 3D/13D/60D windows include the latest official snapshot. Main cards display derived Theme Group `Consecutive / 13D / 60D`; legacy snapshot `15D / 30D` fields remain readable and Python's 30-session tie/stability behavior remains unchanged.
- Snapshot history with a different algorithm or universe version is excluded. Partial history is labeled with its actual `N / target` coverage and is never padded with missing sessions.
- `CN_INDEX` is an independent `market_sync_checkpoint.scope`; it cannot advance or overwrite `CN_A`. Per-index resumability is stored in the catalog. A failed coverage/benchmark/publication step records `CN_INDEX.last_status=error`, preserves the latest valid snapshot and performs no retention deletion.
- Authenticated browser users may read catalog/snapshots. Only the Service Role used by the Action or ignored local launcher may write them.
- The browser reads the latest snapshot independently plus at most 60 recent snapshot rows through `src/core/index-radar-repository.js`. It never loads the 507 histories or recalculates the Radar Score/raw eligible ranking; a history-read failure cannot block the current five leaders.

## ETF Radar market contract

- ETF raw rows reuse `market_daily_bar` and keep Provider, Market, Code, Date, official Close, pctChg, Trade Status, unadjusted Amount and sync time. They contain no user or permanent instrument identity. High/Low is transient Retest input only.
- ETF prices are converted to a continuous-return series by walking backward from the latest official Close with official `pct_chg`. Amount is not adjusted.
- `market_etf_catalog` is keyed by `(provider,market,code)`. Categories are `equity_broad`, `equity_sector`, `equity_theme`, `equity_strategy`, `overseas`, `commodity`, `bond`, `money` and `other`; Radar scopes are nullable `EQUITY_ETF` or `CROSS_ASSET`.
- Universe v2 is the 1,615-row reviewed manifest in `scripts/universe/etf_universe_v2.csv`; `scripts/etf_catalog_seed_v2.py` is its deterministic code-keyed runtime projection. Names remain display metadata at runtime. Products with only partial history inside the retained 144-session window keep their reviewed category, Scope and Theme but are disabled for this Universe so a version rebuild retains at least 60 compatible final snapshots. An unknown future code is synchronized as `other`, has no scope and stays disabled until a reviewed Universe update.
- `market_etf_radar_snapshot` is keyed by `(provider,scope,trade_date)`. Each of the two scopes has an independent final Top 5, algorithm/universe versions, benchmark, coverage and ordered leader JSON.
- ETF leaders use the Index Radar v1 score vocabulary plus `radarScope`, `assetCategory` and `averageAmount20D`. The same Theme Group has exactly one daily representative: the ETF with highest valid 20-session average Amount. If that representative is below RMB 20 million, the Theme is excluded.
- Cross Asset final lists allow at most two representatives from each of `overseas`, `commodity`, `bond` and `money`; the stability buffer cannot break this cap. Equity ETF has no category quota.
- Leadership Memory filters Algorithm, Universe and Scope together and aggregates continuity by Theme Group, so a liquidity-driven representative-code change does not reset history.
- `CN_ETF` is an independent checkpoint with a 144-session retention target. During the first chronological Backfill, an entirely empty contiguous prefix before BaoStock's first supported bulk-ETF session may advance only `backfill_cursor`; no price row or synthetic date is created, and `oldest_trade_date` remains the first date that actually uploaded valid ETF rows. Once that first valid session is reached, every later empty, partial, malformed or low-coverage session is a hard failure and cannot advance the cursor or trigger cleanup.
- ETF cleanup must issue Market+Code-scoped deletes from the ETF catalog; it must never call the global cutoff that could shorten 400-session A-share/index history. A temporarily shorter provider history remains labeled by its actual coverage and naturally grows toward 144 sessions through Daily updates.
- The Market Context browser defaults to `MARKET_PULSE`; all three Radar scopes remain lazy and cache only for the page session. No selection is persisted to localStorage or cloud state. One scope failure cannot clear another scope or block Look First.
- Authenticated users may read ETF catalog and snapshots. Only Service Role may write them.

## FIBO Market Pulse market contract

- Pulse is keyed only by shared market identity and official date. It has no user ID, Pool ID, permanent instrument ID, localStorage key or cloud payload field.
- `market_pulse_snapshot` is keyed by `(provider,trade_date)` and carries Algorithm/Index-Universe versions, a verified `calculation_id`, four group JSON objects, total score/state, eligible counts, coverage and compute time. Only the latest 60 official snapshots are retained.
- `market_pulse_member_snapshot` is keyed by `(provider,trade_date,calculation_id,member_type,market,code)`. Member types are `stock`, `sector_index` and `broad_index`; rows store latest returns, MA distance/slope and v1 boolean event flags. Only calculations referenced by the latest two published snapshots survive cleanup.
- A new calculation uploads and verifies member rows before its aggregate snapshot exposes the same `calculation_id`. Failed staging is unreachable from the browser and cannot replace the previous visible member set.
- `CN_PULSE` is independent from CN_A, CN_INDEX and CN_ETF. Pulse publishes only when CN_A/CN_INDEX are both successful on the same date, A-share and sector/theme coverage are at least 95%, all four broad indices exist and staged member counts match.
- A-share candidates are full-market rows not present in the complete Index or ETF catalogs. Names are display metadata from the cached BaoStock security list; missing names fall back to Market.Code and never merge identity.
- Authenticated users may read aggregates and member pages. Only Service Role may write or prune them. The browser never reads `market_daily_bar` to calculate Pulse.
- Pulse capacity is operationally bounded: aggregate history is expected below 1MB, the latest two member calculations about 4–12MB, and indexed net growth must remain at or below the conservative 20MB ceiling. Supabase Dashboard Database Size is authoritative; less than 75MB remaining headroom stops further expansion without deleting or shortening any existing market history.
