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

After `make install`, a Wayland session restart (log out/in) is required to pick up JS changes.

View extension logs: `journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager`

If GNOME crashes, it sets `disable-user-extensions=true` in dconf — re-enable before testing.

## Architecture

Hexagonal architecture with a pure domain core and GNOME Shell adapters.

**Domain core** (`src/domain/`): Pure TypeScript, no `gi://` imports, fully testable with Vitest. All operations are immutable and return new state. Key modules:
- `world.ts` — Aggregate root. `addWindow`/`removeWindow` return `WorldUpdate { world, layout }`
- `workspace.ts` — Workspace-level window list operations
- `layout.ts` — `computeLayout()` turns workspace + config + monitor into pixel positions (`LayoutState`)
- `types.ts` — Branded types (`WindowId`, `WorkspaceId`), interfaces (`World`, `Workspace`, `TiledWindow`, `Viewport`)

**Adapters** (`src/adapters/`): GNOME Shell integration via `gi://` imports.
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
