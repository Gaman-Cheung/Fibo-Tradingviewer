# Fibo Design System

This document is the visual contract for Terminal, Wave, Trend Tracker, Auth and future systems. It governs presentation only; it must never encode trading logic or data behavior.

## Source of truth

Load styles in this order:

```html
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/components.css">
<link rel="stylesheet" href="assets/css/new-system.css">
```

- `assets/css/tokens.css` owns every shared visual constant.
- `assets/css/components.css` owns reusable, system-neutral presentation primitives.
- A page stylesheet owns only the layout and presentation unique to that page.
- A page stylesheet must not declare `:root`, redefine a shared token, or copy the token set.

## Conformance levels

Visual consistency is a contract, not a request to make pages merely look similar.

1. **Token conformance**: colors, type, spacing, radii, shadows and motion come from `tokens.css`.
2. **Component conformance**: shared controls use the same classes and the single implementation in `components.css`.
3. **Composition conformance**: page CSS may arrange those components, but may not replace or reskin them.
4. **Regression conformance**: desktop and iPhone tests compare shared geometry across all consuming systems.

Passing token conformance alone is insufficient. A new system fails this contract if it creates a second Header, Button, Modal, Card, Form Control or Mobile Navigation implementation, even when the copied values happen to use tokens.

## Shared component ownership

The following families are shared primitives. Their reusable geometry, typography, spacing, radius, focus, hover, disabled and mobile states belong in `assets/css/components.css`:

| Family | Required shared class/owner | Page CSS may control |
|---|---|---|
| System header | `fibo-header*` | Placement within the page only |
| Buttons and header tools | `fibo-button*` | Which action appears and where |
| Dialogs/action sheets | `fibo-modal*` | Dialog content and page-specific width variant |
| Cards | shared card primitive | Grid position and page-specific content flow |
| Inputs/selects/textarea | shared form-control primitive | Field grouping and column layout |
| Mobile bottom navigation | shared mobile-nav primitive | Active destination only |
| Marquee and Pro Tips | shared header/content services | Text and behavior supplied by the app controller |
| Cloud Push feedback | `fibo-button--cloud-up` plus shared `is-cloud-saving/is-cloud-saved` states | Which page-specific save operation runs |
| Segmented choices | `fibo-segmented-control` | Which choices, active value and page placement |

If a reusable primitive is not yet present, extract it before building the new page. Do not implement a page-prefixed approximation first and normalize it later.

Form-adjacent actions use the shared `fibo-button--control` modifier so they align with desktop controls and retain the minimum 44px mobile touch target. Page styles may place the button beside a field but must not redefine its height.

### Two-page rule

The first page may own a genuinely unique pattern. Once a second system needs the same pattern, that change must promote the reusable portion to `components.css`. A third implementation is never allowed.

### No compensation layers

Do not append a late CSS block whose purpose is to counteract earlier page styles. Replace the obsolete declaration or move the common rule to its owner. Media queries may adapt layout at documented breakpoints, but may not fork shared component geometry by page.

## Token model

Use tokens in this order of preference:

1. Semantic roles, such as `--color-surface`, `--color-danger-text` or `--shadow-card`.
2. Scale tokens, such as `--space-4`, `--radius-lg` or `--font-size-base`.
3. Reference palette tokens only when defining a new semantic role in `tokens.css`.

The legacy aliases (`--g-blue`, `--primary`, `--bg`, `--text`, and similar names) exist only for compatibility. New code must use semantic names.

## Visual language

- Use a neutral light canvas, white surfaces and the four-color Fibo brand stripe.
- Primary blue is for navigation, focus and the main action. Green, yellow and red communicate status, not decoration.
- Cards use a quiet border, one radius tier and low elevation. Dialogs may use the higher elevation tier.
- Typography uses the shared sans stack. Numeric or code-like values may use the mono stack.
- Layout follows the 4px spacing grid. Avoid one-off values unless the geometry of an existing visualization requires them.
- Interactive controls must have a minimum 44px mobile touch target and a visible focus state.
- Mobile prioritizes one complete instrument or section at a time; supporting controls may fold into menus or cards.
- Mobile navigation uses Pool, Terminal, Wave and Tracker. Shared Pro Tips lives in the header; cloud actions live in the overflow menu.

## Shared system header

