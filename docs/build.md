# Build, Test & Development

## 1. Quick Reference

| Command | Description |
|---------|-------------|
| `make build` | Compile TypeScript → `dist/` |
| `make test` | Run all Vitest tests (with coverage) |
| `make lint` | ESLint + Knip (dead code detection) |
| `make install` | Build + test + lint + deploy to GNOME extensions dir + compile schemas + install plugin |
| `make dev` | Install + enable + show restart instructions |
| `make enable` | Enable extension, disable conflicting exts, enable Claude Code plugin |
| `make disable` | Disable extension, restore GNOME defaults, disable plugin |
| `make status` | Show installation/enable status |
| `make coverage` | Vitest with detailed coverage report |

Run a single test file:
```bash
npx vitest run test/domain/world.test.ts
```

## 2. Prerequisites

- GNOME Shell 45, 46, or 47
- Node.js and npm
- GLib schema compiler (`glib-compile-schemas`, usually pre-installed)

## 3. Project Structure

```
kestrel/
├── src/
│   ├── domain/          # Pure TypeScript domain core (no gi:// imports)
│   ├── ports/           # Port interfaces (no gi:// imports)
│   ├── adapters/        # GNOME Shell adapters (gi:// imports)
│   ├── ui-components/   # Presentational widget builders (gi://)
│   ├── extension.ts     # Composition root (entry point)
│   ├── prefs.ts         # GNOME preferences dialog
│   ├── ambient.d.ts     # gi:// and resource:// type declarations
│   └── metadata.json    # Extension metadata
├── test/
│   ├── domain/          # Domain unit tests (15 files)
│   ├── adapters/        # Adapter integration tests (4 test files + mock-ports.ts)
│   └── arch/            # Architecture boundary tests (2 files)
├── schemas/
│   └── org.gnome.shell.extensions.kestrel.gschema.xml
├── kestrel-plugin/      # Claude Code integration
│   ├── .claude-plugin/  # Plugin metadata
│   ├── hooks/           # Hook scripts
│   └── agents/          # Specialized agents
├── docs/                # Documentation
├── Makefile
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── vitest.config.ts
```

## 4. TypeScript Configuration

From `tsconfig.json`:

| Option | Value |
|--------|-------|
| `module` | NodeNext |
| `moduleResolution` | NodeNext |
| `target` | ES2022 |
| `outDir` | dist |
| `rootDir` | src |
| `strict` | true |
| `declaration` | false |
| `sourceMap` | false |
| `skipLibCheck` | true |
| `types` | [] (no automatic @types) |

Includes: `src/**/*.ts`. Excludes: `test/**/*.ts`.

A separate `tsconfig.eslint.json` includes both `src/` and `test/` for linting purposes.

## 5. Build Pipeline

`make build` runs `npx tsc`, compiling TypeScript to JavaScript in `dist/`.

`make install` then:
1. Builds (`make build`)
2. Runs tests (`make test`)
3. Runs linting (`make lint`)
4. Removes old extension files from `~/.local/share/gnome-shell/extensions/kestrel@kestrel.github.com/`
5. Copies `dist/`, `metadata.json`, `stylesheet.css` to the extension directory
6. Compiles GSettings schemas (`glib-compile-schemas`)
7. Installs Claude Code plugin (symlink + hook script copy)

## 6. Testing

**Framework:** Vitest (v3.0+) with v8 coverage provider.

**Configuration** (`vitest.config.ts`):
- Test pattern: `test/**/*.test.ts`
- Coverage thresholds: 80% (lines, functions, branches, statements)
- Coverage includes: `src/**/*.ts`
- Coverage excludes: `src/adapters/**`, `src/ports/**`, `src/ui-components/**`, `src/ambient.d.ts`, `src/extension.ts`, `src/prefs.ts`

**Test categories:**

### Domain Unit Tests (`test/domain/`) — 15 files

Pure TypeScript tests requiring no GNOME Shell runtime:

| File | Covers |
|------|--------|
| `world.test.ts` | World aggregate root (addWindow, removeWindow, setFocus, switchToWorkspace) |
| `workspace.test.ts` | Workspace operations (add/remove, neighbors, slot indices) |
| `layout.test.ts` | `computeLayout()` pixel position calculation |
| `scene.test.ts` | `computeScene()` complete scene model generation |
| `navigation.test.ts` | focusRight/Left/Down/Up with slot-based targeting |
| `window-operations.test.ts` | moveRight/Left/Down/Up, toggleSize |
| `overview.test.ts` | enterOverview, exitOverview, cancelOverview |
| `overview-state.test.ts` | Filter text, rename, focused indices, overview transform |
| `notification.test.ts` | Notification lifecycle, question interaction, focus mode |
| `fullscreen.test.ts` | Fullscreen enter/exit behavior |
| `workspace-naming.test.ts` | Workspace naming/renaming |
| `filter-workspaces.test.ts` | Workspace filter logic |
| `fuzzy-match.test.ts` | Fuzzy search scoring |
| `smoke.test.ts` | Basic smoke tests of common operations |

### Adapter Integration Tests (`test/adapters/`) — 4 test files

Tests for handlers that orchestrate domain + adapter interactions. Use mock port implementations from `mock-ports.ts`:

| File | Covers |
|------|--------|
| `overview-handler.test.ts` | Overview enter/exit/navigate/filter/click |
| `navigation-handler.test.ts` | handleSimpleCommand, handleVerticalFocus, handleVerticalMove |
| `window-lifecycle-handler.test.ts` | Window add/remove/fullscreen/maximize |
| `extension.test.ts` | End-to-end extension integration |
| `mock-ports.ts` | Mock implementations of all port interfaces (utility, not a test) |

### Architecture Boundary Tests (`test/arch/`) — 2 files

| File | Enforces |
|------|----------|
| `domain-boundary.test.ts` | Domain files have no `gi://` imports |
| `adapter-ui-boundary.test.ts` | UI components don't import domain types directly |

## 7. Linting

**ESLint** (v9+, flat config in `eslint.config.mjs`):

Base: ESLint recommended + TypeScript ESLint recommended.

Complexity limits by layer:

| Layer | Max Complexity | Max LOC/Function |
|-------|---------------|------------------|
| Adapters (`src/adapters/`) | 5 | 20 |
| UI Components (`src/ui-components/`) | 8 | 60 |
| Domain (`src/domain/`) | No limit | No limit |
| Tests (`test/`) | No limit | No limit |

Other rules:
- Unused variables: error (ignores `_`-prefixed vars)
- `@typescript-eslint/no-explicit-any`: disabled in tests

**Knip** — Dead code detection. Run via `npx knip` or as part of `make lint`.

## 8. GSettings Schema

Schema ID: `org.gnome.shell.extensions.kestrel`
Path: `/org/gnome/shell/extensions/kestrel@kestrel.github.com/`

### Keybindings

| Key | Type | Default |
|-----|------|---------|
| `focus-right` | string array | `['<Super>Right']` |
| `focus-left` | string array | `['<Super>Left']` |
| `focus-down` | string array | `['<Super>Down']` |
| `focus-up` | string array | `['<Super>Up']` |
| `move-right` | string array | `['<Super><Shift>Right']` |
| `move-left` | string array | `['<Super><Shift>Left']` |
| `move-down` | string array | `['<Super><Shift>Down']` |
| `move-up` | string array | `['<Super><Shift>Up']` |
| `toggle-size` | string array | `['<Super>f']` |
| `kestrel-toggle-overview` | string array | `['<Super>minus']` |
| `new-window` | string array | `['<Super>n']` |
| `close-window` | string array | `['<Super>BackSpace']` |
| `toggle-notifications` | string array | `['<Super>period']` |
| `toggle-help` | string array | `['<Super>apostrophe']` |
| `join-stack` | string array | `['<Super>j']` |
| `force-workspace-up` | string array | `['<Super><Alt>Up']` |
| `force-workspace-down` | string array | `['<Super><Alt>Down']` |

### Layout Configuration

| Key | Type | Default |
|-----|------|---------|
| `column-count` | int | 2 (range 1--6) |
| `gap-size` | int | 8 |
| `edge-gap` | int | 8 |

### Visual Configuration

| Key | Type | Default |
|-----|------|---------|
| `focus-border-width` | int | 3 |
| `focus-border-color` | string | `rgba(125,214,164,0.8)` |
| `focus-background-color` | string | `rgba(125,214,164,0.05)` |
| `focus-border-radius` | int | 8 |

### System

| Key | Type | Default |
|-----|------|---------|
| `debug-mode` | boolean | false |
| `saved-state` | string | (empty) |

## 9. Extension Metadata

From `src/metadata.json`:

| Field | Value |
|-------|-------|
| UUID | `kestrel@kestrel.github.com` |
| Name | Kestrel |
| Description | Niri-style scrolling tiling for GNOME |
| Supported GNOME Shell | 45, 46, 47 |
| Repository | https://github.com/notiriel/kestrel |
| Settings schema | `org.gnome.shell.extensions.kestrel` |

## 10. Development Workflow

1. Edit source in `src/`
2. Run `make install` (builds, tests, lints, deploys)
3. Restart session (log out/in on Wayland, or Alt+F2 → `r` → Enter on X11)
4. Verify via journal logs: `journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager`
5. Debug via DBus if needed (see `docs/debug.md`)

**Important:** If GNOME crashes, it sets `disable-user-extensions=true` in dconf. Re-enable:
```bash
gsettings set org.gnome.shell disable-user-extensions false
```

## 11. Conflicting Extensions

`make enable` auto-disables these conflicting extensions:
- `tiling-assistant@ubuntu.com`
- `ding@rastersoft.com`
- `ubuntu-dock@ubuntu.com`

`make disable` re-enables them.

## 12. Dependencies

From `package.json`:

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7 | TypeScript compiler |
| `vitest` | ^3.0 | Test runner |
| `@vitest/coverage-v8` | ^3.2.4 | Coverage provider |
| `eslint` | ^9.39.3 | Linter |
| `@eslint/js` | ^9.39.3 | ESLint recommended config |
| `typescript-eslint` | ^8.56.1 | TypeScript ESLint |
| `knip` | ^5.83.1 | Dead code detection |
| `@girs/gjs` | 4.0.0-beta.38 | GJS type definitions |
| `@girs/gnome-shell` | 46.0.2 | GNOME Shell type definitions |
| `@girs/gobject-2.0` | 2.84.4 | GObject type definitions |
| `@girs/glib-2.0` | 2.84.4 | GLib type definitions |
| `@girs/gio-2.0` | 2.84.4 | GLib I/O type definitions |
