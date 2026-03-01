# Window Stacking & Configurable Columns

## Motivation

On large monitors (e.g. Samsung Odyssey Ark), having only two columns per screen is limiting. Two changes address this:

1. **Configurable column count** — Allow more than two visible columns per viewport.
2. **Vertical stacking** — Combine multiple windows into a single column, splitting height between them.

These features work together: more columns make individual columns narrower, and stacking lets you reclaim vertical real estate within those columns.

## Notation

Extended textual model notation for stacked windows:

```
/   column separator within a stack (windows share horizontal slot)

Example — two workspaces, B and C stacked on WS1:

A
<[B/C] D>
E

Meaning: WS0 has A. WS1 (current) has a column of B and C (B focused),
and D in its own column. WS2 has E.
```

Stacks are always shown top-to-bottom: `B/C` means B is above C.

## Feature 1: Configurable Column Count

### Behavior

A new GSettings key `column-count` (integer, default 2, range 1–6) controls how many columns fill the viewport width.

```
slotWidth = totalWidth / columnCount
```

Everything else follows: `slotSpan: 1` fills one column, `slotSpan: 2` fills two columns. The viewport scroll model is unchanged — horizontal scrolling still works when a workspace has more windows than the column count.

### Config change

```typescript
export interface KestrelConfig {
    // ... existing fields ...
    readonly columnCount: number;  // NEW: default 2
}
```

`MonitorInfo.slotWidth` becomes a derived value:
```typescript
slotWidth = totalWidth / config.columnCount
```

Currently `slotWidth` lives on `MonitorInfo` and is set once from monitor geometry. It moves to be computed from `config.columnCount` + `monitor.totalWidth` wherever layout needs it. This is a small refactor — `slotWidth` stays on `MonitorInfo` but is recomputed when config or monitor changes.

### Super+F behavior change

With configurable columns, `Super+F` gains a clearer role: **maximize the focused column to fill the full viewport width**.

| Before | After Super+F | After Super+F again |
|--------|--------------|---------------------|
| `<[A] B C>` (3 columns) | `<[A]>` (A fills viewport) | `<[A] B C>` (back to 1-slot) |

Implementation: `toggleSize` cycles between `slotSpan: 1` and `slotSpan: columnCount`. For the default 2-column setup, behavior is identical to today. For 3+ columns, Super+F makes a window span the full viewport rather than just doubling.

## Feature 2: Vertical Stacking

### Data model: Column-centric

Replace the flat `TiledWindow[]` in `Workspace` with a `Column[]`:

```typescript
/** A vertical column containing one or more stacked windows. */
export interface Column {
    readonly windows: readonly TiledWindow[];
    readonly slotSpan: number;  // horizontal width in slots (1 to columnCount)
}

export interface Workspace {
    readonly id: WorkspaceId;
    readonly columns: readonly Column[];
    readonly name: string | null;
}
```

A column with one window behaves identically to today's single `TiledWindow`. A column with N windows splits the available height equally (minus gaps) among them.

The `Column` type does not need an explicit ID — it is identified by its index within `Workspace.columns`. Windows retain their `WindowId` identity.

`TiledWindow` is unchanged — it still has `id`, `slotSpan`, and `fullscreen`. The `slotSpan` property moves to `Column` since all windows in a column share the same width. The `TiledWindow.slotSpan` field is removed.

```typescript
export interface TiledWindow {
    readonly id: WindowId;
    readonly fullscreen: boolean;
    // slotSpan removed — lives on Column now
}
```

### Layout

`computeWindowPositions` changes from iterating `ws.windows` to iterating `ws.columns`:

```
for each column in ws.columns:
    windowWidth = column.slotSpan * slotWidth - gapSize
    stackCount = column.windows.length
    stackHeight = (totalWindowHeight - (stackCount - 1) * gapSize) / stackCount

    for each (i, window) in column.windows:
        y = windowY + i * (stackHeight + gapSize)
        emit WindowPosition { windowId, x, y, width: windowWidth, height: stackHeight }

    x += windowWidth + gapSize
```

This naturally produces correct positions: single-window columns get full height (same as today), multi-window columns split height equally.

### Stack/unstack operation: Super+J (Join)

`Super+J` is a toggle operation on the focused window:

**Stack (focused window is alone in its column):**
Merge the focused window's column with the column to its left. The focused window is appended to the bottom of the left neighbor's stack.

```
<A [B] C> → Super+J → <A/[B] C>
```

If there is no left neighbor, this is a no-op.

**Unstack (focused window is in a multi-window column):**
Pop the focused window out of its column into its own new column, inserted immediately to the right of the source column.

```
<A/[B] C> → Super+J → <A [B] C>
```

If the source column had only two windows, the remaining window stays as a single-window column (no special unwrapping needed — a column with one window is the normal state).

### Domain operations

New functions in the domain:

```typescript
/** Stack the focused window with its left neighbor column. */
export function stackWithLeft(world: World): WorldUpdate

/** Pop the focused window out of its column into a new column to the right. */
export function unstackWindow(world: World): WorldUpdate

/** Toggle: stack if solo, unstack if stacked. */
export function toggleStack(world: World): WorldUpdate
```

