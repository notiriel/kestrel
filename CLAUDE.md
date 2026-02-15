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

Hexagonal architecture with a pure domain core and GNOME Shell adapters.

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

### Adapters

`src/adapters/` — GNOME Shell integration via `gi://` imports.
- `controller.ts` — Composition root; wires domain ↔ adapters in `enable()`/`disable()`
- `window-event-adapter.ts` — Listens for `window-created`/`destroy` signals, waits for `first-frame`
- `clone-adapter.ts` — Creates `Clutter.Clone` of `WindowActor`s on a custom layer above `global.window_group`
- `window-adapter.ts` — Positions real `Meta.Window`s via `move_resize_frame()`
- `focus-adapter.ts` — Activates windows via `Meta.Window.activate()`
- `monitor-adapter.ts` — Reads monitor geometry, listens for layout changes

**Entry point**: `src/extension.ts` — Standard GNOME extension `enable()`/`disable()` delegating to `PaperFlowController`.

## Key Design Decisions

- **Clone-based rendering**: Real `WindowActor`s can't be reparented from `global.window_group` on Wayland. `Clutter.Clone` allows free positioning on a custom layer for horizontal scrolling.
- **Single GNOME workspace**: All windows on one GNOME workspace; PaperFlow workspaces are virtual (domain-managed) to avoid GNOME workspace animation conflicts.
- **Target-state model**: Domain computes only final layout positions, not transitions. Adapters will handle animation (Clutter.ease) separately.
- **GObject subclassing**: Use `GObject.registerClass()` + `_init()`, not `constructor()`.
- **`gi://` ambient types**: Declared in `src/ambient.d.ts`; runtime types from `@girs/*` packages.

## Conventions

- All signal handlers wrapped in try/catch to avoid crashing GNOME Shell
- All signal IDs and timeout IDs tracked for cleanup in `destroy()` methods
- Console logs prefixed with `[PaperFlow]`
- Window filtering: only `Meta.WindowType.NORMAL`, not `is_above()`, not transient

## Design Docs

- `docs/design.md` — Product design spec (keybindings, UX, phasing)
- `docs/solution-design.md` — Technical architecture (data model, adapter contracts, phase breakdown)
- `docs/debug.md` — Live debugging via DBus Eval (`global._paperflow`), journal logs, crash recovery
