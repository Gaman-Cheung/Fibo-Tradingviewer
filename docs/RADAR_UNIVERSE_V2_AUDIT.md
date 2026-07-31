# Market Radar Universe v2 Audit

Review date: **2026-07-31**  
Radar Algorithm: **1 (unchanged)**  
Universe: **2**

## Reviewed universe

- Index manifest: 507 unique Market+Code records, zero unclassified records, 241 reviewed sector/theme codes enabled in the seed and 236 currently active.
- ETF manifest: 1,615 unique Market+Code records covering 1,229 Equity ETF and 382 Cross Asset products.
- ETF publication set: 1,381 products have complete retained provider history and are enabled. Another 230 are fully classified but deferred because their history starts part-way through the current 144-session window.
- Four inactive ETF codes have only a provider code instead of an evidenced official name. They are explicitly reviewed as raw-only `other`, disabled and carry `official_name_unavailable_in_current_catalog`; no category is fabricated.
- Every manifest row records review status, official exchange/index source, BaoStock cross-check and an exclusion reason when disabled.

The committed CSV manifests are the review source of truth. The generated Python seeds contain only runtime fields and classify exclusively by permanent `Market + Code`; the bootstrap name-review rules are never imported by synchronization or ranking modules.

## Read-only Dry Run

Command:

```text
python scripts/radar_universe_v2.py dry-run
```

The command used existing Supabase history and invoked no Catalog, bar, snapshot or checkpoint write method.

| Scope | Latest date | Coverage | Scored representatives | Qualified before final selection | Final leaders | Rebuilt history |
|---|---:|---:|---:|---:|---:|---:|
| Sector Index | 2026-07-30 | 100% | 236 | 49 | 5 | 339 sessions |
| Equity ETF | 2026-07-30 | 100% | 90 | 14 | 5 | 77 sessions |
| Cross Asset | 2026-07-30 | 100% | 66 | 16 | 4 | 77 sessions |

Cross Asset has ten qualified overseas representatives and six qualified bond representatives on the latest date. The unchanged two-per-category cap retains two from each category, so four cards are correct; no commodity or money representative passed every hard gate.

Compared with stored Universe v1 snapshots:

- Index leaders changed on 292 of 339 common sessions; the latest five codes remained the same.
- Equity ETF leaders changed on all 77 sessions and the latest list expanded from four to five.
- Cross Asset leaders changed on 76 of 77 sessions and remains four because of the category cap.
- One oldest Index v1 snapshot cannot be rebuilt from the currently retained raw window because it no longer has the required 62-point warm-up. It is outside the latest 60-session Leadership Memory and is intentionally removed on v2 publication.

These differences come only from reviewed candidate membership and Theme grouping. Score weights, RS5/RS20, events, risks, the 60-point gate, liquidity threshold and selection caps are unchanged.

## Capacity baseline

Read-only REST counts at review time:

- `market_daily_bar`: 2,474,005 rows.
- ETF rows with Amount: 206,184.
- `market_etf_catalog`: 1,615 rows.
- `market_etf_radar_snapshot`: 154 rows.

Estimated existing ETF physical storage is **35.1–57.7MB**, with **65MB** used as the planning ceiling. Universe v2 adds no market rows, table or SQL column; it updates Catalog rows and replaces existing snapshots. Persistent net growth is estimated below **2MB**. Supabase Dashboard Database Size is the authoritative physical measurement, and less than 75MB remaining headroom is a capacity warning that forbids further history expansion or automatic deletion.

## Publication order

1. Run `npm run audit:radar` and archive the successful output.
2. Record Supabase Dashboard Database Size and the four row-count baselines above.
3. Run `daily / indices`; verify latest Algorithm 1 / Universe 2 and 100% coverage.
4. Run `daily / etfs`; verify both scopes, 77 compatible snapshots and unchanged `market_daily_bar` row count aside from the expected latest-date upserts.
5. Recheck Dashboard capacity, then leave the schedule on `daily / all`.

Any coverage failure, unexpected market-row growth, incomplete scope publication or low capacity headroom stops rollout. The process never shortens retention or deletes data to make the release pass.