### Keybinding summary

New and changed bindings:

| Binding | Action | Notes |
|---------|--------|-------|
| Super+J | Toggle stack/unstack (Join) | Stack with left neighbor, or pop out |
| Super+Up | Focus up (overloaded) | Within stack: focus window above. At top of stack: switch to workspace above |
| Super+Down | Focus down (overloaded) | Within stack: focus window below. At bottom of stack: switch to workspace below |
| Super+Alt+Up | Force workspace up | Always switches workspace, even from middle of stack |
| Super+Alt+Down | Force workspace down | Always switches workspace, even from middle of stack |
| Super+Shift+Up | Move window up in stack | Reorder within column. At top: move to workspace above |
| Super+Shift+Down | Move window down in stack | Reorder within column. At bottom: move to workspace below |
| Super+Left/Right | Focus left/right | Moves between columns (not within a stack) |
| Super+Shift+Left/Right | Move column left/right | Swaps the entire column (unchanged) |
| Super+F | Toggle full-viewport width | Sets column slotSpan to columnCount (maximized) or 1 |

### Overloaded vertical navigation: Super+Up/Down

Super+Up/Down now has two behaviors depending on context:

**Within a stack** — move focus to the window above/below in the same column:
```
<[A/B] C> → Super+Down → <A/[B] C>
```

**At stack boundary** — switch to the workspace above/below (existing behavior):
```
<A/[B] C> → Super+Down → (focus moves to workspace below, slot-targeted)
```

