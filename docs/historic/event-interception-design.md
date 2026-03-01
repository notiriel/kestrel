# Event Interception Design

## Problem

Kestrel uses a clone-based rendering architecture: real `Meta.Window` actors are invisible (opacity=0) while `Clutter.Clone` instances on a custom layer provide the visual representation. This allows free positioning of clones beyond monitor bounds for horizontal scrolling.

However, **Mutter's constraint system** (`src/core/constraints.c`) prevents real windows from being positioned outside the monitor workarea. Specifically, `constrain_partially_onscreen` fires unconditionally for normal windows and clamps position so that 10-75px remain visible. There is no public API to bypass this on GNOME 46.

The result: when a window's layout position extends past the screen edge (e.g. a 1504px-wide window at x=764 on a 1512px screen), the real window gets clamped to ~x=8 while the clone renders correctly at x=764. **Clicks land on the wrong part of the window** — the user clicks a button visible at clone offset x=136, but the real window receives the click at x=914.

### Constraint bypass research (exhaustive)

| Approach | Result |
|----------|--------|
| `move_resize_frame(true, ...)` (user_op=true) | Bypasses `constrain_fully_onscreen` but NOT `constrain_partially_onscreen` |
| `move_resize_frame(false, ...)` | Constrained by both |
| `move_frame(true/false, ...)` | Same — constrained |
| `Actor.set_position()` | Moves visual, input still routed to logical frame rect |
| Window type DOCK/DESKTOP | Bypasses both, but can't change type from JS |
| `placement_rule` | Bypasses both, but private field |
| `require_fully_onscreen` | Not exposed via public API |
| Override-redirect | X11 only, unmanaged |
| `MetaExternalConstraint` | GNOME 48+ only |
| `org.gnome.mutter edge-tiling` | Already false, unrelated |

**Conclusion: no loophole exists on GNOME 46.** Real windows cannot be freely positioned.

## Current architecture

```
kestrel-layer (clip_to_allocation, above window_group)
├── overview-bg
├── kestrel-strip
│   └── kestrel-ws-{id} (per workspace)
│       └── kestrel-scroll-{id} (horizontal scroll offset)
│           └── kestrel-clone-{windowId} (wrapper, reactive:false, clip_to_allocation)
│               └── Clutter.Clone (source: WindowActor)
└── kestrel-focus-indicator
```

- Clone wrappers are `reactive: false` — events pass through to real windows underneath
- Real `WindowActor`s are at `opacity: 0` (invisible but still receive Wayland input)
- WindowAdapter clamps `screenX` to monitor bounds (line 127) — an existing workaround that keeps Mutter happy but misaligns input

### Where misalignment occurs

Misalignment happens when `wl.x - layout.scrollX` places the window outside `[monitorMinX, monitorMinX + monitorWidth - windowWidth]`. This occurs for:

1. **Wide windows (slotSpan >= 2)** that extend past the right screen edge
2. **Any window** during scroll animation where the viewport is between positions
3. **Oversized windows** (e.g. Chromium refusing resize) where compensation shifts the frame

## Design: Stage-level event interception

### Approach

Instead of relying on click-through to misaligned real windows, intercept pointer events at the stage level, determine which clone the pointer is over, compute the correct coordinate within that window, and re-route the event.

### Event flow (proposed)

```
User clicks at screen (sx, sy)
  → Stage captures event (reactive overlay on kestrel-layer)
  → Hit-test against clone wrappers in current workspace
  → Found clone for windowId at wrapper position (cx, cy)
  → Compute window-relative offset: (sx - cx, sy - cy)
  → Adjust for clone centering offset (oversized frames)
  → Route: focus the window + synthesize click at correct position
  → Consume original event (EVENT_STOP)
```

### Key challenges

#### 1. Synthesizing input events on Wayland

On Wayland, the compositor (Mutter) owns the input pipeline. Extensions cannot synthesize `wl_pointer` events that applications receive. There is no `XSendEvent` equivalent.

**Workaround options:**

a) **Focus + real window alignment for focused window only**: When a window receives focus (via clone click), immediately move the real window to match the clone position as closely as Mutter allows. For the *focused* window, ensure scrollX positions it within monitor bounds. This is the PaperWM approach.

b) **Transparent reactive overlay**: Place a reactive `Clutter.Actor` over the clone layer that captures all pointer events. For simple clicks, translate to `Meta.Window.activate()` + focus. For complex interactions (typing, scrolling within the window), let events pass through to the real window — but this only works if the real window is aligned.

c) **Virtual input device**: Use `Clutter.VirtualInputDevice` to synthesize pointer events at translated coordinates. This operates at the Clutter level and may not reach Wayland clients reliably.

