# DBus Manual Tester Memory

## DBus Command Syntax
- Use `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'EXPR'`
- NOT `busctl` — that requires different parameter syntax

## PaperFlow Debug Interface
- Extension exposes `global._paperflow` (controller instance)
- Key properties (private, with underscore): `_world`, `_settings`, `_cloneAdapter`, `_windowAdapter`, etc.
- Public method: `debugState()` returns JSON string with world + layout
- The returned JSON needs to be parsed: `JSON.parse(global._paperflow.debugState())`

## Clone Layer Structure
```
global.window_group.get_parent()
  └─ paperflow-layer (visible)
      ├─ paperflow-strip (contains workspace containers)
      │   ├─ workspace-container (one per workspace)
      │   │   └─ scroll-container (positioned at -scrollX)
      │   │       └─ paperflow-clone-{id} (one per window)
      │   └─ ...
      └─ paperflow-focus-indicator
```

## Common Inspection Patterns

### Check if extension loaded
```js
JSON.stringify(global._paperflow !== undefined)
```

### Get full state
```js
global._paperflow.debugState()  // returns JSON string
```

### Get real window positions
```js
JSON.stringify(global.get_window_actors()
  .filter(a => a.get_meta_window()?.get_window_type() === 0)
  .map(a => {
    let w = a.get_meta_window();
    return {
      id: w.get_stable_sequence().toString(),
      title: w.get_title(),
      x: w.get_frame_rect().x,
      y: w.get_frame_rect().y
    };
  }))
```

### Check clone positions
```js
let layer = global.window_group.get_parent().get_children().find(c => c.name === "paperflow-layer");
let strip = layer.get_children().find(c => c.name === "paperflow-strip");
// iterate strip.get_children() for workspace containers
```

## WindowActor Clipping Behavior

**CRITICAL FINDING**: `actor.set_clip(0, 0, 0, 0)` does NOT hide the window actor.

**Why**: Clutter treats a zero-width, zero-height clip as "no clip constraint" rather than "hide everything." The clip is defined in the actor's coordinate space (buffer rect), and a zero-sized region doesn't clip anything.

**Solution**: Use `actor.opacity = 0` instead of clipping to hide offscreen windows.

**Evidence** (2026-02-15):
- `set_clip(0, 0, 0, 0)` leaves windows fully visible
- `set_clip(10000, 10000, 1, 1)` (offscreen clip) also doesn't hide windows effectively
- `actor.opacity = 0` successfully hides the real window actor
- **Clone independence**: Setting source actor opacity=0 does NOT affect clone opacity — clones remain visible at opacity=255

**Buffer vs Frame Rect**:
- `get_buffer_rect()` is the actor's coordinate space (includes client-side decorations)
- `get_frame_rect()` is the logical window position on screen
- Buffer rect can have negative offsets relative to frame rect (e.g., bufferX=703, frameX=764)

**Code location**: `src/adapters/window-adapter.ts:135` - offscreen window handling in `applyLayout()`

## Known Issues Found

### Issue: set_clip(0,0,0,0) doesn't hide offscreen windows
**Date**: 2026-02-15
**Status**: ROOT CAUSE IDENTIFIED
**Symptom**: Windows on other workspaces remain visible despite zero-clip applied
**Root cause**: Clutter treats zero-sized clips as "no constraint," not "hide everything"
**Solution**: Replace `actor.set_clip(0, 0, 0, 0)` with `actor.opacity = 0`
**Side effect**: Clones are independent — setting source opacity=0 doesn't affect clone visibility