For single-window columns (the common case and all of today's windows), behavior is unchanged — Super+Up/Down always switches workspaces.

**Super+Alt+Up/Down** — forced workspace switch. Always changes workspace regardless of stack position. Useful when you're in the middle of a stack and want to jump workspaces without navigating to the edge first.

### Overloaded vertical move: Super+Shift+Up/Down

**Within a stack** — reorder the focused window within its column:
```
<[A/B] C> → Super+Shift+Down → <B/[A] C>
```

**At stack boundary** — move window to the workspace above/below (existing behavior). The window leaves its current column (which may shrink or disappear) and arrives as a new single-window column in the target workspace, slot-targeted:
```
<A/[B]> → Super+Shift+Down (B is at bottom of stack) →
  WS0: <A>
  WS1: <[B]>
```

### Horizontal navigation with stacks

**Super+Left/Right** navigates between columns. When entering a column that contains a stack, which window gets focus?

**Rule: focus the window at the matching vertical position.** If the source window was at position i (0-indexed) in its column, focus position i in the target column (clamped to the last window if the target stack is shorter). For single-window columns (most common case), this always focuses the only window.

```
<A/B [C/D]> → Super+Left → <A/[B] C/D>
    (D was at position 1, so B at position 1 gets focus)
```

This mirrors the slot-based targeting used for cross-workspace vertical navigation — same principle, applied to the intra-column axis.

To track the "last focused position" cleanly, the `World` can store a `focusedColumnPosition: number` that updates whenever focus changes. Alternatively, compute it on the fly from the focused window's position in its column. The on-the-fly approach is simpler and avoids stale state.

### Horizontal move with stacks: Super+Shift+Left/Right

**Moves the entire column** (all stacked windows together), swapping with the adjacent column. The individual window that has focus does not change — the whole column moves as a unit.

```
<A [B/C]> → Super+Shift+Right → <[B/C] A>
```

This is the existing behavior generalized: today it swaps single windows, now it swaps columns.

### Window add/remove with stacks

**Add:** New windows always create a new single-window column appended to the end of the current workspace. Stacking is always an explicit user action (`Super+J`).

**Remove:** When a window is removed from a multi-window column, the column shrinks. Remaining windows expand vertically to fill the space. If the column becomes empty (last window removed), the column itself is removed.

Focus after removal within a stack: prefer the window below, then the window above, then horizontal neighbor rules.

### Fullscreen with stacks

When a window in a stack enters fullscreen, it covers the full screen (existing behavior). The rest of the stack is hidden. When fullscreen exits, the stack layout is restored.

### Overview mode

Overview is a zoomed-out view of the entire world. Stacked windows render at their actual positions — they already have distinct `x`, `y`, `width`, `height` from layout computation. The overview just scales everything down uniformly, so stacks naturally appear as vertically divided columns in the minimap.

```
Overview of:  <A/B C>  renders as:

  ┌───┬───┐
  │ A │   │
  ├───┤ C │
  │ B │   │
  └───┴───┘
```

No special overview logic is needed. Hit-testing already uses per-window positions, so clicking a stacked window in overview selects that specific window.

### State persistence

The serialization format needs to encode the column structure:

```typescript
export interface RestoreColumnData {
    readonly windows: readonly TiledWindow[];
    readonly slotSpan: number;
}

export interface RestoreWorkspaceData {
    readonly columns: readonly RestoreColumnData[];
    readonly name: string | null;
}
```

## Architecture Impact

### Domain layer changes

| File | Change |
|------|--------|
| `types.ts` | Add `columnCount` to `KestrelConfig` |
| `window.ts` | Remove `slotSpan` from `TiledWindow` |
| `workspace.ts` | Replace `windows: TiledWindow[]` with `columns: Column[]`. All functions updated. New `Column` type and column operations |
| `layout.ts` | `computeWindowPositions` iterates columns, splits height for stacked windows |
| `scene.ts` | Minimal — already per-window. Passes through new y/height values |
| `navigation.ts` | `focusHorizontal`: navigate between columns with vertical position matching. `focusVertical`: overloaded stack-then-workspace logic |
| `window-operations.ts` | `moveHorizontal`: swap columns. `moveVertical`: overloaded stack-reorder-then-workspace. `toggleSize`: cycle between 1 and `columnCount`. New `toggleStack` |
| `world.ts` | `addWindow`: creates single-window column. `removeWindow`: removes from within column, cleans up empty columns. `findWindowInWorld`: searches inside columns |
| `overview-state.ts` | No change — overview transform/hit-test already uses per-window positions |

### Workspace operations migration

All workspace functions change from operating on `windows: TiledWindow[]` to `columns: Column[]`:

| Current | New |
|---------|-----|
| `addWindow(ws, window)` | `addColumn(ws, column)` — append a new column |
| `removeWindow(ws, windowId)` | `removeWindowFromColumn(ws, windowId)` — remove window, clean up empty column |
| `windowNeighbor(ws, windowId, delta)` | `columnNeighbor(ws, windowId, delta)` — find adjacent column |
| `swapNeighbor(ws, windowId, delta)` | `swapColumns(ws, columnIndex, delta)` — swap entire columns |
| `slotIndexOf(ws, windowId)` | `slotIndexOf(ws, windowId)` — still works, accumulates column.slotSpan |
| `windowAtSlot(ws, slotIndex)` | `columnAtSlot(ws, slotIndex)` — returns the column at a slot |
| `replaceWindow(ws, windowId, newWindow)` | `replaceWindowInColumn(ws, windowId, newWindow)` — searches inside columns |

New operations:

| Function | Purpose |
|----------|---------|
| `stackWindowLeft(ws, windowId)` | Merge focused window's column into left neighbor |
| `unstackWindow(ws, windowId)` | Pop window out of its column into a new column |
| `columnOf(ws, windowId)` | Find which column contains a window |
| `positionInColumn(column, windowId)` | Get 0-based index within a column's stack |
| `reorderInColumn(ws, windowId, delta)` | Move window up/down within its column |

### Adapter layer changes

**Clone adapter:** Currently creates one clone wrapper per window. With stacking, clones within a column have different `y` and `height` values — but this is already how the adapter works. It positions each clone per its `CloneScene` values. No structural change needed, just different position values flowing through.

**Window adapter:** Same as clone adapter — `move_resize_frame()` gets different `y` and `height` values for stacked windows. No structural change.

**Keybinding adapter:** Register new keybindings: `join-stack` (`Super+J`), `force-workspace-up` (`Super+Alt+Up`), `force-workspace-down` (`Super+Alt+Down`).

### GSettings schema changes

```xml
<key name="column-count" type="i">
  <default>2</default>
  <range min="1" max="6"/>
  <summary>Number of columns per viewport</summary>
</key>
```

## Implementation Order

1. **Configurable column count** — Add `columnCount` to config, derive `slotWidth`, update `toggleSize` to cycle `1 ↔ columnCount`. Fully independent of stacking.

2. **Column data model** — Introduce `Column` type, migrate `Workspace` from `windows[]` to `columns[]`. Each existing window becomes a single-window column. All existing tests must pass with identical behavior.

3. **Layout for stacks** — Update `computeWindowPositions` to split height within multi-window columns.

4. **Stack/unstack operations** — `toggleStack` domain function + `Super+J` keybinding.

5. **Overloaded vertical navigation** — Update `focusUp`/`focusDown` to navigate within stacks first. Add `Super+Alt+Up/Down` for forced workspace switch.

6. **Overloaded vertical move** — Update `moveUp`/`moveDown` to reorder within stacks first.

7. **Horizontal navigation position matching** — When entering a column, match vertical position.

8. **Persistence** — Update save/restore to serialize column structure.

## Edge Cases

- **Stack + fullscreen:** Only one window in a stack can be fullscreen. Fullscreen takes over the whole screen, not just the column's area.
- **Stack + slotSpan 2:** A column can be wide (slotSpan 2) and also contain stacked windows. `Super+F` changes the column's slotSpan, affecting all windows in the stack.
- **Remove last window from a stack that's also the last column:** Standard workspace pruning handles this — empty workspace gets removed.
- **Stack all windows into one column:** Valid state. The workspace has one very tall stack. Horizontal navigation has nowhere to go; vertical navigation moves within the stack and then across workspaces.
- **Unstack in a workspace that would exceed viewport:** Valid. The new column is created and viewport scrolls to keep focus visible (existing `adjustViewport` behavior).
- **Super+J with no left neighbor (first column):** No-op.
- **Overview with deep stacks:** Windows in a 4+ deep stack will be very small in overview. This is acceptable — the overview is a map, and small windows still show their clone content at reduced scale.
