# Reverse Pickup Calculator

This is a temporary, floating Terminal tool for checking retracement observation prices.

- It calculates only the 38.2%, 50% and 61.8% levels from a lower anchor and the up-day close.
- The compact panel includes the three review rules from the standalone calculator: unify the anchor, a level is not a buy signal, and wait when the broader environment does not cooperate.
- The lower anchor can be the up-day open or the prior close for a gap-up move.
- Current price is optional and only classifies the visible observation zone.
- The panel is fixed to the viewport, opens from a floating calculator button and can be dragged by its title bar. It does not add space to the page layout.
- Values live in DOM memory only. There is no Pool record, `localStorage` key, cloud field, Supabase read/write or database migration.
- Closing or refreshing the page clears the temporary calculation.
- It is an observation aid, not an automatic buy, position-sizing or trading signal.
