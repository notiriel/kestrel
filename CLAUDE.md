# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
make build          # Compile TypeScript → dist/
make test           # Run all Vitest tests (with coverage)
make lint           # ESLint + Knip (dead code detection)
make install        # Build + test + lint + deploy to GNOME extensions dir + compile schemas
make dev            # Install + enable + show restart instructions
make enable         # Enable extension, disable conflicting exts, enable Claude Code plugin
make disable        # Disable extension, restore GNOME defaults, disable plugin
make status         # Show installation/enable status
make coverage       # Vitest with detailed coverage report
npx vitest run test/domain/world.test.ts  # Run a single test file
```

**IMPORTANT: Always run `make install` after making code changes.** This deploys to the GNOME extensions directory so changes take effect on next session restart. Do not skip this step or wait to be reminded.

After `make install`, a Wayland session restart (log out/in) is required to pick up JS changes.

View extension logs: `journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager`

If GNOME crashes, it sets `disable-user-extensions=true` in dconf — re-enable before testing.

## Architecture

Hexagonal/ports-and-adapters architecture with a pure domain core and GNOME Shell adapters. Never add direct system imports (e.g., `Main`, `Meta`, `gi://` modules) to domain or controller layers. All external interactions must go through port interfaces defined in `src/ports/`.

### Core data flow

```
Reality -(events)-> Domain -(new world model)-> Adapter -(animates)-> Reality
```

Adapters detect changes in reality (window created, destroyed, key pressed, focus changed) and inform the domain. The domain computes the complete new world model. The adapter turns that model into reality (positions clones, animates transitions, activates focus). **The domain is always the source of truth.** Adapters never compute layout, focus, or workspace state — they only translate between GNOME signals and domain calls, then apply the domain's output.

Operations like workspace pruning happen immediately in the domain. If a workspace empties, the domain removes it and adjusts all indices in the same operation. The adapter must reconcile its visual state (e.g. clone containers) to match.

### Textual model notation

When describing world state in tests and bug reports, use this notation:

```
<>  viewport (what's visible on screen)
[]  focus indicator (which window has focus)

Example — two workspaces, B focused on WS1:

A
<[B] C>
D E

Meaning: WS0 has A. WS1 (current) has B, C — viewport shows B and C,
B is focused. WS2 has D, E.
```

### Domain core

`src/domain/` — Pure TypeScript, no `gi://` imports, fully testable with Vitest. All operations are immutable and return `WorldUpdate { world, scene }`.

| File | Purpose |
|------|---------|
| `world.ts` | Aggregate root. `createWorld`, `addWindow`, `removeWindow`, `setFocus`, `updateMonitor`, `switchToWorkspace`, `buildUpdate` |
| `types.ts` | Branded types (`WindowId`, `WorkspaceId`), core interfaces (`KestrelConfig`, `MonitorInfo`, `WorldUpdate`) |
| `window.ts` | `TiledWindow` interface and `createTiledWindow` factory (slotSpan, fullscreen state) |
| `workspace.ts` | `Workspace` type and operations: `addWindow`, `removeWindow`, `replaceWindow`, `windowAfter`, `windowBefore`, `slotIndexOf`, `windowAtSlot` |
| `viewport.ts` | `Viewport` type: tracks current workspace index, scrollX, widthPx |
| `layout.ts` | `computeWindowPositions()`, `computeFocusedWindowPosition()` — turns workspace + config + monitor into pixel positions |
| `scene.ts` | `computeScene(world)` — pure function computing the complete physical scene (`SceneModel`) from world state. Produces `CloneScene[]`, `RealWindowScene[]`, `FocusIndicatorScene`, `WorkspaceStripScene` |
| `navigation.ts` | `focusRight`, `focusLeft`, `focusDown`, `focusUp` |
| `window-operations.ts` | `moveLeft`, `moveRight`, `moveDown`, `moveUp`, `toggleSize` |
| `overview.ts` | Overview mode domain logic: `enterOverview`, `exitOverview`, `cancelOverview`, filter management |
| `overview-state.ts` | `OverviewInteractionState`: filter text, workspace rename, focused indices |
| `notification.ts` | Notification domain: `addNotification`, `respondToNotification`, `dismissNotificationsForWindow`, session/status tracking, focus mode |
| `notification-types.ts` | Type definitions for notifications (`QuestionOption`, `OverlayNotification`, `FocusModeState`) |
| `fuzzy-match.ts` | Fuzzy search for overview workspace filter |

### Ports

