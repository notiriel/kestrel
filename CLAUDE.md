# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
make build          # Compile TypeScript → dist/
make test           # Run all Vitest tests
make install        # Build + deploy to GNOME extensions dir + compile schemas
make dev            # Install + show restart instructions
npx vitest run test/domain/world.test.ts  # Run a single test file
```

**Always run `make install` after making code changes.** This deploys to the GNOME extensions directory so changes take effect on next session restart.

After `make install`, a Wayland session restart (log out/in) is required to pick up JS changes.

View extension logs: `journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager`

If GNOME crashes, it sets `disable-user-extensions=true` in dconf — re-enable before testing.

## Architecture

Hexagonal architecture with a pure domain core and GNOME Shell adapters. This project follows hexagonal/ports-and-adapters architecture. Never import GNOME Shell APIs (Main, Meta, etc.) directly in domain or controller layers. All platform interactions must go through adapter interfaces.

### Core data flow

```
Reality -(events)-> Domain -(new world model)-> Adapter -(animates)-> Reality
```

Adapters detect changes in reality (window created, window destroyed, key pressed, focus changed) and inform the domain. The domain computes the complete new world model. The adapter turns that model into reality (positions clones, animates transitions, activates focus). **The domain is always the source of truth.** Adapters never compute layout, focus, or workspace state — they only translate between GNOME signals and domain calls, then apply the domain's output.

This means operations like workspace pruning happen immediately in the domain. If a workspace empties, the domain removes it and adjusts all indices in the same operation. The adapter must reconcile its visual state (e.g. clone containers) to match.

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

`src/domain/` — Pure TypeScript, no `gi://` imports, fully testable with Vitest. All operations are immutable and return `WorldUpdate { world, layout }`. Key modules:
- `world.ts` — Aggregate root. `addWindow`/`removeWindow`/`setFocus`/`updateMonitor`
- `navigation.ts` — `focusRight`/`focusLeft`/`focusDown`/`focusUp`
- `workspace.ts` — Workspace-level window list operations
- `layout.ts` — `computeLayout()` turns workspace + config + monitor into pixel positions (`LayoutState`)
- `types.ts` — Branded types (`WindowId`, `WorkspaceId`), interfaces (`World`, `Workspace`, `TiledWindow`, `Viewport`)

### Ports

`src/ports/` — Adapter interfaces (no `gi://` imports). Controller depends on ports, not concrete adapters.
- `clone-port.ts` — `ClonePort` interface + `OverviewTransform` type
- `window-port.ts` — `WindowPort` interface (positioning, settlement check)
- `focus-port.ts` — `FocusPort` interface (focus activation, tracking)
- `monitor-port.ts` — `MonitorPort` interface (geometry reading)

### Adapters

`src/adapters/` — GNOME Shell integration via `gi://` imports. Each adapter `implements` its corresponding port.
- `controller.ts` — Composition root; wires domain ↔ adapters in `enable()`/`disable()`
- `overview-handler.ts` — Overview mode enter/exit/navigate/click logic (extracted from controller)
- `navigation-handler.ts` — Unified keybinding handlers: `handleSimpleCommand`, `handleVerticalFocus`, `handleVerticalMove`
- `settlement-retry.ts` — Exponential-backoff layout retry for async Wayland configures
- `state-persistence.ts` — Save/restore world state across disable/enable cycles
- `window-event-adapter.ts` — Listens for `window-created`/`destroy` signals, waits for `first-frame`
- `clone-adapter.ts` — Creates `Clutter.Clone` of `WindowActor`s on a custom layer above `global.window_group`
- `window-adapter.ts` — Positions real `Meta.Window`s via `move_resize_frame()`
- `focus-adapter.ts` — Activates windows via `Meta.Window.activate()`
- `monitor-adapter.ts` — Reads monitor geometry, listens for layout changes

**Entry point**: `src/extension.ts` — Standard GNOME extension `enable()`/`disable()` delegating to `KestrelController`.

## Claude Code Hook Integration

Kestrel integrates with Claude Code via a plugin (`kestrel-plugin/`) that registers shell hooks for Claude Code lifecycle events. The hooks communicate with the GNOME extension over session DBus.

### DBus interface

The extension exports `io.kestrel.Extension` at `/io/kestrel/Extension` (see `src/adapters/dbus-service.ts`):

