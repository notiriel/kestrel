# Real World Model

## Problem

The domain currently outputs `LayoutState` — tile positions in workspace-relative coordinates. The adapters (clone-adapter, window-adapter, overview-handler) then do significant computation to translate this into concrete actor states: screen positions, visibility, opacity, minimization, focus indicator geometry, overview transforms, scroll offsets, and animation targets.

This adapter-side computation is:

- **Untestable** — it requires a running GNOME Shell session to verify
- **Duplicated** — frame compensation, workspace width, and coordinate transforms are computed independently in multiple adapters
- **The source of most bugs** — mismatches between clone positions and real window positions, incorrect visibility states, wrong animation targets
- **Slow to debug** — every fix requires a Wayland session restart, re-login, and manual verification

## Proposal

Introduce a **Scene Model** — a domain-computed description of the complete desired state of every physical entity on screen. The adapters become thin applicators that set actor properties to match the scene model.

```
Before:  World → LayoutState → [adapter computes positions] → actors
After:   World → LayoutState → SceneModel → [adapter applies] → actors
```

The Scene Model is a pure function of `World` + `LayoutState`. It lives in the domain, has no GNOME imports, and is fully unit-testable.

## What the Scene Model describes

Every physical entity the extension controls, with the exact properties the adapter needs to set:

### CloneScene (per window)

```typescript
interface CloneScene {
    windowId: WindowId;
    workspaceId: WorkspaceId;

    // Clone wrapper — the positionable container
    x: number;              // Screen X (layout X minus scrollX)
    y: number;              // Screen Y (layout Y, workspace-strip-relative)
    width: number;          // Layout-computed width
    height: number;         // Layout-computed height
    visible: boolean;       // Should the wrapper be visible at all
}
```

### RealWindowScene (per window)

```typescript
interface RealWindowScene {
    windowId: WindowId;

    // Target frame rect in screen coordinates
    x: number;
    y: number;              // Includes workAreaY offset
    width: number;
    height: number;

    // State flags
    opacity: number;        // 0 = hidden behind clone, 255 = fullscreen/visible
    minimized: boolean;     // true for windows on non-current workspaces
}
```

### FocusIndicatorScene

```typescript
interface FocusIndicatorScene {
    visible: boolean;
    x: number;              // Screen X, accounting for scroll and border width
    y: number;
    width: number;          // Includes border padding
    height: number;
}
```

### WorkspaceStripScene

```typescript
interface WorkspaceStripScene {
    y: number;                          // Strip offset (−workspaceIndex × monitorHeight)
    scrollXPerWorkspace: Map<WorkspaceId, number>;  // Per-workspace scroll container X
}
```

### OverviewScene (when overview is active)

```typescript
interface OverviewScene {
    transform: OverviewTransform;       // Scale + offset (already in domain)
    workspaceSlots: OverviewWorkspaceSlot[];
    backgroundVisible: boolean;
    filterText: string;
}

interface OverviewWorkspaceSlot {
    workspaceId: WorkspaceId;
    y: number;                          // Visual Y position (accounts for filtering)
    visible: boolean;                   // Hidden if filtered out
}
```

### Top-level scene

```typescript
interface SceneModel {
    clones: readonly CloneScene[];
    realWindows: readonly RealWindowScene[];
    focusIndicator: FocusIndicatorScene;
    workspaceStrip: WorkspaceStripScene;
    overview: OverviewScene | null;     // null when not in overview
}
```

## What computation moves into the domain

| Computation | Currently in | Moves to |
|---|---|---|
| Screen X (layout X − scrollX) | clone-adapter, window-adapter | `computeScene()` |
| Screen Y (layout Y + workAreaY) | window-adapter | `computeScene()` |
| Real window opacity (0 or 255) | window-adapter | `computeScene()` |
| Real window minimized state | window-adapter | `computeScene()` |
| Focus indicator rect | clone-adapter `_computeFocusRect` | `computeScene()` |
| Workspace strip Y offset | clone-adapter | `computeScene()` |
| Per-workspace scroll X | clone-adapter | `computeScene()` |
| Overview workspace slot positions | clone-adapter, overview-handler | `computeScene()` |
| Overview workspace visibility (filtering) | clone-adapter | `computeScene()` |

## What stays in adapters

| Responsibility | Why it stays |
|---|---|
| Creating/destroying Clutter actors | Requires `gi://` APIs |
| Animation easing (`actor.ease()`) | Requires Clutter runtime |
| Clone offset (buffer vs frame rect) | Requires reading live `Meta.Window` geometry — async, GNOME-specific |
| Signal handling (size-changed, position-changed) | GNOME Shell signals |
| Settlement detection | Requires reading live frame rects |
| GObject lifecycle (init, destroy) | GNOME runtime |

## The `computeScene` function

A pure function in `src/domain/scene.ts`:

