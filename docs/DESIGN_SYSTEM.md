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

## Responsive contract

CSS custom properties cannot be used reliably inside media-query conditions, so breakpoints are named here:

| Name | Condition | Intended use |
|---|---:|---|
| Compact phone | `max-width: 380px` | Reduce card padding and nonessential copy |
| Phone | `max-width: 650px` | Single-column instrument workflow |
| Mobile/tablet | `max-width: 768px` | Mobile navigation and touch controls |
| Compact desktop | `max-width: 1100px` | Wrap wide desktop toolbars |

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
