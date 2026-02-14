# PaperFlow Solution Design

## Architecture: Hexagonal (Ports & Adapters)

The codebase is split into three layers:

```
┌─────────────────────────────────────────────────────┐
│                   Domain Core                        │
│         Pure TypeScript — no GNOME imports            │
│         Fully unit-testable with mocks               │
│                                                      │
│  World                                               │
│    ├── workspaces: Workspace[]                       │
│    ├── viewport: Viewport                            │
│    ├── focusedWindow: WindowId | null                │
│    └── config: PaperFlowConfig                       │
│                                                      │
│  Workspace                                           │
│    ├── id: WorkspaceId                               │
│    ├── windows: TiledWindow[]                        │
│    └── name: string | null                           │
│                                                      │
│  TiledWindow                                         │
│    ├── id: WindowId                                  │
│    ├── slot: number (first slot index)               │
│    ├── slotSpan: 1 | 2                               │
│    └── fullscreen: boolean                           │
│                                                      │
│  Viewport                                            │
│    ├── workspaceIndex: number                        │
│    ├── scrollX: number (in slot units)               │
│    └── widthSlots: number (monitor count × 2)        │
│                                                      │
│  NavigationEngine                                    │
│    ├── focusRight(world) → WorldUpdate               │
│    ├── focusLeft(world) → WorldUpdate                │
│    ├── focusDown(world) → WorldUpdate                │
│    ├── focusUp(world) → WorldUpdate                  │
│    ├── moveRight(world) → WorldUpdate                │
│    ├── moveLeft(world) → WorldUpdate                 │
│    ├── moveDown(world) → WorldUpdate                 │
│    ├── moveUp(world) → WorldUpdate                   │
│    └── toggleSize(world) → WorldUpdate               │
│                                                      │
│  LayoutEngine                                        │
│    ├── computeLayout(workspace, config) → Layout[]   │
│    └── computeViewportScroll(world) → scrollX        │
│                                                      │
│  WorldUpdate (return type of all operations)         │
│    ├── world: World (new state)                      │
│    └── layout: LayoutState (target positions for     │
│         every window + viewport + focus indicator)   │
│                                                      │
└──────────────────┬──────────────────┬────────────────┘
                   │                  │
            Inbound Ports      Outbound Ports
            (driving)          (driven)
                   │                  │
┌──────────────────┴──────────────────┴────────────────┐
│                    Adapters                           │
│          TypeScript with GNOME/GJS imports            │
│                                                      │
│  Inbound (events → domain):                          │
│    KeybindingAdapter     Main.wm.addKeybinding()     │
│    WindowEventAdapter    display.window-created,     │
│                          actor.first-frame,          │
│                          actor.destroy               │
│    MouseAdapter          click, Super+drag,          │
│                          Super+scroll               │
│    MonitorAdapter        layoutManager.monitors,     │
│                          monitors-changed            │
│                                                      │
│  Outbound (domain → system):                         │
│    WindowAdapter         Meta.Window.move_resize_    │
│                          frame(), actor.show/hide    │
│    CloneAdapter          Clutter.Clone lifecycle,    │
│                          clone container mgmt        │
│    AnimatorAdapter       actor.ease() execution      │
│    OverviewAdapter       overview UI (St widgets)    │
│    FocusAdapter          global.display focus,       │
│                          Main.activateWindow()       │
│                                                      │
│  Extension Lifecycle:                                │
│    PaperFlowExtension    enable() / disable()        │
│                          wires ports ↔ adapters      │
└──────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Single GNOME Workspace

All windows live on one GNOME workspace. PaperFlow workspaces are virtual — the domain model tracks which windows belong to which workspace, and the adapter layer shows/hides window actors accordingly.

**Why:** GNOME's workspace switching has its own animation system, signal timing, and policies (`_checkWorkspaces`, `WorkspaceAnimation`) that conflict with custom tiling. The previous PaperWM fork's worst bugs came from this conflict. With a single workspace, PaperFlow has complete control over all transitions.

**Implications:**
- Window visibility is managed by PaperFlow (hide actors not on the current virtual workspace)
- Alt-Tab must be overridden to scope to the current PaperFlow workspace
- GNOME Overview is fully replaced by PaperFlow's overview
- GNOME's dynamic workspace settings are irrelevant

### 2. Target State Model (No Animation Intents)

The domain is **animation-unaware**. It computes the correct target state and a complete target layout. The adapter layer drives animations toward the target.

```typescript
interface WorldUpdate {
    world: World;           // new logical state
    layout: LayoutState;    // target positions for everything
}

