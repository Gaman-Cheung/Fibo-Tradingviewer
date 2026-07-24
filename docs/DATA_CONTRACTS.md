# Data Contracts

## Permanent identity

- Each logical instrument has one stable, non-empty `id`.
- Two rows may have identical Tickers and must still retain different IDs.
- Rename operations change `ticker`/`n`, never `id`.
- Look First, Then Leap, Pool and Wave link only through the exact ID.
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

Migrations are ordered, versioned and idempotent in `src/core/migrations.js`.

## Supabase

Table: `fibo_data`; conflict key: `user_id`.

- `v6_data`: Look First rows. Row zero may carry `__header_notes_v1` and `__instrument_pool_v1` for backward compatibility.
- `v7_data`: Then Leap rows.
- `wp_data`: Wave state plus `instrumentPool` and `uiNotes`.

Existing columns and metadata carriers must remain readable. A new schema must be additive until a tested migration exists.

