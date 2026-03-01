# Kestrel Debugging Guide

## 1. Journal Logs

Kestrel logs to the GNOME Shell journal with `[Kestrel]` prefix:

```bash
journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager | grep Kestrel
```

## 2. Debug Mode

Enable verbose logging and the debug interface by setting `debug-mode` to true:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/kestrel@kestrel.github.com/schemas \
  set org.gnome.shell.extensions.kestrel debug-mode true
```

Requires a session restart to take effect.

When enabled, `global._kestrel` is exposed on the GNOME Shell global object with two methods:

- `debugState()` — Returns JSON with the full world state (config, monitor, workspaces, windows, viewport, computed layouts, scene model, and quake state including slot assignments and active slot).
- `diagnostics()` — Compares expected scene (from domain `computeScene()`) against actual adapter state read from Clutter actors. Returns `{ expected, actual, mismatches }`. When a quake overlay is active, the quake window scene is included in the comparison.

## 3. Querying Domain State via DBus

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "JSON.stringify(global._kestrel.debugState())"
```

**Note:** Shell.Eval output is GVariant-escaped — the JSON is wrapped in multiple quoting layers. The result format is `(true, '"{\\"config\\":...}"')`.

## 4. GetDiagnostics DBus Method

Compare expected scene state (from domain) against actual adapter state (from Clutter actors):

```bash
gdbus call --session --dest org.gnome.Shell \
  --object-path /io/kestrel/Extension \
  --method io.kestrel.Extension.GetDiagnostics
```

Returns JSON with three fields:

- `expected` — Scene model computed by `computeScene()` from current world state.
- `actual` — Scene model built by reading actual Clutter actor positions, real window frame rects, focus indicator geometry.
- `mismatches` — Array of differences between expected and actual (e.g., clone at wrong position, real window misaligned).

**Important:** The extension exports its DBus object at `/io/kestrel/Extension` on the GNOME Shell session bus. It does NOT own a well-known bus name, so you must use `org.gnome.Shell` as the destination:

```bash
# Correct — use org.gnome.Shell as destination
gdbus call --session --dest org.gnome.Shell \
  --object-path /io/kestrel/Extension \
  --method io.kestrel.Extension.GetDiagnostics

# Wrong — will fail with ServiceUnknown
gdbus call --session --dest io.kestrel.Extension ...
```

## 5. DBus Introspection

To verify which methods are available on the running instance:

```bash
gdbus introspect --session --dest org.gnome.Shell \
  --object-path /io/kestrel/Extension
```

This is important because deployed code may differ from source — use introspection to confirm.

## 6. Inspecting the Clone Layer

Query the Clutter actor tree for clone positions, sizes, and scroll state:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
let layer = global.window_group.get_parent().get_children().find(c => c.name === 'kestrel-layer');
let strip = layer.get_children().find(c => c.name === 'kestrel-strip');
let focus = layer.get_children().find(c => c.name === 'kestrel-focus-indicator');
let r = [];
for (let wsc of strip.get_children()) {
  let scroll = wsc.get_children()[0];
  r.push('scroll(' + scroll.x + ')');
  for (let w of scroll.get_children()) {
    let c = w.get_children()[0];
    r.push(w.name + ' wrapper(' + w.x + ',' + w.y + ' ' + w.width + 'x' + w.height + ' clip=' + w.clip_to_allocation + ') clone(' + c.x + ',' + c.y + ' ' + c.width + 'x' + c.height + ')');
  }
}
r.push('focus(' + focus.x + ',' + focus.y + ' ' + focus.width + 'x' + focus.height + ' vis=' + focus.visible + ')');
r.join(' | ');
"
```

Actor hierarchy:

```
kestrel-layer (clipped, above window_group)
├── overview-bg
├── kestrel-strip (Y-translated for workspace switching)
│   └── kestrel-ws-{id} (per workspace container)
│       └── kestrel-scroll-{id} (X-translated for horizontal scrolling)
│           └── kestrel-clone-{windowId} (wrapper, clips content)
│               └── Clutter.Clone (source: WindowActor)
└── kestrel-focus-indicator (St.Widget)
```

## 7. Inspecting Real Window Actors

Check frame rect vs buffer rect (reveals CSD vs server-side decoration differences):

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
global.get_window_actors().map(a => {
  let mw = a.meta_window;
  let fr = mw.get_frame_rect();
  let br = mw.get_buffer_rect();
  return 'id=' + mw.get_stable_sequence() + ' vis=' + a.visible + ' frame(' + fr.x + ',' + fr.y + ',' + fr.width + 'x' + fr.height + ') buffer(' + br.x + ',' + br.y + ',' + br.width + 'x' + br.height + ')';
}).join(' | ');
"
```

## 8. WindowId Typing

`WindowId` is a branded string (`String(get_stable_sequence())`). When calling methods via DBus Eval, always pass string arguments — otherwise `===` comparisons fail silently:

```bash
# Correct — string
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "JSON.stringify(global._kestrel.debugState())"

# WRONG — number would corrupt type checks
```

## 9. Screenshots

```bash
gnome-screenshot              # Full screen, saved to ~/Pictures/
sleep 2 && gnome-screenshot   # With delay (for transient UI)
```

## 10. Re-enable After Crash

GNOME sets `disable-user-extensions=true` in dconf after a shell crash:

```bash
gsettings set org.gnome.shell disable-user-extensions false
```

## 11. Deployed vs Source

DBus methods and `global._kestrel` properties reflect the **deployed** code, not the current source. After `make install`, a session restart is required for JS changes to take effect (log out/in on Wayland, or Alt+F2 → `r` → Enter on X11).

Workflow:

1. Edit source
2. `make install` (builds, tests, deploys)
3. Restart session (log out/in on Wayland, or Alt+F2 → `r` → Enter on X11)
4. Verify via journal logs or DBus introspection

## 12. Common Issues

**CSD / oversized window timing:** Chromium and CSD windows have async timing where `size-changed` signals can undo layout changes. Check for signal handler interference before assuming layout logic bugs.

**Async configures:** `move_resize_frame()` is async on Wayland — the window may not reach the target size immediately. The settlement retry system handles this with exponential backoff (100ms to 1000ms, 8 retries). On X11, positioning is typically synchronous so settlement completes on the first check.

**Signal handler interference:** When debugging layout bugs, check if `_onSizeChanged` or `_onPositionChanged` handlers in `window-adapter.ts` are re-triggering layout corrections that fight with the intended layout.

**Mutter constraints:** `constrain_partially_onscreen` prevents real windows from being positioned outside monitor bounds. The focused window is always positioned within bounds (scrollX ensures this). Non-focused windows may be clamped by Mutter — this is expected and does not affect the clone-based visual rendering.

**Quake window spawn timing:** When a quake slot hotkey launches an app, the window does not appear immediately. The domain marks the slot as awaiting assignment, and the window-created handler assigns it when the window's first frame arrives. If the window never appears (e.g., invalid app ID), the slot remains empty. Check journal logs for `[Kestrel]` messages about quake slot assignment failures.
