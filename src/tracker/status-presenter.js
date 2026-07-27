/**
 * Maps Tracker calculation states to display-only labels.
 * Allowed dependencies: none. Forbidden: DOM, storage, network and trading calculations.
 * Covered by: tests/unit/tracker.test.js.
 */

export function formatTurnLabel(turn, direction, hasPreview=false) {
  let label='—';
  if (turn?.confirmed) {
    if (direction==='up') label='Up Confirmed';
    if (direction==='down') label='Down Confirmed';
  } else if (turn?.alert) label='Turn Alert';
  return hasPreview && label!=='—' ? `${label} (preview)` : label;
}