#### 2. Beyond clicks: hover, drag, scroll, keyboard

Click interception alone doesn't solve:
- Hover states (CSS `:hover`, tooltips)
- Drag operations within the window
- Scroll events within the window
- Text selection
- Context menus at correct position

All of these require the real window to be at the correct position.

### Recommended design: Focused-window alignment

Given that synthesizing arbitrary Wayland input is not feasible from an extension, the pragmatic design is:

**Ensure the focused window's real position always matches its clone position.**

#### How it works

1. **Scroll-to-fit on focus**: When a window receives focus, compute scrollX such that the entire focused window fits within monitor bounds. The domain already does this — `scrollX` is chosen to make the focused window visible.

2. **Real window tracks clone for focused window**: In `WindowAdapter.applyLayout()`, position the focused window at its exact layout position (it will fit because scrollX was chosen for it). Non-focused windows may be misaligned, but that's fine — you can't interact with them without first focusing them.

3. **Click-to-focus via clone hit-testing**: Add a transparent reactive layer that captures clicks in normal mode. On click:
   - Hit-test to find which clone wrapper contains the pointer
   - Call domain `setFocus(windowId)` — this triggers a new layout with scrollX adjusted for the newly focused window
   - Apply layout — real window moves to match clone (now within bounds)
   - **Let the next click land correctly** on the now-aligned real window

4. **Partial visibility edge case**: For windows wider than the monitor (slotSpan >= 2), even the focused window can't fully fit. In this case:
   - Position the real window at x=0 (left-aligned within monitor)
   - The clone shows it at the same x=0 (scrollX adjusted)
   - The rightmost portion extends past the monitor edge in the clone (clipped visually) — but the real window is also clipped by Mutter, so input aligns for the visible portion

#### What this solves

| Interaction | Aligned? |
|-------------|----------|
| Click on focused window | Yes — real window matches clone |
| Hover/drag on focused window | Yes |
| Scroll within focused window | Yes |
| Click on unfocused window | First click focuses (via hit-test), second click lands correctly |
| Keyboard input | Yes — focused window receives Wayland keyboard events |

#### What this doesn't solve perfectly

- **Single-click actions on unfocused windows**: The first click focuses instead of performing the intended action. This is acceptable — it matches how most tiling WMs work (focus-follows-click).
- **Hover on unfocused windows**: Tooltips won't appear on unfocused windows. Acceptable trade-off.

### Implementation plan

#### Phase 1: Click-to-focus overlay

1. Add a transparent reactive `Clutter.Actor` as the topmost child of `kestrel-layer`
2. Connect `button-press-event` on this overlay
3. On click: hit-test against clone wrappers (reuse overview hit-test logic adapted for normal mode)
4. If a clone is hit: call `setFocus(windowId)` → triggers layout recompute → real window aligns
5. Propagate the event so the real window also receives the click (if already aligned)

#### Phase 2: Ensure focused window alignment

1. In `WindowAdapter.applyLayout()`, skip the `screenX` clamping for the focused window (it should already fit due to scrollX)
2. Add assertion: focused window's layout position must be within monitor bounds after scrollX subtraction
3. For non-focused windows, continue clamping (or minimize — they don't need input)

#### Phase 3: Handle edge cases

1. Wide windows (slotSpan >= 2): verify the domain's scrollX places them as far left as possible
2. Scroll animation: during animated transitions, the intermediate positions may misalign briefly — accept this or pause input during animation (250ms)
3. Chromium oversized frames: the existing `_compensateOversized` centering logic should still work if the window fits within monitor bounds at its target position

### Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Synthesize Wayland events | Not possible from extension — Mutter owns the input pipeline |
| `Clutter.VirtualInputDevice` | Only generates Clutter-level events, may not reach Wayland clients |
| Resize real window to viewport slice | Content would render at wrong size; apps would see constant resize |
| Patch Mutter | Not portable, requires custom builds |
| Wait for GNOME 48 `MetaExternalConstraint` | Not available for ~1 year; users are on GNOME 46 now |

### Open questions

1. Should the click-to-focus overlay consume the event or propagate it? If we propagate, the now-misaligned real window gets a wrong-position click. If we consume, the user must click twice (once to focus, once to act). **Recommendation**: consume, accept double-click UX for unfocused windows.

2. Should we hide (minimize) non-focused windows entirely instead of keeping them at opacity=0? This would prevent any stray input from reaching misaligned windows. Downside: `Clutter.Clone` needs `enable_paint_unmapped` to render minimized windows (already works per line 184 comment in window-adapter.ts).

3. During scroll animation (250ms), the focused window may briefly misalign. Should we block input during animation? Or accept the brief misalignment?