interface LayoutState {
    viewportX: number;      // target scroll position (slot units)
    workspaceY: number;     // target workspace index
    windows: WindowLayout[];// target position/size for each window
    focusIndicator: Rect;   // target position/size of focus overlay
}

interface WindowLayout {
    windowId: WindowId;
    x: number;              // slot-relative X position
    y: number;              // workspace-relative Y position
    width: number;          // in slot units
    visible: boolean;       // whether this window should be shown
}
```

**The domain never produces `from` values — only targets.** The adapter knows the current visual state (wherever the actors are right now) and eases toward the target.

```typescript
// Domain — pure, testable, animation-unaware
function focusRight(world: World): WorldUpdate {
    const ws = world.currentWorkspace();
    const nextWindow = ws.windowAfter(world.focusedWindow);
    if (!nextWindow) return { world, layout: currentLayout(world) };

    const newWorld = world.withFocus(nextWindow.id);
    return { world: newWorld, layout: computeLayout(newWorld) };
}
```

```typescript
// Adapter — drives toward target, retargets mid-animation
class AnimatorAdapter {
    applyLayout(layout: LayoutState): void {
        // Clutter.ease() from current position to target.
        // If already animating, ease() retargets smoothly —
        // new transition starts from current interpolated position.
        this.scrollContainer.ease({
            x: -layout.viewportX * this.slotWidth,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this.workspaceStrip.ease({
            y: -layout.workspaceY * this.workspaceHeight,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        // ... focus indicator, individual window positions
    }
}
```

**Rapid input handling:** If the user presses Super+Right three times quickly:
1. Domain computes target A → adapter starts easing toward A
2. Domain computes target B → adapter retargets from current position toward B
3. Domain computes target C → adapter retargets from current position toward C

Each retarget produces a smooth curve. No queuing, no snapping, no animation awareness in the domain.

### 3. Clone-Based Rendering

We use `Clutter.Clone` instances of `WindowActor`s for the tiling view. Real `WindowActor`s cannot be freely reparented from `global.window_group`, so clones are the only way to achieve smooth horizontal scrolling.

**Architecture:**

```
global.stage
  └── global.window_group (real WindowActors — hidden by PaperFlow)
  └── paperflow-layer (Clutter.Actor, inserted above window_group)
        └── workspace-strip (Clutter.Actor, translated Y for workspace switch)
              └── workspace-0 (Clutter.Actor)
              │     └── scroll-container (Clutter.Actor, translated X for scrolling)
              │           └── clone-wrapper-0 (Clutter.Actor)
              │           │     └── Clutter.Clone { source: WindowActor }
              │           │     └── focus-indicator (St.Widget, only on focused)
              │           └── clone-wrapper-1 ...
              └── workspace-1 ...
```

**Scrolling:** Translating `scroll-container.x` scrolls the workspace strip.
**Workspace switching:** Translating `workspace-strip.y` switches workspaces.
**Both at once:** Animate both X and Y simultaneously for Super+Down/Up.

### 4. Window Lifecycle

```
New window appears
    │
    ├── display 'window-created' signal fires
    │
    ├── Adapter waits for WindowActor 'first-frame' (with timeout)
    │   (Wayland: wm_class unreliable before first-frame)
    │
    ├── Adapter creates Clutter.Clone of the WindowActor
    │
    ├── Adapter hides the real WindowActor
    │
    ├── Adapter notifies domain: addWindow(windowId, props)
    │
    ├── Domain returns WorldUpdate with new layout
    │
    └── Adapter applies layout: position clone, animate, focus
```

```
Window closes
    │
    ├── WindowActor 'destroy' signal fires
    │
    ├── Adapter notifies domain: removeWindow(windowId)
    │
    ├── Domain returns WorldUpdate with new layout
    │   (windows shifted, focus moved to next/previous)
    │
    └── Adapter applies layout: remove clone, animate remaining, refocus
```

### 5. Fullscreen Model

When a window goes fullscreen:
1. Domain marks it `fullscreen: true` and removes it from the workspace strip
2. Adapter: the real `WindowActor` is shown (uncloned) on its monitor, fullscreen
3. Domain recalculates viewport width (minus one monitor) and relayouts
4. Remaining clones animate into the smaller viewport

On exit:
1. Domain reinserts window into strip, marks `fullscreen: false`
2. Adapter: hides real actor, shows clone, restores viewport width
3. Everything relayouts and animates

### 6. State Synchronization

The domain is the **source of truth** for layout. GNOME is the source of truth for window existence and properties.

**Inbound sync (GNOME → domain):** Signals notify the domain of external changes:

| External event | Signal | Domain action |
|---|---|---|
| App resizes itself | `size-changed` on Meta.Window | If window can't fit in current slot span, auto-promote. Recompute layout. |
| User CSD-drags to resize | `size-changed` on Meta.Window | Same as above — treat as external resize. |
| App goes fullscreen | `notify::fullscreen` on Meta.Window | Domain marks fullscreen, recomputes layout. |
| Window appears | `window-created` + `first-frame` | Domain adds window. |
| Window disappears | `destroy` on WindowActor | Domain removes window. |
| Monitor added/removed | `monitors-changed` | Domain updates viewport widthSlots, recomputes all layouts. |

**Outbound sync (domain → GNOME):** After every domain operation, the adapter:
1. Calls `Meta.Window.move_resize_frame()` to set the real window geometry (even though it's hidden — this ensures correct size if PaperFlow is disabled)
2. Updates clone positions and sizes
3. Animates the layout via `ease()`

**Conflict resolution:** The domain always wins for position/size. If GNOME moves a window (e.g., CSD drag), the adapter detects it via `size-changed`, tells the domain, and the domain recomputes the layout — which may snap the window back to its slot.

### 7. Error Handling

| Failure | Strategy |
|---|---|
| Clone creation fails | Log warning. Leave the real WindowActor visible and skip tiling for this window. It will float as a normal GNOME window. |
| `first-frame` never fires | Timeout (2 seconds). If expired, attempt clone anyway. If that fails, skip tiling for this window. |
| `move_resize_frame()` rejected | Ignore. The real window position is cosmetic (it's hidden). Clone position is what matters visually. |
| Monitor disappears mid-animation | `monitors-changed` triggers full relayout. Domain recomputes with new monitor count. Adapter cancels running animations and applies new layout. |
| Extension crashes | GNOME catches it. On re-enable, enumerate all existing windows and rebuild state from scratch. |

**General principle:** Never crash GNOME Shell. Catch exceptions in every signal handler and keybinding callback. Log errors. Degrade gracefully — an untiled window is better than a frozen desktop.

### 8. Monitor Flow

```
Monitor change (plug/unplug/rearrange)
    │
    ├── Main.layoutManager 'monitors-changed' signal
    │
    ├── MonitorAdapter reads new monitor list:
    │   - count, geometries, primary monitor
    │   - computes new widthSlots = monitorCount × 2
    │
    ├── MonitorAdapter notifies domain: updateMonitors(monitorInfo)
    │
    ├── Domain updates viewport.widthSlots
    │   Recomputes layout for all workspaces
    │   Returns WorldUpdate
    │
    └── Adapter applies layout:
        - Resizes paperflow-layer to span all monitors
        - Resizes all scroll-containers
        - Recalculates slot pixel widths
        - Animates to new positions
```

The domain receives monitor info as a simple value type:

```typescript
interface MonitorInfo {
    count: number;
    totalWidth: number;     // combined pixel width
    totalHeight: number;    // pixel height (all monitors same height assumed)
    slotWidth: number;      // totalWidth / (count × 2) — pixel width of one slot
}
```

## TypeScript Build Toolchain

### Approach: tsc + ambient declarations

Based on Tiling Shell and Pop Shell patterns.

**Type definition strategy:** Use `@girs/*` packages for GIR-based APIs (St, Clutter, Meta, GLib, Gio — auto-generated from introspection, reliable). Use `@girs/gnome-shell` for Shell JS APIs (hand-maintained, experimental). Where `@girs/gnome-shell` types are missing or wrong, add local `.d.ts` overrides in `src/types/`. This is manageable because PaperFlow's GNOME Shell API surface is narrow (keybindings, layoutManager, overview, a few Main.* functions).

```
src/
  domain/          ← Pure TypeScript, no gi:// imports
    world.ts
    workspace.ts
    window.ts
    viewport.ts
    navigation.ts
    layout.ts
    types.ts
  adapters/        ← TypeScript with GNOME imports
    extension.ts   ← enable()/disable() entry point
    controller.ts  ← composition root
    keybinding.ts
    window-event.ts
    window.ts
    clone.ts
    animator.ts
    monitor.ts
    overview.ts
    focus.ts
    mouse.ts
    alt-tab.ts
  types/           ← Local type overrides for missing @girs types
    gnome-shell.d.ts
  ambient.d.ts     ← gi:// and resource:// declarations
  extension.ts     ← Re-export for GNOME extension entry point
  metadata.json
  stylesheet.css

test/
  domain/          ← Unit tests (Vitest, no GNOME needed)
    navigation.test.ts
    layout.test.ts
    world.test.ts

tsconfig.json
package.json
Makefile           ← build, install, test targets
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noEmit": false,
    "declaration": false,
    "sourceMap": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts"]
}
```

### Dependencies

```json
{
  "devDependencies": {
    "typescript": "^5.7",
    "@girs/gjs": "^4.0",
    "@girs/gnome-shell": "~49.0",
    "@girs/st-16": "~16.0",
    "@girs/clutter-16": "~16.0",
    "@girs/meta-16": "~16.0",
    "@girs/shell-16": "~16.0",
    "@girs/gobject-2.0": "^2.0",
    "@girs/glib-2.0": "^2.0",
    "@girs/gio-2.0": "^2.0",
    "vitest": "^3.0"
  }
}
```

### Build & Install

```makefile
UUID = paperflow@paperflow.github.com
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

build:
	npx tsc

test:
	npx vitest run

install: build
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)
	cp -r dist/* $(INSTALL_DIR)/
	cp src/metadata.json $(INSTALL_DIR)/
	cp src/stylesheet.css $(INSTALL_DIR)/

dev: install
	@echo "Restart GNOME Shell to load changes"
	@echo "  X11:    Alt+F2 → r → Enter"
	@echo "  Wayland: log out and back in"
```

## GNOME Shell Integration Details

### Signals to Connect

| Signal | Source | Purpose |
|---|---|---|
| `window-created` | `global.display` | New window appeared |
| `first-frame` | `Meta.WindowActor` | Window ready to clone (one-shot) |
| `destroy` | `Meta.WindowActor` | Window closed |
| `size-changed` | `Meta.Window` | Window resized externally (e.g., CSD drag, app self-resize) |
| `notify::fullscreen` | `Meta.Window` | Fullscreen toggled by app |
| `monitors-changed` | `Main.layoutManager` | Monitor config changed |
| `startup-complete` | `Main.layoutManager` | Safe to enumerate existing windows |

### GNOME Shell Overrides

Things PaperFlow must disable/replace:

| What | Why | How |
|---|---|---|
| Workspace switching animation | We manage all transitions | Override `Main.wm._workspaceAnimation` |
| Dynamic workspace creation | We use a single GNOME workspace | Set `dynamic-workspaces` to false, force 1 workspace |
| Edge tiling (half-screen snap) | Conflicts with our tiling | Disable `org.gnome.mutter` `edge-tiling` |
| Overview (Activities) | Replaced by PaperFlow overview | Override Super key, block `Main.overview.toggle()` |
| Alt-Tab | Must scope to PaperFlow workspace | Replace `switcherPopup` or filter window list |
| `attach-modal-dialogs` | Dialogs should tile normally | Disable via mutter setting |

All overrides must be **saved on enable() and restored on disable()** — clean teardown is critical.

### Window Filtering

Not all windows should be tiled. The adapter must filter:

```typescript
function shouldTile(metaWindow: Meta.Window): boolean {
    // Only tile normal windows
    if (metaWindow.get_window_type() !== Meta.WindowType.NORMAL) return false;
    // Skip always-on-top (set by user)
    if (metaWindow.is_above()) return false;
    // Skip transient dialogs
    if (metaWindow.get_transient_for() !== null) return false;
    return true;
}
```

### Input Layer

**Keybindings** use `Main.wm.addKeybinding()` backed by a GSettings schema:

```xml
<!-- schemas/org.gnome.shell.extensions.paperflow.gschema.xml -->
<schema id="org.gnome.shell.extensions.paperflow">
  <key name="focus-right" type="as">
    <default>['&lt;Super&gt;Right']</default>
  </key>
  <key name="focus-left" type="as">
    <default>['&lt;Super&gt;Left']</default>
  </key>
  <!-- ... -->
</schema>
```

**Mouse events** use `Clutter.Actor.reactive = true` on clone wrappers + `button-press-event` signal for click-to-focus, and `Clutter.GrabAction` or manual pointer tracking for Super+Drag.

## Animation Execution

The `AnimatorAdapter` receives a `LayoutState` (target only, no "from") and eases all actors toward it. Clutter's `ease()` natively handles retargeting: calling `ease()` on an actor mid-animation starts a new transition from the **current interpolated position** to the new target.

```typescript
class AnimatorAdapter {
    applyLayout(layout: LayoutState): void {
        // Viewport scroll
        this.scrollContainer.ease({
            x: -layout.viewportX * this.slotWidth,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Workspace switch
        this.workspaceStrip.ease({
            y: -layout.workspaceY * this.workspaceHeight,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Individual window clones
        for (const wl of layout.windows) {
            const clone = this.clones.get(wl.windowId);
            if (!clone) continue;
            clone.wrapper.ease({
                x: wl.x * this.slotWidth,
                width: wl.width * this.slotWidth,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            clone.wrapper.visible = wl.visible;
        }

        // Focus indicator
        this.focusIndicator.ease({
            x: layout.focusIndicator.x,
            y: layout.focusIndicator.y,
            width: layout.focusIndicator.width,
            height: layout.focusIndicator.height,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
}
```

**Rapid input produces smooth curves, not jarring snaps.** Each retarget blends naturally because Clutter interpolates from the current visual state.

## Extension Entry Point

```typescript
// src/extension.ts
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class PaperFlowExtension extends Extension {
    private controller?: PaperFlowController;

    enable(): void {
        this.controller = new PaperFlowController(this.getSettings());
        this.controller.enable();
    }

    disable(): void {
        this.controller?.disable();
        this.controller = undefined;
    }
}
```

`PaperFlowController` is the composition root that wires domain ↔ adapters:

```typescript
class PaperFlowController {
    enable(): void {
        // 1. Read config
        // 2. Create domain World (empty)
        // 3. Create adapters, inject ports
        // 4. Disable GNOME workspace/overview systems
        // 5. Connect signals (window-created, etc.)
        // 6. Register keybindings
        // 7. Enumerate existing windows → addWindow for each
        // 8. Insert PaperFlow actor layer into stage
    }

    disable(): void {
        // Reverse order:
        // 1. Remove actor layer
        // 2. Show all real WindowActors
        // 3. Unregister keybindings
        // 4. Disconnect all signals
        // 5. Restore GNOME workspace/overview systems
        // 6. Destroy adapters
    }
}
```

## App Launcher Integration

PaperFlow integrates with an external app launcher (e.g., ULauncher) for text-based workspace navigation. A plugin provides:
- Switch to a workspace by name (e.g., typing `ws: project-alpha`)
- Rename the current workspace

This is a separate component, not part of the core extension. Communication could be via:
- A simple file/socket protocol that the launcher plugin reads
- D-Bus interface exposed by the extension
- Reading PaperFlow's state from GSettings

## Implementation Phases

### Phase 1a: Build Pipeline
- Project scaffolding: package.json, tsconfig.json, Makefile
- TypeScript compilation working
- metadata.json, empty extension.ts that enables/disables cleanly
- `make install` deploys to GNOME extensions dir
- Result: Extension appears in GNOME Extensions app, enables/disables without errors.

### Phase 1b: First Window Tiles
- Domain: World, Workspace, TiledWindow, Viewport, LayoutEngine
- Adapters: WindowEventAdapter, CloneAdapter, MonitorAdapter, WindowAdapter
- PaperFlowController wires everything
- Result: Windows tile horizontally at half-width. No navigation, no animation yet — just correct positioning.

### Phase 2: Navigation + Animation
- Domain: NavigationEngine (focusRight/Left)
- Adapters: KeybindingAdapter, AnimatorAdapter, FocusAdapter
- GSettings schema for keybindings
- Result: Super+Left/Right moves focus and scrolls viewport with smooth animation. Rapid input retargets smoothly.

### Phase 3: Virtual Workspaces
- Domain: Multiple workspaces, focusDown/Up, slot-based vertical targeting
- Adapters: Workspace strip Y-axis animation, window visibility management
- Result: Super+Down/Up switches virtual workspaces with 2D animation.

### Phase 4: Window Operations
- Domain: moveLeft/Right/Down/Up, toggleSize
- Adapters: Window reorder animation, resize
- Result: Super+Shift+arrows reorders/moves windows, Super+F toggles size.

### Phase 5: Overview
- Domain: Overview state, overview navigation
- Adapters: Overview UI (scaled thumbnails), click handling
- Result: Super+M shows bird's-eye view, arrow keys navigate, Enter/click jumps.

### Phase 6: Polish
- Fullscreen step-out model
- Mouse interaction (click focus, Super+drag, Super+scroll)
- Alt-Tab override scoped to PaperFlow workspace
- Focus indicator styling
- Configuration UI (GNOME prefs)
- Window minimum size auto-promotion

### Phase 7: Multi-monitor
- Domain: Viewport width from combined monitors
- Adapters: Monitor change handling, fullscreen per-monitor
- Clone layer spanning multiple monitors

### Phase 8: Ecosystem
- App launcher plugin for workspace-by-name navigation
- Workspace naming UI
