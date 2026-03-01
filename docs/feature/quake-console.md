# Quake Console

## Motivation

Some applications are task-independent or task-spanning: chat (MS Teams, Slack), email, music players, system monitors. These don't belong on any particular workspace — you want instant access regardless of which tiled workspace you're on.

Quake console provides up to 5 hotkey-bound application slots (Super+W/E/R/T/Z) that overlay-float in from the top of the screen, like the classic Quake terminal. Only one overlay can be active at a time. A second press on the same hotkey dismisses it. Configured apps are pre-launched on startup so they are ready instantly.

## Behavior

### Hotkey toggle

Each slot has a dedicated keybinding. Pressing the hotkey cycles through three states:

1. **App not running** — Launch the configured application. When its window appears, slide it in.
2. **App running, overlay hidden** — Slide the window in from the top.
3. **App running, overlay visible** — Slide the window out to the top.

If a different quake overlay is already visible when a hotkey is pressed, the current overlay slides out first, then the new one slides in.

### Geometry

The overlay window is pinned to the top of the work area, horizontally centered:

```
┌──────────────────────────────────────────┐  ← top panel
│   ┌────────────────────────────────┐     │  ← flush with work area top
│   │                                │     │
│   │        Quake window            │     │
│   │        80% × 80%              │     │
│   │                                │     │
│   └────────────────────────────────┘     │
│                                          │
│   ┌──────┬──────┐  tiled windows         │
│   │      │      │  (underneath)          │
└───┴──────┴──────┴────────────────────────┘
```

```
x = stageOffsetX + (totalWidth * 0.1)
y = workAreaY
width = totalWidth * 0.8
height = totalHeight * 0.8
```

### Animation

- **Slide in:** Window starts at `y = workAreaY - 100px` (above the screen), eases to `y = workAreaY`. Duration ~250ms, ease-out-quad. Opacity 0 to 255.
- **Slide out:** Eases from current y to `y = workAreaY - 100px`. On completion, minimize the window. Opacity 255 to 0.

The animation operates on the real `Meta.WindowActor` (not a clone) since the user interacts with the quake window directly.

### Focus

