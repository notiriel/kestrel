# Mouse Interaction Design

## Context

Kestrel uses clone-based rendering: real `WindowActor`s are hidden (opacity=0) and `Clutter.Clone`s are positioned on a custom layer above `global.window_group`. The user sees and interacts with clones, but Wayland still routes pointer input to the real (invisible) actors underneath.

This creates an important constraint: GNOME's native click-to-focus already works because clicking on a clone's screen area actually hits the hidden real window. The `FocusAdapter` detects the resulting focus change and updates the domain. Mouse interactions must work *with* this architecture, not fight it.

---

## 1. Click to Focus

### Current behavior (passive)

User clicks on a window clone area. Wayland delivers the click to the hidden real `WindowActor`. GNOME focuses the real window. `FocusAdapter.connectFocusChanged` fires, calling `setFocus(world, windowId)` in the domain. Viewport scrolls to show the focused window.

### Assessment

This already works. The passive approach is correct for normal tiling mode because:
- It respects GNOME's focus semantics (focus-follows-click, raise-on-click, etc.)
- It handles edge cases GNOME already handles (transient windows, dialogs, menu popups)
- It's zero additional code

**Decision: No active click-to-focus handler needed.** The passive `FocusAdapter` path is sufficient.

---

## 2. Super+Scroll — Navigate

### What the user does

Holds Super, scrolls the mouse wheel (or two-finger scroll on trackpad).

### What happens

| Input | Effect |
|---|---|
| Super + Scroll Down | Same as Super+Right — focus moves to next window |
| Super + Scroll Up | Same as Super+Left — focus moves to previous window |

The viewport scrolls horizontally if the newly focused window is outside the visible area, exactly as keyboard navigation does.

### Scroll source handling

**Discrete scroll (mouse wheel):** Each wheel "click" produces one `ScrollDirection.UP` or `ScrollDirection.DOWN` event. Each event triggers exactly one focus change.

**Smooth scroll (trackpad):** Produces `ScrollDirection.SMOOTH` events with continuous `[dx, dy]` deltas. Both axes are used independently:

- **dx (horizontal)** — focus left/right (same as Super+Left / Super+Right)
- **dy (vertical)** — workspace up/down (same as Super+Up / Super+Down)

Both axes accumulate independently and can trigger simultaneously (e.g., a diagonal swipe could change both focus and workspace in one gesture).

| Parameter | Value | Rationale |
|---|---|---|
| Accumulation threshold | 1.0 per axis (in scroll delta units) | One "page" of trackpad scroll. Prevents accidental navigation from small swipes. Matches GNOME's own scroll-to-switch-workspace threshold. |
| Accumulation reset | On Super release, or after 300ms of no scroll events | Prevents stale accumulated deltas from triggering unexpected navigation |

### State diagram

```
                  ┌─────────┐
                  │  Idle   │
                  └────┬────┘
                       │ scroll-event with Super held
                       ▼
              ┌────────────────┐
              │ Check direction │
              └───────┬────────┘
                      │
          ┌───────────┴───────────┐
          │ discrete              │ smooth
          ▼                       ▼
   ┌──────────────┐     ┌─────────────────────┐
   │ UP → focusUp  │     │ Accumulate dx and dy │
   │ DOWN → focusDn│     │ independently        │
   │ LEFT → focusL │     └──────────┬──────────┘
   │ RIGHT → focusR│          check each axis
   └──────────────┘     ┌──────────┴──────────┐
                        ▼                     ▼
                 ┌─────────────┐      ┌─────────────┐
                 │ |dx| >= 1.0 │      │ |dy| >= 1.0 │
                 │ focusL or R │      │ focusUp or Dn│
                 │ reset dx    │      │ reset dy     │
                 └─────────────┘      └─────────────┘
```

### Edge cases

- **No world / overview active**: Propagate event, do nothing.
- **Single window**: Domain's `focusRight`/`focusLeft` returns unchanged world. No visual change. Fine.
- **Rapid scrolling**: Each threshold crossing triggers one focus change. No debounce needed — the animation system handles retargeting naturally.
- **Diagonal trackpad swipe**: Both axes fire independently. A diagonal swipe can change focus and workspace in the same gesture.

---

## 3. Drag to Reorder (Overview Mode Only)

Drag-to-reorder is an **overview mode interaction**. In overview, the user sees all workspaces at a glance and can drag windows to reorder them within a workspace. This builds on the existing overview click-to-focus: click selects, drag reorders.

### What the user does

In overview mode, presses primary mouse button on a window clone, drags horizontally, releases.

### What happens

The dragged window swaps positions with neighbors as the pointer crosses swap thresholds. This is a **live reorder** — windows animate to their new positions during the drag, not just on drop.

