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
# Clone wrapper positions and sizes
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
let layer = global.window_group.get_parent().get_children().find(c => c.name === 'paperflow-layer');
let scroll = layer.get_children()[0];
let wrappers = scroll.get_children().filter(c => c.name && c.name.startsWith('paperflow-clone-'));
wrappers.map(w => w.name + ' pos(' + w.x + ',' + w.y + ') size(' + w.width + 'x' + w.height + ')').join(' | ');
"
```

### Inspect real window actors

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
global.get_window_actors().map(a => {
  let mw = a.meta_window;
  let fr = mw.get_frame_rect();
  return 'id=' + mw.get_stable_sequence() + ' vis=' + a.visible + ' opacity=' + a.opacity + ' frame(' + fr.x + ',' + fr.y + ',' + fr.width + 'x' + fr.height + ')';
}).join(' | ');
"
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