- Terminal, Wave and Trend Tracker use the `fibo-header` component family from `assets/css/components.css`.
- Shared geometry is fixed at a 36px desktop Logo, 24px title, 44px reminder and 6px utility-button radius; mobile uses a 34px Logo, 18px title, 38px reminder and 40px header tools.
- Page styles may control placement around the header, but must not redefine its Logo, reminder or utility-button dimensions.
- System-neutral editors use the shared `fibo-modal` geometry; page modules retain ownership of modal content and behavior.

The page stylesheet must not contain selectors beginning with `.fibo-header` or `.fibo-modal` for geometry overrides. A required variant must be named and implemented centrally in `components.css` before use.

## Cloud action feedback

- Terminal, Wave and Trend Tracker Push actions use the same inline state sequence: `Push to Cloud` → `Saving to Cloud…` → `Saved to Cloud` → original label.
- Success is shown for two seconds on the exact button that initiated the operation. Successful Push must not open a browser alert or a second success dialog.
- The active button is disabled and exposes `aria-busy` while saving; its changing label uses a polite live region. Failures restore the button immediately and retain the page's explicit error alert.
- A mobile action sheet stays open until the Saved state has been visible, then closes. On failure it remains open so the user can retry.
- Saved and Saving presentation belongs to `components.css` and uses the existing semantic success, spacing and motion tokens. Do not add page-local colors or duplicate timing tokens for this state.

## Analysis source labels

- Confirmed market-data results use the shared `fibo-analysis-source--official` label and include the official trading date when available.
- Manual live-price results use `fibo-analysis-source--preview` and must say `Current Preview`; provisional states must never be styled or worded as confirmed closes.
- When both bases are available, changing the visible basis must not write a trading value until the user invokes the page's explicit Apply action.

## Quiet cards, optional brand ring and Market Radar

- `fibo-card--brand-ring` is the shared quiet-card variant for a system-selected item. Its 2px conic border uses the existing Google blue, red, yellow and green brand tokens over a white surface, shared radius and low elevation.
- The four-color ring means “selected by this system,” not bullishness, safety or a four-level score. Warnings and risks continue to use semantic warning/danger tokens; large colored card fills are prohibited.
- Sector Index, Equity ETF and Cross Asset Leader cards intentionally use the base `fibo-card` with its quiet 1px border; Market Radar does not apply the optional brand ring. Desktop composes these cards in a page-owned responsive Grid without autoplay, clones, horizontal scrolling or drag navigation; cards wrap when the available width is insufficient.
- At the documented Wide desktop breakpoint, current leaders occupy the left column and four quiet Leadership Memory summaries occupy the right column. Below that breakpoint the summaries move under the leaders without creating page overflow.
- Mobile uses separate horizontal Scroll Snap containers for current leaders and Leadership Memory, disables autoplay and preserves 44px controls. `prefers-reduced-motion` also disables card movement transitions.
- A disabled/no-data Radar must remain a quiet independent section and may never block or resize the Look First table into horizontal page overflow.
- Radar owns one `fibo-help-button` in its section header. Cards never duplicate the help icon; clicking a card opens detail using the shared `fibo-modal` geometry.
- Market Context uses one shared `fibo-segmented-control` for Market Pulse, Sector Index, Equity ETF and Cross Asset. Market Pulse is the non-persisted refresh default; scope selection lives only for the page session.
- The same segmented geometry is consumed by Terminal MACD Official/Preview. Page CSS may arrange or proportion the control but may not restyle its buttons, radius, focus, active or mobile-touch states.
- Scope changes reuse the exact Leader card, detail modal and four Leadership Memory cards. Cross Asset may add one quiet neutral category pill; category colors or large colored surfaces are prohibited.
- A compact header may wrap the segmented control. On mobile only the control itself may scroll horizontally; it must retain 44px targets and must not create page-level horizontal overflow.

## FIBO Market Pulse dashboard