### Detailed interaction

**Phase 1 — Drag start**

1. User clicks on a window clone in overview
2. Hit-test determines the clicked window (same logic as existing overview click handler)
3. Record: start position `(startX, startY)`, the hit window as the drag subject
4. Focus the drag subject (same as a regular overview click)
5. No visual change yet — indistinguishable from a normal click so far

**Phase 2 — Drag threshold**

6. Pointer moves. If total displacement from start < 16px: do nothing (prevents accidental drags during clicks)
7. If pointer is released before threshold: treat as a normal overview click (focus + confirm/exit overview)
8. Once threshold exceeded: enter active drag state

**Phase 3 — Live reorder**

9. As pointer moves horizontally, track displacement relative to the drag subject's **current overview position**
10. When pointer crosses the **midpoint of the neighboring window** (in overview-scaled coordinates), trigger a swap:
    - Moving right past neighbor's midpoint → `moveRight(world)`
    - Moving left past neighbor's midpoint → `moveLeft(world)`
11. After each swap, the drag subject is in a new position. Overview re-renders with the updated layout. Subsequent swaps are measured from the new position.
12. Swapped windows animate to their new overview positions.

**Phase 4 — Drop**

13. User releases mouse button
14. Exit overview — the windows are already in their final positions from the live swaps
15. Normal tiling layout applies with the new window order

**Phase 5 — Cancel**

16. Escape during drag: cancel drag, revert to pre-drag window order, stay in overview
17. Overview dismissed externally during drag: cancel drag, revert

### Coordinate transformation

Overview mode scales and offsets the entire workspace strip. Pointer coordinates must be reverse-transformed before hit-testing or midpoint comparison:

```
overviewX = (pointerX - offsetX) / scale - OVERVIEW_LABEL_WIDTH
overviewY = (pointerY - offsetY) / scale
```

This is the same transformation the existing overview click handler uses.

### Swap threshold calculation

```
Overview layout:  |  A  |  [B]  |  C  |  D  |     (scaled)
                               ↑
                      pointer starts here (on B)

Drag right → pointer crosses midpoint of C → swap B and C:

New layout:       |  A  |  C  |  [B]  |  D  |
```

The midpoint of the right neighbor = `neighbor.x + neighbor.width / 2` (in overview-scaled layout coordinates). When the reverse-transformed pointer X exceeds this, trigger `moveRight()`. Symmetrically for left.

After each swap, recompute layout to get new neighbor positions.

### Edge cases

- **No focused window / click misses all windows**: No-op, treat as background click
- **Window at edge of workspace**: `moveLeft`/`moveRight` returns unchanged world. No swap happens.
- **Double-width window (slotSpan=2)**: Works naturally — the domain's swap logic handles multi-slot windows. Threshold is at the midpoint of the neighbor regardless of size.
- **Rapid dragging past multiple windows**: Each midpoint crossing triggers one swap. Fast drags chain multiple swaps. Overview re-renders after each.
- **Vertical displacement during drag**: Ignored for now — only horizontal reorder within a workspace. (Cross-workspace drag is a future extension.)

---

## 4. Interaction Combinations & Conflicts

| Scenario | Behavior |
|---|---|
| Super+Scroll during overview drag | Ignored — drag takes priority |
| Overview toggled during drag | Cancel drag, exit overview |
| Window destroyed during drag | Cancel drag if the destroyed window is the drag subject |
| Escape during drag | Cancel drag, revert order, stay in overview |

---

## 5. Summary of Modifier Checks

| Interaction | Mode | Modifier | Event |
|---|---|---|---|
| Click to focus | Normal | None | (passive, handled by GNOME) |
| Scroll navigate | Normal | Super (MOD4_MASK) | `scroll-event` |
| Drag reorder | Overview | None (already modal) | `button-press-event` + `motion-event` + `button-release-event` |

---

## 6. Adapter Structure

**Super+Scroll** is handled by a new `MouseInputAdapter` that connects to `global.stage` scroll events in normal (non-modal) mode. It is deactivated during overview.

**Drag-to-reorder** is handled inside the existing `OverviewInputAdapter` / `OverviewHandler`, since it only operates during overview's modal input capture. The existing `button-press-event` handler is extended to track drag state.

### Lifecycle

```
Super+Scroll (MouseInputAdapter):
  enable()  → adapter.activate()   — connect stage scroll listener
  overview  → adapter.deactivate() — disconnect listener
  exit ovw  → adapter.activate()   — reconnect listener
  disable() → adapter.destroy()    — disconnect + cleanup

Drag reorder (OverviewInputAdapter):
  overview enter → activate() — already connects button-press-event
  overview exit  → deactivate() — already disconnects
  (drag state is internal to the overview input handler)
```