```typescript
function computeScene(world: World, layouts: LayoutState[]): SceneModel
```

Takes the world and layouts for all workspaces. Returns the complete scene. This function is the single place where screen coordinates, visibility, opacity, and indicator geometry are computed.

The `layouts` parameter is an array of `LayoutState`, one per workspace. `layouts[world.viewport.workspaceIndex]` is the current workspace layout (with viewport-based visibility). The rest have `visible: true` for all windows (used for off-screen positioning).

## How adapters change

### Before (clone-adapter.applyLayout)

```
receive LayoutState
for each window:
    compute screen position (x - scrollX, y)
    compute focus rect (x - scrollX - border, y - border, ...)
    animate wrapper to position
set scroll container X = -scrollX
set strip Y = -wsIndex * monitorHeight
```

### After (clone-adapter.applyScene)

```
receive SceneModel
for each clone in scene.clones:
    animate wrapper to (clone.x, clone.y, clone.width, clone.height)
    set wrapper.visible = clone.visible
animate focus indicator to scene.focusIndicator rect
set strip Y = scene.workspaceStrip.y
for each workspace scroll: set container X = -scrollX
```

The adapter no longer does coordinate math. It just applies values.

### Before (window-adapter.applyLayout)

```
receive LayoutState
for each window:
    compute screenX = wl.x - layout.scrollX
    compute screenY = wl.y + workAreaY
    call move_resize_frame(screenX, screenY, width, height)
    decide minimization based on visibility
    decide opacity based on fullscreen state
```

### After (window-adapter.applyScene)

```
receive SceneModel
for each realWindow in scene.realWindows:
    call move_resize_frame(rw.x, rw.y, rw.width, rw.height)
    set minimized = rw.minimized
    set opacity = rw.opacity
```

## Testing strategy

The scene model enables a new class of tests that previously required a GNOME session:

```typescript
// Test: real window positioned behind its clone
test('real window matches clone position plus workAreaY', () => {
    const world = createWorld(config, monitor);
    // ... add windows, set focus ...
    const scene = computeScene(world, [computeLayout(world)]);

    const clone = scene.clones.find(c => c.windowId === winId)!;
    const real = scene.realWindows.find(r => r.windowId === winId)!;

    expect(real.x).toBe(clone.x);
    expect(real.y).toBe(clone.y + monitor.workAreaY);
});

// Test: off-screen windows are minimized
test('windows on non-current workspace are minimized', () => {
    // ... world with 2 workspaces, viewing ws 0 ...
    const scene = computeScene(world, layouts);
    const ws1Windows = scene.realWindows.filter(r =>
        world.workspaces[1].windows.some(w => w.id === r.windowId));

    for (const rw of ws1Windows) {
        expect(rw.minimized).toBe(true);
        expect(rw.opacity).toBe(0);
    }
});

// Test: focus indicator wraps the focused clone
test('focus indicator surrounds focused window', () => {
    const scene = computeScene(world, layouts);
    const focused = scene.clones.find(c => c.windowId === world.focusedWindow)!;
    const border = world.config.focusBorderWidth;

    expect(scene.focusIndicator.x).toBe(focused.x - border);
    expect(scene.focusIndicator.width).toBe(focused.width + border * 2);
});
```

## Diagnostic diff

With the scene model in place, a diagnostic function becomes straightforward:

```typescript
// In domain — pure, testable
function diffScene(expected: SceneModel, actual: SceneModel): SceneMismatch[]

// In adapter — reads reality, builds an actual SceneModel
function captureActualScene(): SceneModel  // reads actor positions, window rects
```

Expose via DBus `GetDiagnostics` → returns the diff as JSON. This directly addresses the original debugging problem: "is the real window behind the clone?"

## Migration path

1. **Add `src/domain/scene.ts`** with `SceneModel` types and `computeScene()` — pure domain, no adapter changes yet
2. **Add tests** for `computeScene()` covering the bug classes we've hit: clone/window position mismatch, visibility, minimization, focus indicator, overview transforms
3. **Refactor clone-adapter** to consume `SceneModel` instead of computing positions from `LayoutState`
4. **Refactor window-adapter** similarly
5. **Add diagnostic capture** — adapter reads reality back into a `SceneModel`, domain diffs against expected
6. **Extend to overview** — move overview slot positioning and filtering visibility into scene computation

Steps 1–2 are additive and risk-free. Steps 3–4 are the refactor. Steps 5–6 are enhancements.

## Scope boundary

The scene model describes **what the screen should look like**. It does not describe **how to get there** (animations, easing, durations). Animation intent is a separate concern — the adapter decides whether to `ease()` or `set()` based on whether the scene changed and the current mode (e.g., animate during navigation, snap during overview exit).

If animation logic later becomes a bug source, we can add an `AnimationIntent` layer between scene snapshots. But that's a separate design.