`src/ports/` — Adapter interfaces (no `gi://` imports). Extension depends on ports, not concrete adapters.

| File | Purpose |
|------|---------|
| `clone-port.ts` | `ClonePort` — clone lifecycle, layout rendering, overview transforms, filter/sort |
| `window-port.ts` | `WindowPort` — position real windows, check settlement |
| `focus-port.ts` | `FocusPort` — focus activation, feedback loop suppression |
| `monitor-port.ts` | `MonitorPort` — monitor geometry reading |
| `keybinding-port.ts` | `KeybindingPort` — register/unregister keybindings |
| `shell-port.ts` | `ShellPort` — GNOME Shell interaction (hide overview, intercept animations) |
| `window-event-port.ts` | `WindowEventPort` — window lifecycle signals, enumerate existing windows |
| `state-persistence-port.ts` | `StatePersistencePort` — save/load world state across enable/disable cycles |
| `conflict-detector-port.ts` | `ConflictDetectorPort` — detect conflicting GNOME extensions |
| `notification-port.ts` | `NotificationPort` — render permission/notification/question cards |
| `panel-indicator-port.ts` | `PanelIndicatorPort` — workspace indicator in top panel |

### Adapters

`src/adapters/` — GNOME Shell integration via `gi://` imports. Each adapter implements its corresponding port.

**Core adapters:**

| File | Purpose |
|------|---------|
| `clone-adapter.ts` | `Clutter.Clone` of `WindowActor`s on custom layer; manages clone lifecycle, workspace containers, layout |
| `window-adapter.ts` | Positions real `Meta.Window`s via `move_resize_frame()`, tracks settlement |
| `focus-adapter.ts` | Activates windows via `Meta.Window.activate()`, suppresses feedback loops |
| `monitor-adapter.ts` | Reads monitor geometry, listens for layout changes |
| `keybinding-adapter.ts` | Registers GNOME keybindings from settings schema |
| `shell-adapter.ts` | GNOME Shell integration: hides overview, intercepts window animations |
| `window-event-adapter.ts` | Listens for `window-created`/`destroy` signals, waits for `first-frame`, separates float windows |
| `state-persistence.ts` | Saves/restores world state to dconf settings, reads config from schema |
| `conflict-detector.ts` | Detects and disables conflicting GNOME extensions at runtime |

**Handlers (orchestrate domain calls + adapter updates):**

| File | Purpose |
|------|---------|
| `overview-handler.ts` | Overview mode: enter/exit/navigate/filter/click, transforms clones, workspace labels |
| `navigation-handler.ts` | Keybinding handlers: `handleSimpleCommand`, `handleVerticalFocus`, `handleVerticalMove` |
| `window-lifecycle-handler.ts` | Window add/remove/fullscreen/maximize → domain updates + adapter sync |

**Notification system:**

| File | Purpose |
|------|---------|
| `notification-coordinator.ts` | Orchestrates permission cards, notifications, DBus, focus mode, Claude session watching |
| `notification-overlay-adapter.ts` | Renders permission/notification/question card UI |
| `notification-focus-mode.ts` | Keyboard-driven navigation for permission/question cards |
| `status-overlay-adapter.ts` | Status badge on clone (`working`, `needs-input`, `done`, `end`) |
| `dbus-service.ts` | Exports `io.kestrel.Extension` DBus interface for Claude Code plugin |

**UI adapters:**

| File | Purpose |
|------|---------|
| `panel-indicator-adapter.ts` | Workspace indicator in GNOME top panel with click-to-switch |
| `overview-input-adapter.ts` | Keyboard input handler for overview mode |
| `mouse-input-adapter.ts` | Mouse scroll events for horizontal/vertical navigation |

**Utilities:**

| File | Purpose |
|------|---------|
| `world-holder.ts` | Holds current `World` state, fires panel update on change |
| `settlement-retry.ts` | Exponential-backoff layout retry for async Wayland configures |
| `float-clone-manager.ts` | Floating (non-tiled) window clone management |
| `reconciliation-guard.ts` | Prevents concurrent/overlapping operations |
| `safe-window.ts` | Safe extraction of window information |
| `signal-utils.ts` | GObject signal management helpers |

**UI Components (`src/ui-components/`)** — Presentational widget builders. May import `gi://` but must NOT import domain types or adapter state:

| File | Purpose |
|------|---------|
| `help-overlay.ts` | Keybindings help sheet (Super+') |
| `notification-card.ts` | Notification card UI component |
| `permission-card.ts` | Permission card UI component |
| `question-card.ts` | Question card UI component |
| `card-builders.ts` | Shared card skeleton/styling builders |
| `card-behavior.ts` | Card hover/focus/animation behavior |
| `clone-ui-builders.ts` | Clone-related UI builders |
| `status-badge-builders.ts` | Status badge widget builders |
| `panel-indicator-builders.ts` | Panel indicator widget builders |
| `notification-overlay-builders.ts` | Notification overlay widget builders |
| `help-builders.ts` | Help overlay widget builders |
| `focus-mode-builders.ts` | Focus mode widget builders |
| `animation-helpers.ts` | Clutter animation utilities |
| `notification-adapter-types.ts` | Notification adapter type definitions |

**Entry point**: `src/extension.ts` — Composition root. `KestrelExtension` extends the GNOME `Extension` base class and wires domain + adapters in `enable()`/`disable()`.

## Claude Code Plugin

`kestrel-plugin/` — Claude Code integration via shell hooks that communicate with the extension over session DBus (`io.kestrel.Extension` at `/io/kestrel/Extension`).

### DBus methods

| Method | Args | Returns | Purpose |
|--------|------|---------|---------|
| `HandlePermission` | `payload: s` | `{"id":"notif-N"}` | Show permission card, return ID for polling |
| `HandleNotification` | `payload: s` | `{"id":"notif-N"}` | Fire-and-forget notification card |
| `GetNotificationResponse` | `id: s` | `{"action":"allow"}` or `{"pending":true}` | Poll user's response to a permission card |
| `SetWindowStatus` | `sessionId: s, status: s` | — | Update clone status badge |
| `GetDiagnostics` | — | `{"expected":…,"actual":…,"mismatches":…}` | Compare expected scene model vs actual adapter state for debugging layout bugs |

### Hook scripts (`kestrel-plugin/hooks/`)

| Script | Event | What it does |
|--------|-------|--------------|
| `kestrel-probe.sh` | `SessionStart` | Writes terminal title escape to map session IDs to GNOME windows |
| `kestrel-status.sh` | `SessionStart`, `Notification`, `Stop`, `SessionEnd` | Updates clone status badge |
| `kestrel-notify.sh` | `Notification`, `Stop` | Fire-and-forget notification |
| `kestrel-permission.sh` | `PermissionRequest` | Shows permission card, polls response (10 min timeout) |
| `kestrel-question.sh` | Question events | Question interaction |

### Data flow

```
Claude Code -(event)-> hook script -(gdbus)-> extension DBus
  -> notification-coordinator -> notification-overlay-adapter renders card
  -> user clicks -> response stored
  <- hook polls GetNotificationResponse <- returns action
  <- hook outputs decision JSON to Claude Code
```

## Key Design Decisions

- **Clone-based rendering**: Real `WindowActor`s can't be reparented from `global.window_group` on Wayland. `Clutter.Clone` allows free positioning on a custom layer for horizontal scrolling.
- **Single GNOME workspace**: All windows on one GNOME workspace; Kestrel workspaces are virtual (domain-managed) to avoid GNOME workspace animation conflicts.
- **Scene model**: `computeScene()` produces a complete physical-state snapshot (`SceneModel`) from domain state. Keeps rendering logic testable without GNOME. Adapters consume the scene model rather than computing positions themselves.
- **Target-state model**: Domain computes only final positions, not transitions. Adapters handle animation (`Clutter.ease`) separately.
- **GObject subclassing**: Use `GObject.registerClass()` + `_init()`, not `constructor()`.
- **`gi://` ambient types**: Declared in `src/ambient.d.ts`; runtime types from `@girs/*` packages.

## Conventions

- All signal handlers wrapped in try/catch to avoid crashing GNOME Shell
- All signal IDs and timeout IDs tracked for cleanup in `destroy()` methods
- Console logs prefixed with `[Kestrel]`
- Window filtering: only `Meta.WindowType.NORMAL`, not `is_above()`, not transient

## Tests

| Directory | Coverage |
|-----------|----------|
| `test/domain/` | Unit tests for all domain modules (world, navigation, layout, scene, workspace, window-operations, overview, notifications, fullscreen, fuzzy-match, filter-workspaces, workspace-naming) |
| `test/adapters/` | Integration tests for handlers and extension (overview-handler, navigation-handler, window-lifecycle-handler, extension) |
| `test/arch/` | Architecture boundary test — verifies domain files have no `gi://` imports |
| `test/adapters/mock-ports.ts` | Mock implementations of all ports for adapter testing |

## Design Docs

| File | Content |
|------|---------|
| `docs/design.md` | Product design spec (keybindings, UX, behavior) |
| `docs/architecture.md` | Technical architecture (data model, layers, state machines, signal flows) |
| `docs/debug.md` | Debugging guide (DBus, journal logs, diagnostics, crash recovery) |
| `docs/claude-code-plugin.md` | Claude Code integration (DBus interface, hooks, data flow) |
| `docs/build.md` | Build system, testing, development workflow, GSettings schema |
| `docs/historic/` | Archived design documents from earlier development phases |

## General Principles

- Always read existing design docs and architecture documents BEFORE attempting fixes or implementations. Never guess at solutions when documentation exists — check `docs/` folder first for architectural decisions and stated approaches.
- When asked to write output to a file, write it to the file immediately. Do not present it inline first and wait for confirmation.
- Do not start coding before the user has finished explaining the problem and expected behavior. Wait for the full context before proposing or implementing solutions.

## Debugging

- When the user reports a bug, first determine the minimal reproduction path (e.g., keyboard shortcut vs DBus trigger). If one path works and another doesn't, the bug is in the differing code path — do NOT investigate shared infrastructure.
- When debugging GNOME Shell/Mutter/Wayland issues: Chromium and CSD windows have async timing behaviors where size-changed signals can undo layout changes. Always check for signal handler interference before assuming layout logic bugs.
- **DBus addressing**: The extension exports its DBus object at `/io/kestrel/Extension` on the GNOME Shell session bus connection. It does NOT own a well-known bus name, so you must use `org.gnome.Shell` as the destination:
  ```bash
  # Correct — use org.gnome.Shell as destination
  gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.GetDiagnostics

  # Wrong — will fail with ServiceUnknown
  gdbus call --session --dest io.kestrel.Extension ...
  ```
- **GetDiagnostics**: Compares expected scene state (from domain `computeScene()`) against actual adapter state read from Clutter actors. Returns `{ expected, actual, mismatches }` — mismatches show which clones, real windows, focus indicator, or workspace strip fields differ between domain computation and what GNOME actually rendered.
- **Debug mode** (`debug-mode` setting): Exposes `global._kestrel` with `debugState()` (domain world + layout) and `diagnostics()` (full scene comparison). Access via Shell.Eval:
  ```bash
  gdbus call --session --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval 'JSON.stringify(global._kestrel.debugState())'
  ```
  Note: Shell.Eval output is GVariant-escaped — the JSON is wrapped in multiple quoting layers.
- **Deployed vs source**: DBus methods and `global._kestrel` properties reflect the deployed code, not the current source. After `make install`, a Wayland session restart is required for JS changes to take effect. Use `gdbus introspect --session --dest org.gnome.Shell --object-path /io/kestrel/Extension` to verify which methods are available on the running instance.

## Clutter / Mutter / St API Reference

**Before writing or modifying any code that uses Clutter, Mutter, Meta, or St APIs, ALWAYS read the relevant type definitions first.** Do not guess at API signatures. The type definitions are the source of truth:

| Library | Type definitions | Online docs |
|---------|-----------------|-------------|
| Clutter 14 | `node_modules/@girs/clutter-14/clutter-14.d.ts` | https://gnome.pages.gitlab.gnome.org/mutter/clutter/ |
| Meta 14 | `node_modules/@girs/meta-14/meta-14.d.ts` | https://gnome.pages.gitlab.gnome.org/mutter/meta/ |
| St 14 | `node_modules/@girs/st-14/st-14.d.ts` | https://gnome.pages.gitlab.gnome.org/gnome-shell/st/ |
| Mtk 14 | `node_modules/@girs/mtk-14/mtk-14.d.ts` | https://gnome.pages.gitlab.gnome.org/mutter/mtk/ |

### Key API patterns

- **Clutter.Event** (base class) has all event query methods: `get_related()`, `get_source()`, `get_coords()`, `get_button()`, etc. Subclasses like `CrossingEvent` are abstract markers with NO additional methods.
- **Signal callbacks** in GJS receive `(emitter, ...signalArgs)`. For `'leave-event'` on a Clutter.Actor: `(actor, event)` where event is `Clutter.Event`.
- **St.Widget** has `track_hover` / `hover` properties for automatic hover tracking. Base `Clutter.Actor` does NOT have these.
- **Enter/leave events and children**: When pointer moves from a parent to a reactive child, the parent receives `leave-event`. Use `event.get_related()` + `actor.contains(related)` to detect child-crossing and avoid false collapses.
