# PaperFlow Debugging

## DBus Eval

PaperFlow enables `global.context.unsafe_mode` and exposes `global._paperflow` (the controller instance) for live debugging via DBus Eval.

### Query the domain model

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "global._paperflow.debugState()"
```

Returns JSON with the full world state: config, monitor info, workspaces, windows, viewport, and computed layout (scrollX, window positions/sizes, focused window).

### Simulate keybindings

```bash
# Super+Right (focus next window)
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "global._paperflow._handleFocusRight()"

# Super+Left (focus previous window)
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "global._paperflow._handleFocusLeft()"
```

### Inspect clone layer

```bash
# Clone wrapper + inner clone positions, sizes, allocation, clip
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
let layer = global.window_group.get_parent().get_children().find(c => c.name === 'paperflow-layer');
let strip = layer.get_children().find(c => c.name === 'paperflow-strip');
let focus = layer.get_children().find(c => c.name === 'paperflow-focus-indicator');
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

### Inspect real window actors

```bash
# Frame rect vs buffer rect (reveals CSD vs server-side decoration differences)
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

### Focus clone via DBus

**Important:** `WindowId` is a branded string (`String(get_stable_sequence())`). Always pass string arguments when calling controller methods via DBus Eval, otherwise `===` comparisons will fail silently.

```bash
# Correct — pass string WindowId
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "global._paperflow._handleCloneClicked('4')"

# WRONG — passing a number corrupts focusedWindow type
# global._paperflow._handleCloneClicked(4)
```

## Screenshots

Take screenshots with `gnome-screenshot` for visual debugging:

```bash
# Full screen screenshot (saved to ~/Pictures/)
gnome-screenshot

# After a delay (e.g. 2 seconds, useful for capturing transient UI)
sleep 2 && gnome-screenshot
```

Screenshots are saved to `~/Pictures/`.

## Journal logs

PaperFlow logs to the GNOME Shell journal with `[PaperFlow]` prefix:

```bash
journalctl /usr/bin/gnome-shell --since "5 minutes ago" --no-pager | grep PaperFlow
```

## Re-enable after crash

GNOME sets `disable-user-extensions=true` in dconf after a shell crash:

```bash
gsettings set org.gnome.shell disable-user-extensions false
```
