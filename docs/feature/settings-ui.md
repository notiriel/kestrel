# Settings UI — Implemented

Complete preferences window for all Kestrel settings using Adwaita widgets in a multi-page tabbed layout.

## Current state

`src/prefs.ts` exposes 6 of 38 settings (gap size, edge gap, focus border width/radius/color/background). Everything else requires `dconf-editor` or `gsettings` CLI. The extension already supports live reload — changing any setting triggers immediate domain recomputation and scene re-rendering.

## Page organization

Four pages (tabs) in the `Adw.PreferencesWindow`:

### Page 1: Layout

Icon: `preferences-desktop-display-symbolic`

| Group | Row | Widget | Setting key | Range | Default |
|-------|-----|--------|-------------|-------|---------|
| **Tiling** | Columns | SpinRow | `column-count` | 1–6 | 2 |
| | Gap Size | SpinRow | `gap-size` | 0–64 | 8 |
| | Edge Gap | SpinRow | `edge-gap` | 0–64 | 8 |
| **Focus Indicator** | Border Width | SpinRow | `focus-border-width` | 0–16 | 3 |
| | Border Radius | SpinRow | `focus-border-radius` | 0–32 | 8 |
| | Border Color | ColorDialogButton | `focus-border-color` | — | `rgba(125,214,164,0.8)` |
| | Background Color | ColorDialogButton | `focus-background-color` | — | `rgba(125,214,164,0.05)` |

### Page 2: Keybindings

Icon: `input-keyboard-symbolic`

All keybindings use a custom `ShortcutRow` widget (see below). Grouped by function:

| Group | Row | Setting key | Default |
|-------|-----|-------------|---------|
| **Navigation** | Focus Right | `focus-right` | `Super+Right` |
| | Focus Left | `focus-left` | `Super+Left` |
| | Focus Down | `focus-down` | `Super+Down` |
| | Focus Up | `focus-up` | `Super+Up` |
| **Window Management** | Move Left | `move-left` | `Super+Shift+Left` |
| | Move Right | `move-right` | `Super+Shift+Right` |
| | Move Down | `move-down` | `Super+Shift+Down` |
| | Move Up | `move-up` | `Super+Shift+Up` |
| | Toggle Size | `toggle-size` | `Super+F` |
| | Join/Unstack | `join-stack` | `Super+J` |
| | Close Window | `close-window` | `Super+BackSpace` |
| | New Window | `new-window` | `Super+N` |
| **Workspaces** | Force Workspace Up | `force-workspace-up` | `Super+Alt+Up` |
| | Force Workspace Down | `force-workspace-down` | `Super+Alt+Down` |
| **Panels & Overlays** | Toggle Overview | `kestrel-toggle-overview` | `Super+Minus` |
| | Toggle Help | `toggle-help` | `Super+'` |
| | Toggle Notifications | `toggle-notifications` | `Super+.` |

### Page 3: Quake Console

Icon: `utilities-terminal-symbolic`

| Group | Row | Widget | Setting key | Default |
|-------|-----|--------|-------------|---------|
| **General** | Pre-launch Apps | SwitchRow | `quake-prelaunch` | true |
| | Width | SpinRow (+ `%` suffix) | `quake-width-percent` | 80 |
| | Height | SpinRow (+ `%` suffix) | `quake-height-percent` | 80 |
| **Slot 1** | Application | AppChooserRow | `quake-slot-1` | (empty) |
| | Keybinding | ShortcutRow | `quake-slot-1-toggle` | `Super+W` |
| **Slot 2** | Application | AppChooserRow | `quake-slot-2` | (empty) |
| | Keybinding | ShortcutRow | `quake-slot-2-toggle` | `Super+E` |
| **Slot 3** | Application | AppChooserRow | `quake-slot-3` | (empty) |
| | Keybinding | ShortcutRow | `quake-slot-3-toggle` | `Super+R` |
| **Slot 4** | Application | AppChooserRow | `quake-slot-4` | (empty) |
| | Keybinding | ShortcutRow | `quake-slot-4-toggle` | `Super+T` |
| **Slot 5** | Application | AppChooserRow | `quake-slot-5` | (empty) |
| | Keybinding | ShortcutRow | `quake-slot-5-toggle` | `Super+Z` |