| Method | Args | Returns | Purpose |
|--------|------|---------|---------|
| `HandlePermission` | `payload: s` | `{"id":"notif-N"}` | Show permission card in overlay, return notification ID for polling |
| `HandleNotification` | `payload: s` | `{"id":"notif-N"}` | Show fire-and-forget notification card |
| `GetNotificationResponse` | `id: s` | `{"action":"allow"}` or `{"pending":true}` | Poll for user's response to a permission card |
| `SetWindowStatus` | `sessionId: s, status: s` | — | Update status indicator on the Claude session's window clone |

### Hook scripts

All scripts live in `kestrel-plugin/hooks/` and log to `/tmp/kestrel-hooks.log` with `[scriptname]` prefix.

| Script | Claude Code event | What it does |
|--------|------------------|--------------|
| `kestrel-probe.sh` | `SessionStart` | Writes a terminal title escape sequence (`kestrel_probe_<session_id>`) so the extension can map session IDs to GNOME windows |
| `kestrel-status.sh` | `SessionStart`, `Notification`, `Stop`, `SessionEnd` | Calls `SetWindowStatus` to update the clone's status badge (`done`, `working`, `needs-input`, `end`) |
| `kestrel-notify.sh` | `Notification`, `Stop` | Calls `HandleNotification` — fire-and-forget, no response needed |
| `kestrel-permission.sh` | `PermissionRequest` | Calls `HandlePermission`, then polls `GetNotificationResponse` every 0.5s (up to 10 min) until the user clicks Allow/Deny/Always. Outputs Claude Code decision JSON. |

### Data flow

```
Claude Code -(lifecycle event)-> hook script -(gdbus call)-> GNOME extension DBus
  -> controller.handlePermissionRequest / handleNotification
  -> injects current workspace name from domain
  -> notification-overlay-adapter renders card
  -> user clicks button -> response written
  <- hook polls GetNotificationResponse <- returns action
  <- hook outputs decision JSON to Claude Code
```

### Hook registration

`kestrel-plugin/hooks/hooks.json` maps Claude Code events to scripts:
- **SessionStart**: probe + status(done)
- **Notification**: status(needs-input) + notify
- **PermissionRequest**: permission (blocking, 10 min timeout)
- **Stop**: status(done) + notify
- **SessionEnd**: status(end)

## Key Design Decisions

- **Clone-based rendering**: Real `WindowActor`s can't be reparented from `global.window_group` on Wayland. `Clutter.Clone` allows free positioning on a custom layer for horizontal scrolling.
- **Single GNOME workspace**: All windows on one GNOME workspace; Kestrel workspaces are virtual (domain-managed) to avoid GNOME workspace animation conflicts.
- **Target-state model**: Domain computes only final layout positions, not transitions. Adapters will handle animation (Clutter.ease) separately.
- **GObject subclassing**: Use `GObject.registerClass()` + `_init()`, not `constructor()`.
- **`gi://` ambient types**: Declared in `src/ambient.d.ts`; runtime types from `@girs/*` packages.

## Conventions

- All signal handlers wrapped in try/catch to avoid crashing GNOME Shell
- All signal IDs and timeout IDs tracked for cleanup in `destroy()` methods
- Console logs prefixed with `[Kestrel]`
- Window filtering: only `Meta.WindowType.NORMAL`, not `is_above()`, not transient

## Design Docs

- `docs/design.md` — Product design spec (keybindings, UX, phasing)
- `docs/solution-design.md` — Technical architecture (data model, adapter contracts, phase breakdown)
- `docs/debug.md` — Live debugging via DBus Eval (`global._kestrel`), journal logs, crash recovery

## General Principles

- Always read design docs and existing documentation before proposing fixes. Never guess at solutions — check `docs/` folder first for architectural decisions and stated approaches.
- When asked to write output to a file, write it to the file directly. Do not present it inline first and wait to be asked again.

## Debugging

- When the user reports a bug, first determine whether it reproduces via both keyboard shortcuts AND DBus commands. If only one path is affected, the bug is in that specific handler path, not in shared domain/layout logic.

## GNOME Shell Specifics

- When debugging GNOME Shell/Mutter/Wayland issues: Chromium and CSD windows have async timing behaviors where size-changed signals can undo layout changes. Always check for signal handler interference before assuming layout logic bugs.

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