- When a quake overlay slides in, it receives keyboard focus via `Main.activateWindow()`.
- When it slides out, focus returns to the previously focused tiled window (the domain's `focusedWindow`).
- External focus changes (clicking a tiled window while quake is visible) dismiss the quake overlay.

### Window matching

When a new window is created, the adapter checks if it matches a quake slot's configured app ID:

1. Look up the window's app via `Shell.WindowTracker.get_default().get_window_app(metaWindow)`.
2. Compare `app.get_id()` against the configured slot app IDs.
3. If it matches an unoccupied slot, route it to the domain as a quake window instead of a tiled window.

If multiple windows exist for the same app (e.g., two terminal windows), only the first one is assigned to the quake slot. Subsequent windows tile normally.

### App launching

When a slot's hotkey is pressed and no matching window exists:

```typescript
const appSystem = Shell.AppSystem.get_default();
const app = appSystem.lookup_app(desktopAppId);
if (app) app.open_new_window(-1);
```

The window-created handler will assign the resulting window to the slot when it appears.

## Configuration

### GSettings schema

5 string keys for desktop app IDs, plus geometry overrides:

```xml
<key name="quake-slot-1" type="s">
  <default>''</default>
  <summary>Quake slot 1 application</summary>
  <description>Desktop app ID for quake slot 1 (e.g. 'org.gnome.Terminal.desktop')</description>
</key>
<!-- quake-slot-2 through quake-slot-5: same pattern -->

<key name="quake-width-percent" type="i">
  <default>80</default>
  <range min="20" max="100"/>
  <summary>Quake window width percentage</summary>
</key>
<key name="quake-height-percent" type="i">
  <default>80</default>
  <range min="20" max="100"/>
  <summary>Quake window height percentage</summary>
</key>
```

5 keybinding keys:

```xml
<key name="quake-slot-1-toggle" type="as">
  <default>['&lt;Super&gt;w']</default>
  <summary>Toggle quake slot 1</summary>
</key>
<!-- quake-slot-2-toggle through quake-slot-5-toggle: Super+E/R/T/Z -->
```

### Config in domain types

```typescript
export interface QuakeSlotConfig {
    readonly appId: string;        // desktop app ID, empty = disabled
}

export interface KestrelConfig {
    // ... existing fields ...
    readonly quakeSlots: readonly QuakeSlotConfig[];
    readonly quakeWidthPercent: number;
    readonly quakeHeightPercent: number;
}
```

## Architecture

### Domain-integrated design

Quake console state lives **inside the domain `World` model**. This keeps the domain as the single source of truth for all window state and eliminates the need for window interception hacks. Quake windows are just another category of window that the domain knows about, alongside tiled windows.

The domain tracks:
- Which `WindowId` is assigned to each quake slot (0–4)
- Which slot is currently active (visible)
- Quake window geometry (computed from config + monitor)

The domain does NOT know about:
- Desktop app IDs or `Shell.AppSystem` (adapter concerns)
- Animation state (adapter concern)
- Whether an app is installed/running (adapter concern)

### Domain model

```typescript
// In types.ts
export interface QuakeState {
    readonly slots: readonly (WindowId | null)[];   // 5 slots, null = empty
    readonly activeSlot: number | null;             // which slot is visible, null = all hidden
}

// Added to World
export interface World {
    // ... existing fields ...
    readonly quakeState: QuakeState;
}
```

### Domain operations

New functions in `src/domain/quake.ts`:

```typescript
/** Assign a window to a quake slot. Removes it from tiling if present. */
export function assignQuakeWindow(world: World, slotIndex: number, windowId: WindowId): WorldUpdate

/** Toggle a quake slot's visibility. Returns updated world + scene. */
export function toggleQuakeSlot(world: World, slotIndex: number): WorldUpdate

/** Dismiss the active quake overlay (if any). */
export function dismissQuake(world: World): WorldUpdate

/** Release a quake window (e.g. window destroyed). Clears the slot. */
export function releaseQuakeWindow(world: World, windowId: WindowId): WorldUpdate

/** Check if a window is assigned to any quake slot. */
export function isQuakeWindow(world: World, windowId: WindowId): boolean
```

### Scene model

`computeScene` produces quake window entries alongside tiled window entries:

```typescript
// Added to SceneModel
export interface QuakeWindowScene {
    readonly windowId: WindowId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;      // true when activeSlot matches this slot
}

export interface SceneModel {
    // ... existing fields ...
    readonly quakeWindow: QuakeWindowScene | null;  // the active quake window, if any
}
```

Only the active quake window needs a scene entry — hidden quake windows are minimized and need no positioning.

### Data flow

```
Window created
  → WindowEventAdapter fires onWindowReady (normal path, no interception)
  → WindowLifecycleHandler checks: does this window match a quake slot?
    → YES: calls assignQuakeWindow(world, slotIndex, windowId)
            domain adds to quakeState, does NOT add to workspace
    → NO:  calls addWindow(world, windowId) as usual

Hotkey press (Super+W)
  → extension.ts handler calls toggleQuakeSlot(world, 0)
  → domain flips activeSlot, returns WorldUpdate with scene
  → adapter applies scene: positions real window, animates slide in/out

External focus change
  → if quake overlay is active, call dismissQuake(world)
  → domain clears activeSlot, returns WorldUpdate
  → adapter slides out the quake window
```

### Window lifecycle handler changes

`WindowLifecycleHandler.handleWindowReady` gains quake matching logic:

```typescript
handleWindowReady(windowId: WindowId, metaWindow: Meta.Window): void {
    // Check if this window matches a quake slot
    const slotIndex = this._matchQuakeSlot(metaWindow);
    if (slotIndex !== null) {
        const update = assignQuakeWindow(this._getWorld(), slotIndex, windowId);
        this._setWorld(update.world);
        this._applyQuakeScene(update);
        return;
    }
    // ... existing tiling logic ...
}
```

The `_matchQuakeSlot` function uses `Shell.WindowTracker` to match by app ID — this is adapter-level logic that lives in the handler, not the domain. The domain just receives the slot assignment.

### Quake window adapter

A lightweight adapter handles the GNOME-specific side of quake windows:

```
┌──────────────────────────────────────────────────────────┐
│ QuakeWindowAdapter (src/adapters/quake-window-adapter.ts) │
│                                                           │
│ Responsibilities (adapter-level only):                    │
│   - Position real Meta.Window via move_resize_frame()     │
│   - Animate actor slide in/out (Clutter.ease)             │
│   - Set actor opacity (255 when visible, not clone-based) │
│   - Launch apps via Shell.AppSystem                       │
│   - Match windows to app IDs via Shell.WindowTracker      │
│   - Make window above (meta_window.make_above())          │
│   - Minimize/unminimize for hide/show                     │
│                                                           │
│ NO state management — all state lives in domain World.    │
└──────────────────────────────────────────────────────────┘
```

### removeWindow integration

When a quake window is destroyed, the existing `removeWindow` path needs to check quake state:

```typescript
handleWindowDestroyed(windowId: WindowId): void {
    if (isQuakeWindow(this._getWorld(), windowId)) {
        const update = releaseQuakeWindow(this._getWorld(), windowId);
        this._setWorld(update.world);
        // adapter cleanup (remove tracking, etc.)
        return;
    }
    // ... existing tiled window removal ...
}
```

### Minimize/unminimize handling

Quake windows use real `Meta.Window.minimize()` / `unminimize()` for hide/show. The existing `ShellAdapter` intercepts these globally and sets `actor.set_opacity(0)` — correct for tiled windows (which use clones) but wrong for quake windows (which need their real actor visible).

The shell adapter gets a predicate to exempt quake windows:

```typescript
// ShellAdapter receives a check function
setQuakeWindowCheck(fn: (actor: Meta.WindowActor) => boolean): void

// In unminimize handler:
if (!this._isQuakeWindow(actor)) {
    actor.set_opacity(0);  // only for tiled windows
}
```

### Actor stacking

Quake windows use `metaWindow.make_above()` to render above all normal windows and the Kestrel clone layer, but below GNOME's panel and modal dialogs.

### Interaction with existing features

| Feature | Interaction |
|---------|-------------|
| **Tiling** | Quake windows are assigned to `quakeState` in the domain, never added to workspaces. `addWindow` is not called for them. |
| **Float clones** | Quake windows go through `onWindowReady` (not `onFloatWindowReady`), but the handler routes them to quake assignment. No float clone is created. |
| **Overview** | Quake overlay dismissed on overview enter. Overview handler calls domain's `dismissQuake()`. |
| **Focus tracking** | External focus change to a tiled window calls `dismissQuake()`. |
| **Fullscreen** | Quake overlay appears on top of fullscreen windows (it's `above`). |
| **Notifications** | Notification overlay renders above everything. No conflict. |
| **Help overlay** | Same layer as notifications. No conflict. |
| **State persistence** | Quake slot assignments are persisted (window IDs in slots). On restore, windows are re-matched. |
| **Scene model** | `computeScene` checks `quakeState.activeSlot` and emits `QuakeWindowScene` for the visible quake window. |

## Slot state machine

```
               ┌──────────┐
               │  EMPTY    │  no window assigned to this slot
               └─────┬────┘
                     │ assignQuakeWindow(slotIndex, windowId)
                     ▼
               ┌──────────┐
        ┌──────│  HIDDEN   │  window assigned, minimized
        │      └─────┬────┘
        │            │ toggleQuakeSlot → activeSlot = this
        │            ▼
        │      ┌──────────┐
        │      │  VISIBLE  │  overlay showing, window focused
        │      └─────┬────┘
        │            │ toggleQuakeSlot / dismissQuake
        │            ▼
        │      ┌──────────┐
        └──────│  HIDDEN   │
               └─────┬────┘
                     │ releaseQuakeWindow (window destroyed)
                     ▼
               ┌──────────┐
               │  EMPTY    │
               └──────────┘
```

Animation (SLIDING_IN / SLIDING_OUT) is purely an adapter concern — the domain only knows HIDDEN vs VISIBLE (via `activeSlot`). The adapter manages transition animations when applying scene changes.

## Edge cases

- **Slot not configured (empty app ID):** Hotkey is a no-op.
- **App installed but closed:** Launch it. Claim window when it appears.
- **App has multiple windows:** Only the first window is assigned to the slot. Subsequent windows tile normally.
- **App ID typo / invalid:** `Shell.AppSystem.lookup_app()` returns null. Log a warning, no-op.
- **Window closed while visible:** `releaseQuakeWindow` clears the slot and `activeSlot`. No slide-out needed — actor is already gone.
- **Hotkey during slide animation:** If pressing the same slot's hotkey during slide-in, reverse the animation to slide out (and vice versa). If pressing a different slot's hotkey during animation, fast-forward the current animation, then toggle the new slot.
- **Monitor change:** Domain recomputes quake geometry via `updateMonitor`. Adapter repositions any visible overlay.
- **Extension disable:** Quake windows are unminimized and returned to normal. `make_above()` is cleared.
- **Same app in two slots:** Only the first matching slot gets the window. The second slot would need a separate instance.
- **Window already tiled, then config changes to make it a quake app:** Not handled automatically. User must close and reopen the window, or we add a "reclaim" pass on config change (future enhancement).

## Implementation order

1. **Domain types + operations** — `QuakeState` in `World`, `quake.ts` with pure functions, scene model extension.
2. **GSettings schema** — Add slot, keybinding, and geometry keys.
3. **Config reading** — Read quake config in `StatePersistence.readConfig()`.
4. **QuakeWindowAdapter** — Adapter for positioning, animation, app launching, window matching.
5. **WindowLifecycleHandler changes** — Route matching windows to quake assignment.
6. **Shell adapter cooperation** — Opacity exemption for quake windows.
7. **Keybinding wiring** — Add 5 callbacks to `KeybindingCallbacks`, register in `KeybindingAdapter`.
8. **Extension wiring** — Create adapter in `enable()`, wire keybindings + focus dismiss + overview dismiss.
9. **Settings reload** — React to quake config changes at runtime.
10. **Tests** — Domain unit tests for quake operations, scene computation with quake windows.

## Files to create/modify

| File | Action |
|------|--------|
| `src/domain/quake.ts` | **Create** — pure domain operations |
| `src/domain/types.ts` | Modify — add `QuakeState`, `QuakeSlotConfig`, quake config fields |
| `src/domain/scene.ts` | Modify — emit `QuakeWindowScene` |
| `src/domain/world.ts` | Modify — initialize `quakeState`, integrate quake into `removeWindow` |
| `src/adapters/quake-window-adapter.ts` | **Create** — GNOME adapter for positioning, animation, launching |
| `src/adapters/window-lifecycle-handler.ts` | Modify — route quake windows to domain |
| `src/adapters/shell-adapter.ts` | Modify — quake window opacity exemption |
| `src/adapters/keybinding-adapter.ts` | Modify — register quake keybindings |
| `src/ports/keybinding-port.ts` | Modify — add quake callbacks to interface |
| `src/adapters/state-persistence.ts` | Modify — read quake config, persist quake slot assignments |
| `src/extension.ts` | Modify — wire quake adapter + keybindings + dismiss hooks |
| `schemas/org.gnome.shell.extensions.kestrel.gschema.xml` | Modify — add quake keys |
| `test/domain/quake.test.ts` | **Create** — domain tests |