### Page 4: Advanced

Icon: `applications-engineering-symbolic`

| Group | Row | Widget | Setting key | Default |
|-------|-----|--------|-------------|---------|
| **Diagnostics** | Debug Mode | SwitchRow | `debug-mode` | false |

## Custom widgets

### ShortcutRow

Text-only keybinding editor built as an `Adw.ActionRow` suffix.

**Display state**: Shows the current accelerator as human-readable text (e.g. `Super + Right`). A pencil icon button sits at the end.

**Editing state**: User clicks the row or pencil icon. The label changes to "Press a key combination..." with a highlighted/accent style. The row captures the next key combo via `Gtk.EventControllerKey`. On valid combo, it writes the accelerator string to GSettings and returns to display state. `Escape` cancels without saving.

**Clear**: A small "x" button next to the accelerator clears the binding (sets to empty array `[]`).

**Conflict detection**: After capturing a combo, check all other keybinding keys in the schema. If the combo is already used, show an inline warning: "Already used by [other binding name]". Still allow setting it (the user may intend to reassign).

### AppChooserRow

Dropdown populated from installed `.desktop` files.

**Implementation**: `Adw.ComboRow` with a `Gtk.StringList` model. On preferences window init, enumerate installed apps via `Gio.AppInfo.get_all()`, filter to those with `should_show() === true`, sort alphabetically by display name. Each item shows the app's display name. A "(None)" entry at position 0 represents an empty/disabled slot.

**Display**: The row subtitle shows the desktop app ID when an app is selected (e.g. `org.gnome.Terminal.desktop`), so the user can see the technical identifier.

**Sync**: On selection change, write the app's desktop ID to GSettings. On init, find and select the matching entry from the current setting value.

## Reset to default

### Per-group reset

Each `Adw.PreferencesGroup` has a header suffix button (circular, `edit-undo-symbolic` icon, tooltip "Reset group to defaults"). Clicking it calls `settings.reset(key)` for every key in that group and refreshes all widgets.

### Per-row reset

Each row that has been modified from its default shows a subtle `edit-undo-symbolic` button in the suffix area. Clicking resets that single key. The button is hidden when the value matches the default.

Detecting "modified from default": compare `settings.get_value(key)` against `settings.get_default_value(key)`.

### Full reset

The window header bar has a menu button (hamburger) with a "Reset All Settings" option. Shows a confirmation dialog (`Adw.AlertDialog`) before resetting. Resets every key except `saved-state` (world persistence should not be wiped by a settings reset).

## Settings not exposed

- `saved-state` — internal persistence, not a user setting.

## Architecture notes

The prefs window runs in a separate process from GNOME Shell (this is standard GNOME extension behavior). It communicates with the running extension purely through GSettings — when prefs writes a value, the extension's `settings.connect('changed', ...)` handler picks it up and applies it live.

No domain or adapter code is imported into prefs. The prefs module only depends on `gi://Adw`, `gi://Gtk`, `gi://Gdk`, `gi://Gio`.

## File structure

All preferences code lives in `src/prefs.ts`. Extracted widget builders (ShortcutRow, AppChooserRow, reset helpers) go into `src/prefs/` as separate modules if `prefs.ts` exceeds ~200 lines. The prefs entry point re-exports from these modules.

Proposed split:

```
src/prefs.ts                    # Entry point: KestrelPreferences, page construction
src/prefs/shortcut-row.ts       # ShortcutRow widget builder
src/prefs/app-chooser-row.ts    # AppChooserRow widget builder
src/prefs/reset-helpers.ts      # Reset-to-default logic (per-row, per-group, full)
src/prefs/color-row.ts          # Color picker row (extracted from current prefs.ts)
```

## Implementation order

1. Restructure prefs.ts into multi-page layout, move existing settings into Page 1
2. Extract color row helper into `src/prefs/color-row.ts`
3. Build ShortcutRow widget, populate Page 2 (Keybindings)
4. Build AppChooserRow widget, populate Page 3 (Quake Console)
5. Add Page 4 (Advanced) with debug toggle
6. Implement reset-to-default (per-row, per-group, full reset)
7. Add conflict detection to ShortcutRow
