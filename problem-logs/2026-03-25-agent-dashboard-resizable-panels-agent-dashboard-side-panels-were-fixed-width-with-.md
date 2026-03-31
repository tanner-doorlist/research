```markdown
---
date: 2026-03-25
type: coding
problem: Agent dashboard side panels were fixed-width with no resize or collapse capability
tags: ["electron", "react", "panels", "resize", "drag", "animation", "ux"]
---

## Problem
The agent dashboard had hardcoded panel widths (left agents list: 224px, right chat: 360px). Users could not resize or collapse them. The goal was drag-to-resize handles and collapse-to-floating-pill behavior, while keeping Electron's native WebContentsView preview pane in sync.

## Initial Observations
- Both panels are static; no resize state exists anywhere in the component tree.
- Electron's WebContentsView is a native overlay — it does not reflow with CSS automatically and must be explicitly told its bounds.
- Collapsing to zero width while maintaining a re-expand affordance requires both an animation strategy and a floating UI element when hidden.

## Approach

1. **Encapsulate resize logic in a `usePanelResize` hook** — tracks `width` (number) and `collapsed` (boolean), both persisted to `localStorage` so state survives reloads.
2. **Implement drag via raw mouse events** — `onMouseDown` on the handle records start X and width; a `window` `mousemove` listener computes a direction-aware delta (right for left panel, left for right panel) and either snaps to collapsed (if computed width < `minWidth / 2`) or clamps to `[minWidth, maxWidth]`.
3. **Use a CSS `width` transition on the wrapper div** — `width: collapsed ? 0 : width` with `220ms cubic-bezier(.4,0,.2,1)` gives a smooth slide. `overflow: hidden` on the content div prevents layout bleed during animation.
4. **Render a floating pill when collapsed** — an absolutely-positioned button on the panel's inner edge, vertically centered, with `writing-mode: vertical-rl` text ("AGENTS" / "CHAT"). Clicking calls `expand()`.
5. **Add a 5px drag handle div** with a pseudo-element that expands from 1px to 3px on hover. Double-clicking the handle triggers collapse directly.
6. **Wire ResizeObserver to the preview pane container** — because the CSS transition continuously changes the container's width, the ResizeObserver fires on every frame of the animation and pushes updated bounds to the WebContentsView automatically. No imperative animation callbacks needed.

## Key Insights

- **CSS transition + ResizeObserver is the correct Electron pattern for animated panel resize.** Trying to manually compute and push WebContentsView bounds on each drag/collapse event would require duplicating animation timing logic. ResizeObserver observes ground truth (the DOM) instead.
- **Snap-to-collapse on drag** (threshold: `< minWidth / 2`) makes collapse feel intentional rather than accidental — dragging slowly past the minimum feels natural and the snap prevents an awkwardly narrow panel.
- **Direction-aware delta** is easy to get wrong: left panel delta = `currentX - startX` (positive = expand), right panel delta = `startX - currentX` (positive = expand toward center).
- **`localStorage` persistence keyed as `<key>:collapsed`** separates width memory from collapsed state, allowing a panel to remember its last width even after being collapsed and re-expanded.

## Solution
A `usePanelResize(key, { minWidth, maxWidth, defaultWidth })` hook exposing `{ width, collapsed, collapse, expand, handleMouseDown }`. Each panel wraps its content in:

```tsx
<div style={{ width: collapsed ? 0 : width, transition: 'width 220ms cubic-bezier(.4,0,.2,1)', overflow: 'hidden' }}>
  {children}
</div>
```

A sibling `<div className="w-[5px] cursor-col-resize" onMouseDown={handleMouseDown} onDoubleClick={collapse} />` serves as the drag handle with a CSS pseudo-element for the visual indicator. When `collapsed`, a floating pill button renders on the panel edge to restore it. The preview pane's ResizeObserver callback calls Electron's `setBounds` with the observed content rect, tracking transitions with zero extra wiring.

## Pitfalls / What to Watch For

- **Forgetting direction-awareness on delta** — both panels using the same delta formula will make one panel invert its drag direction.
- **Attaching `mousemove` to the handle instead of `window`** — fast mouse movement exits the handle element, dropping the drag. Always attach move/up listeners to `window` and clean them up on `mouseup`.
- **Animating with JS `setTimeout` instead of CSS transition** — breaks ResizeObserver continuous firing; the webview would jump rather than follow smoothly.
- **Storing only `collapsed` in localStorage and not `width`** — panel resets to `defaultWidth` on every re-expand, losing user preference.
- **Rendering the floating pill inside the collapsing wrapper** — it will be clipped by `overflow: hidden`. It must be rendered outside (e.g., relative to the dashboard container).

## Study Prompts
Q: Why does CSS `width` transition plus ResizeObserver eliminate the need for custom Electron bounds-update logic during animation?
A: ResizeObserver fires whenever the observed element's layout size changes — including every intermediate frame of a CSS transition. Because the transition drives real DOM geometry, ResizeObserver always has the current true width and can push it to `setBounds` continuously without the caller needing to know animation duration or easing.

Q: At what point during a drag should the panel snap to collapsed, and why that threshold?
A: When the computed width drops below `minWidth / 2`. This prevents accidental collapse (the user must drag well past the minimum) while still making intentional collapse feel natural — once past the halfway point, snapping the rest of the way is the expected behavior.

Q: What is the correct way to compute drag delta for a right-side panel?
A: `delta = startX - currentX`. Moving the mouse left (decreasing X) should expand the right panel, so negating the raw delta flips the direction correctly.
```