- Market Pulse is the default tab in the four-option Market Context control. All four tabs occupy one shared responsive Market Context frame, so changing scope must not move the Look First table below it. Pulse still owns isolated `.market-pulse-*` internals and must never reuse `.index-radar-card` or Leadership Memory content geometry.
- The shared content height is 236px at `≥1800px`, 316px at `1330–1799px`, 516px at `1101–1329px`, 616px at `769–1100px`, and 425px on mobile. These are Market Context composition dimensions, not shared Card component dimensions.
- At `≥1330px`, four quiet Pulse cards remain a compact 2×2 block beside a chart that consumes the available frame height. At `1101–1329px`, the four compact cards form one row above a full-width chart. At `769–1100px`, they use 2×2 above the chart. Mobile uses one dedicated Scroll Snap card rail followed by the chart; page-level horizontal overflow is forbidden.
- Pulse cards and Market Radar Leaders use the shared quiet white card surface, radius, 1px border and low elevation. State color remains limited to compact score pills, labels and chart lines.
- The Pulse chart keeps neutral 40/80 guides, uses a Google-green dashed `Strength Gate` at 60 and a Google-red dashed `Risk Gate` at 20. A three-column footer places the first date, centered Gate key and latest date on one line without increasing the shared Market Context frame height. Mobile abbreviates the Gate labels to `S60` and `R20`.
- The single Market Context `fibo-help-button` changes its guide with the selected tab. Pulse group cards open latest official member detail in shared modal geometry; they never add per-card question icons.
- The shared frame owns scope height; each active dashboard must fit it without an inner vertical scrollbar. Radar Leader/Memory geometry and Pulse card geometry remain independently owned, while flexible chart space absorbs the remaining height. Loading, empty and failed states occupy the same frame.

## Trend Tracker chart forecast

- Historical Close and MA series remain the chart's primary visual area. A forecast trading day uses one-third of a historical trading day's horizontal display interval, with no minimum tail width and a 15% total-width cap.
- Horizontal compression is presentation only. It must not remove forecast points, shorten the selected horizon or alter Scenario, MA or MACD calculations.
- Flat, Trend continuation and Custom target price paths use 2px solid Material-color lines. Historical MAs remain solid; conditional projected MAs use the same MA colors with 1.25px short dashes and reduced opacity.
- Each Scenario result row owns a separate eye control. Hiding a path also hides its endpoint, edge arrow, legend and any projected MAs sourced from that path; the result row remains readable. With all paths hidden, the Forecast tail collapses so official history and Current Preview use the complete plot width.
- Compact forecast tails must keep the latest official date, forecast endpoint label and endpoint marker readable on desktop and iPhone layouts.

## Responsive contract

CSS custom properties cannot be used reliably inside media-query conditions, so breakpoints are named here:

| Name | Condition | Intended use |
|---|---:|---|
| Compact phone | `max-width: 380px` | Reduce card padding and nonessential copy |
| Phone | `max-width: 650px` | Single-column instrument workflow |
| Mobile/tablet | `max-width: 768px` | Mobile navigation and touch controls |
| Compact desktop | `max-width: 1100px` | Wrap wide desktop toolbars |
| Wide desktop | `min-width: 1800px` | Place Radar Leadership Memory beside five current leaders |

New pages should use the smallest number of breakpoints necessary and preserve safe-area insets on iOS.

## Example

```css
.system-card {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-low);
}

.system-card__action {
  min-height: var(--touch-target-min);
  padding-inline: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary-action);
  color: var(--color-on-primary);
  font: var(--font-weight-semibold) var(--font-size-base)/var(--line-height-base) var(--font-family-sans);
  transition: background var(--duration-base) var(--ease-standard);
}
```

## Change rules

- Reuse an existing semantic role before adding a token.
- Add a token only when the value represents a reusable design decision, not a one-off component measurement.
- Changing an existing token is a cross-system visual change and requires desktop and iPhone regression tests.
- Removing or renaming a compatibility alias requires migrating all consumers in the same change.
- New pages must load `tokens.css` first and pass the shared token contract test.
- Every system page must load `components.css` after `tokens.css` and before its page stylesheet.
- New or restyled systems must begin from the shared component inventory, not from a blank page-specific component set.
- A shared-component change must be checked on every consumer; a screenshot of only the changed page is not acceptance evidence.
- Functional E2E success is insufficient for UI acceptance. Tests must compare at least Logo, title, reminder, header tool, primary control, modal and mobile-navigation geometry where those components exist.
- Any deliberate visual divergence must be authorized explicitly, documented here as a named variant, implemented in `components.css`, and covered by a test. Page-local exceptions are not allowed.

## New-system acceptance checklist

Before a new entry page is accepted:

1. Its HTML loads `tokens.css`, then `components.css`, then the page stylesheet.
2. Shared UI is composed from the component inventory; no shared family is reimplemented with a page prefix.
3. Page CSS contains no shared-token declarations and no shared-component geometry overrides.
4. Desktop widths and iPhone viewports have no unintended horizontal overflow.
5. Cross-page geometry assertions pass for all shared components, not only the new page.
6. Focus, keyboard operation, 44px mobile targets, reduced motion and iOS safe areas remain valid.
7. `npm test`, both Playwright projects and `git diff --check` pass.
