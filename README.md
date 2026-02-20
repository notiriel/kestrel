# PaperFlow

Niri-style scrolling tiling window manager for GNOME Shell, with deep [Claude Code](https://docs.anthropic.com/en/docs/claude-code) integration.

PaperFlow arranges your windows in horizontal strips across virtual workspaces. Instead of fitting windows into fixed tiles, your workspace is an infinite scrollable plane — windows flow left and right, workspaces stack vertically, and you navigate with keyboard shortcuts.

<!-- TODO: Add screenshot or gif here -->

## How It Works

```
            ← X (windows) →

        ┌────────┬────────┬────────┬────────┐
   W0   │  win0  │  win1  │  win2  │  win3  │
        ├────────┼────────┼────────┼────────┤
   W1   │  win0  │  win1  │        │        │
        ├────────┼────────┼────────┼────────┤
   W2   │  win0  │  win1  │  win2  │        │
        └────────┴────────┴────────┴────────┘

        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
        └── viewport ────┘
```

Your monitors form a viewport that slides across this 2D plane. All navigation is viewport movement — horizontal for window switching, vertical for workspace switching.

## Features

- **Scrolling tiling** — windows in horizontal strips, half or full monitor width
- **Virtual workspaces** — stacked vertically, dynamic creation/removal
- **Bird's-eye overview** — see all workspaces at once, navigate with keyboard or click
- **Multi-monitor** — monitors combine into a single viewport
- **Fullscreen support** — windows step out of the strip, rest rearranges
- **Claude Code integration** — session status indicators, permission cards in overview, DBus hook scripts
- **State persistence** — layout survives screen lock and extension restarts

## Requirements

- GNOME Shell 45, 46, or 47 (Wayland)
- Node.js 18+ and npm (for building)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (for the hook integration features)

## Install

```bash
git clone https://github.com/notiriel/paperflow.git
cd paperflow
npm install
make install    # Build + deploy to GNOME extensions dir
make enable     # Enable extension + Claude Code plugin + disable conflicting extensions
```

Then **restart your session** (log out and back in on Wayland).

To check installation status:

```bash
make status
```

### What `make install` Does

1. Compiles TypeScript to `dist/`
2. Copies extension files to `~/.local/share/gnome-shell/extensions/`
3. Compiles GSettings schemas
4. Symlinks the Claude Code plugin to `~/.claude/plugins/`
5. Symlinks the Ulauncher extension

### What `make enable` Does

1. Enables the GNOME extension
2. Disables conflicting extensions (Ubuntu tiling-assistant, DING, Ubuntu Dock)
3. Enables the Claude Code plugin in `~/.claude/settings.json`

## Keybindings

All keybindings are configurable via GSettings.

| Keybinding | Action |
|---|---|
| `Super+Right` | Focus next window |
| `Super+Left` | Focus previous window |
| `Super+Down` | Switch to workspace below |
| `Super+Up` | Switch to workspace above |
| `Super+F` | Toggle window half/full width |
| `Super+Shift+Right` | Move window right (swap) |
| `Super+Shift+Left` | Move window left (swap) |
| `Super+Shift+Down` | Move window to workspace below |
| `Super+Shift+Up` | Move window to workspace above |
| `Super+-` | Toggle overview |
| `Super+N` | Open new window of focused app |
| `Super+.` | Toggle notification focus mode |

PaperFlow takes over the Super key, GNOME overview, and several default GNOME keybindings. `make disable` restores all original bindings.

## Claude Code Integration

PaperFlow includes a Claude Code plugin (`paperflow-plugin/`) that connects Claude Code sessions to the tiling manager via DBus hooks:

- **Session tracking** — each Claude Code terminal is mapped to its window via title probes
- **Status indicators** — window clones show session status (working, needs-input, done) as colored badges
- **Permission cards** — tool permission requests appear as overlay cards in the PaperFlow overview
- **Notification cards** — fire-and-forget notifications from Claude Code sessions

This integration requires Claude Code to be installed and the plugin to be enabled (handled by `make enable`).

## Ulauncher Extension

The `ulauncher-paperflow/` directory contains an optional [Ulauncher](https://ulauncher.io/) extension for workspace switching. Type `ws` followed by a workspace name to jump to it.

Installed automatically by `make install` if Ulauncher is present.

## Development

```bash
make build          # Compile TypeScript
make test           # Run all Vitest tests
make dev            # Build + install + enable (then restart session)
npx vitest run test/domain/world.test.ts  # Run a single test file
```

View extension logs:

```bash
journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager
```

### Debug Mode

Enable verbose logging and DBus debug interface:

```bash
gsettings set org.gnome.shell.extensions.paperflow debug-mode true
```

This exposes `global._paperflow` for DBus inspection and enables detailed event logging.

### Architecture

Hexagonal architecture with a pure domain core and GNOME Shell adapters:

```
Reality -(events)-> Domain -(new world model)-> Adapter -(animates)-> Reality
```

- **`src/domain/`** — Pure TypeScript, no GNOME imports, fully testable with Vitest
- **`src/ports/`** — Adapter interfaces
- **`src/adapters/`** — GNOME Shell integration via `gi://` imports

See `docs/design.md` for the full product spec and `docs/solution-design.md` for technical architecture.

## Uninstall

```bash
make disable    # Restore GNOME keybindings, disable extension and plugin
```

Then remove the extension directory:

```bash
rm -rf ~/.local/share/gnome-shell/extensions/paperflow@paperflow.github.com
```

## License

[MIT](LICENSE)
