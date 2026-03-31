```markdown
---
date: 2026-03-25
type: coding
problem: Popovers and dropdowns in an Electron renderer were invisible, hidden behind a WebContentsView rendering the Next.js dev server preview.
tags: ["electron", "webcontentsview", "zindex", "popover", "overlay", "compositing"]
---

## Problem
In an Electron-based agent dashboard, overlay UI elements — popovers, dropdowns, and similar components — were not visible to the user. The app uses a WebContentsView to display a Next.js dev server preview alongside the main renderer UI. Any overlay UI was being rendered beneath the native view, making it inaccessible.

## Initial Observations
The overlays were present in the DOM and had correct CSS z-index values. The bug appeared to be a z-index stacking issue, which would normally suggest a stacking context problem in CSS. However, adjusting z-index values had no effect, pointing to a cause outside the CSS rendering model.

## Approach

1. Verified the overlays existed in the DOM and that CSS z-index was set correctly — ruled out a pure CSS stacking context bug.
2. Identified that a WebContentsView (the successor to BrowserView) was in use for the preview panel — recognized this as a native OS-level compositing layer, not a DOM element.
3. Confirmed that WebContentsView renders above all renderer content at the OS compositor level, making CSS z-index entirely ineffective across that boundary.
4. Checked that the main process already exposed `preview:hide` and `preview:show` IPC handlers, meaning infrastructure for toggling the view was already in place.
5. Decided to hide the WebContentsView on overlay open and restore it on close, and identified the shared `PopoverContent` component as the single correct place to add this logic — covering all callsites automatically.

## Key Insights

- CSS z-index operates only within a single rendering context (the renderer process). WebContentsView/BrowserView is composited at the OS level and is always above renderer content — no CSS value can override this.
- Because `PopoverContent` is portaled and only mounted when the popover is open, `useEffect` mount maps exactly to "popover opened" and the cleanup function maps exactly to "popover closed." No explicit open/close event wiring is needed.
- The correct abstraction boundary for this fix is the shared overlay component itself, not individual callsites — this makes the fix automatically apply to all future popovers as well.

## Solution
Added a `useEffect` in the shared `PopoverContent` component that hides the WebContentsView on mount and restores it on unmount via the existing `window.api` IPC bridge:

```js
React.useEffect(() => {
  window.api?.hidePreview()
  return () => window.api?.showPreview()
}, [])
```

This required no changes at individual popover callsites. The main process `preview:hide` and `preview:show` IPC handlers were already in place and required no modification.

## Pitfalls / What to Watch For

- Assuming this is a CSS z-index or stacking context problem and spending time adjusting z-index values or `isolation: isolate` — there is no CSS solution across a native compositing boundary.
- Placing the hide/show logic at individual callsites instead of in the shared component — this is fragile, creates repetition, and will silently miss any future overlays added to the app.
- Forgetting the cleanup function in `useEffect` — if `showPreview` is not called on unmount, the preview panel will remain hidden after the popover closes.
- This pattern must be replicated for any other overlay primitive (modals, tooltips, context menus) that does not share the `PopoverContent` component.

## Study Prompts
Q: Why does CSS z-index have no effect on the stacking order between a WebContentsView and renderer DOM elements?
A: CSS z-index only controls paint order within the same rendering context (the renderer process). WebContentsView is a native OS-level compositing layer managed by Electron outside the renderer entirely — the OS compositor always places it above renderer content regardless of any CSS property.

Q: Why is `useEffect` with an empty dependency array a clean way to tie logic to popover open/close state in this case?
A: Because `PopoverContent` is only mounted when the popover is open (it is portaled and conditionally rendered). Mount corresponds exactly to open and unmount corresponds exactly to close, so `useEffect` on mount with a cleanup on unmount maps precisely to the desired open/close lifecycle without any additional event handling.
---
```