# Fibo Design System

This document is the visual contract for Terminal, Wave, Auth and future systems. It governs presentation only; it must never encode trading logic or data behavior.

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

