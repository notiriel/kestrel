# PaperFlow Design Document

## Core Concept: The World

The World is a 2-dimensional plane of windows. The viewport (your monitors) looks at a portion of this plane. All navigation is viewport movement through the World.

```
            ← X (windows) →

        ┌────────┬────────┬────────┬────────┐
   W0   │  win0  │  win1  │  win2  │  win3  │
        ├────────┼────────┼────────┼────────┤
↕  W1   │  win0  │  win1  │        │        │
Y  ├────────┼────────┼────────┼────────┤
   W2   │  win0  │  win1  │  win2  │        │
        ├────────┼────────┼────────┼────────┤
   W3   │ (empty — always exists)           │
        └────────┴────────┴────────┴────────┘

        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
        └── viewport ────┘
```

## Workspaces

- The World contains multiple **workspaces** stacked vertically.
- Each workspace is an independent horizontal strip of windows.
- **PaperFlow workspaces are virtual** — all windows live on a single GNOME workspace. PaperFlow owns the entire 2D plane and manages visibility, focus, and positioning itself. This avoids fighting GNOME's workspace switching animation system.
- **Dynamic growth:** There is always exactly one empty workspace at the bottom. When a window is added to it, a new empty workspace is created below. The World always has room to grow.
- Empty workspaces in the middle (all windows closed) are removed, except the trailing empty one.
- **Named workspaces:** Workspaces can be given names for identification in the overview and for text-based navigation (e.g., jumping to a workspace by typing its name in an app launcher).

## Windows

- Windows are arranged left-to-right within a workspace.
- Default window width: **1/2 monitor width** (one slot).
- Windows can be resized to **full monitor width** (two slots).
- New windows are always appended to the right end of the **current workspace's** strip, regardless of which monitor the spawning app is on.
- A new window receives focus immediately.
- **Minimum size:** If a window refuses to resize to half-width (1 slot), it is auto-promoted to full-width (2 slots).

### Window Closing

When a window is closed, remaining windows **shift left** to fill the gap. Focus moves to the **next window**; if there is no next window, focus moves to the **previous window**.

```
Before (B closes):  AA BB CC DD
After:              AA CC DD         ← focus moves to CC (next)
```

When multiple windows close simultaneously (e.g., an app with several windows quits), all gaps are filled and the strip rearranges in a single animation.

### Window Moving (Reorder)

Windows can be reordered within a workspace. Moving swaps the focused window past its neighbor (jumping over it regardless of size):

```
Super+Shift+Right on B:  AA BB CC CC  →  AA CC CC BB
Super+Shift+Left on B:   AA BB CC CC  →  BB AA CC CC
```

### Window Moving (Between Workspaces)

**Super+Shift+Down / Super+Shift+Up** sends the focused window to the workspace below/above. The window is **inserted before** the window that matches based on the slot index rule (same rule as vertical focus switching).

```
Slot index:  1  2  3  4  5  6

Workspace 0: AA BB CC CC       (B focused, Super+Shift+Down)
Workspace 1: DD DD EE FF

B's first slot = 2, which falls in DD's range (slots 1-2).
B inserts before DD:

Workspace 0: AA CC CC
Workspace 1: BB DD DD EE FF
```

Focus follows the window to the target workspace. If the target workspace is empty, the window becomes the first (and only) window there.

### Window Resizing

**Super+F** toggles a window between half (1 slot) and full (2 slots). Resizing does **not** displace neighbors — the strip simply grows or shrinks:

```
Before (B resizes to full):  AA BB CC CC
After:                       AA BBBB CC CC
```

### Maximize and Fullscreen

- **Maximize** = full width (2 slots). Same as Super+F on a half-width window.
- **Fullscreen** = the window **steps out of the strip** and covers its monitor edge-to-edge with no gaps. The remaining windows rearrange to fill the gap (like a close), and the viewport shrinks to the remaining monitors.

**Multi-monitor example (2 monitors, 4 half-width windows):**

```
Normal (CC focused, viewport shows slots 3-6):
Monitor 1       Monitor 2
┌───────────┐   ┌───────────┐
│  CC  DD   │   │           │
└───────────┘   └───────────┘
  AA BB are off-screen to the left

Fullscreen CC (CC steps out, viewport = 1 monitor):
Monitor 1       Monitor 2
┌───────────┐   ┌───────────┐
│ CCCCCCCCCC│   │  AA  BB   │  ← strip rearranges: AA BB DD
└───────────┘   └───────────┘
                └─viewport──┘
                  DD is off-screen to the right
```

- CC leaves the strip and covers monitor 1 fully.
- The viewport shrinks to the remaining monitor(s).
- Remaining windows (AA BB DD) rearrange; the strip is navigable on the smaller viewport.
- Focus stays on CC.
- Exiting fullscreen: CC returns to its position in the strip, viewport expands, windows rearrange.

**Single monitor:** The fullscreen window covers the entire screen. The strip has zero viewport — other windows are hidden behind it. While fullscreen, Super+Left/Right are no-ops. Super+M (overview) still works and shows the full World. Exiting fullscreen restores the strip.

## Slot Model

Every workspace has a logical **slot grid**. One slot = 1/2 monitor width. A half-width window occupies 1 slot; a full-width window occupies 2 slots.

```
Slot index:  1  2  3  4  5  6

Workspace 0: AA BB CC CC        A=half, B=half, C=full
Workspace 1: DD DD EE FF        D=full, E=half, F=half
Workspace 2: XX YY              X=half, Y=half
```

The slot index of a window is determined by the **first slot it occupies** (its left edge).

## Focus

- Exactly **one window** in the World has focus at any time.
- Focus determines the active window and influences viewport position.

### Focus Indicator

The focused window has a highlight overlay (configurable):

```css
/* Default focus style */
background-color: rgba(124, 252, 0, 0.5);
border: solid 1px rgba(124, 252, 0, 1);
border-radius: 8px; /* configurable */
```

## Gaps

- **10px** between windows (configurable).
- **10px** around edges — between the window strip and screen edges (configurable).
- Gaps are part of the visual layout but not part of the slot model. Slot positions account for gaps when computing pixel coordinates.

## Viewport

- The viewport is the visible area across all connected monitors.
- Multiple monitors form a **single combined viewport**.
- The viewport is a **2D camera** into the World — it has both an X position (horizontal scroll within a workspace) and a Y position (which workspace).
- All navigation is viewport movement: horizontal for window switching, vertical for workspace switching, or both simultaneously.

```
  Monitor 1       Monitor 2
┌───────────┐   ┌───────────┐
│           │   │           │
│  visible  │   │  visible  │
│           │   │           │
└───────────┘   └───────────┘
└──────── combined viewport ────────┘
```

### Viewport Scrolling (Horizontal)

The viewport scrolls in **half-screen (1 slot) increments**. It only moves when the newly focused window is not fully visible.

Example — viewport is 2 monitors wide (4 slots), moving focus from a full-width window A to a half-width window B:

```
Before (A focused):    |AAAAAAAA|BB      viewport shows slots 1-4
After  (B focused):  AA|AAAAAABB|        viewport shifts right by 1 slot
```

The viewport shifts by exactly enough slots to keep the focused window within view, **not** to center it.

### Viewport Movement (Vertical)

Workspace switching is a vertical viewport move. There is no separate "switch workspace then adjust horizontally" — it's a **single simultaneous 2D animation** from the current (x, y) to the target (x', y').

## Keyboard Navigation

| Keybinding | Action |
|---|---|
| Super+Right | Focus next window |
| Super+Left | Focus previous window |
| Super+Down | Switch to workspace below |
| Super+Up | Switch to workspace above |
| Super+F | Toggle focused window half/full |
| Super+Shift+Right | Move focused window right (swap) |
| Super+Shift+Left | Move focused window left (swap) |
| Super+Shift+Down | Move focused window to workspace below |
| Super+Shift+Up | Move focused window to workspace above |
| Super+M | Toggle overview mode |

All keybindings are configurable.

### Boundary Behavior

All navigation is **no-op at boundaries:**
- Super+Left on the leftmost window: no-op.
- Super+Right on the rightmost window: no-op.
- Super+Up on workspace 0: no-op.
- Super+Down on the trailing empty workspace: no-op.
- Super+Shift+Left/Right at strip edges: no-op.
- Super+Shift+Up on workspace 0: no-op.

### Horizontal: Super+Left / Super+Right

- Moves focus to the previous/next window in the current workspace.
- If the newly focused window is already visible: **only focus changes**, viewport stays still.
- If the newly focused window is outside the viewport: viewport **slides horizontally** to bring it into view.

### Vertical: Super+Down / Super+Up

Moves the viewport to the workspace below/above. The target window is determined by the **slot index of the first slot of the focused window**:

```
Slot index:  1  2  3  4  5  6

Workspace 0: AA BB CC CC
Workspace 1: DD DD EE FF
Workspace 2: XX YY

Focus Down:              Focus Up:
  A (slot 1) → D          X (slot 1) → D
  B (slot 2) → D          Y (slot 2) → D
  C (slot 3) → E          D (slot 1) → A
  D (slot 1) → X          E (slot 3) → C
  E (slot 3) → Y          F (slot 4) → C
  F (slot 4) → Y
```

**Rule:** Find the window in the target workspace whose slot range contains the first slot of the source window.

**What the user sees:** A single smooth animation where the viewport moves down (or up) to the target workspace and simultaneously adjusts horizontally if the target window is at a different scroll position. Focus highlight adapts to the target window's position and size during the animation.

**Edge case — empty workspace:** Super+Down into the trailing empty workspace moves the viewport there but nothing gets focus. The user sees an empty desktop. Super+Up returns to the previous workspace.

### Move Window: Super+Shift+Left / Super+Shift+Right

Swaps the focused window with its neighbor (jumping past it regardless of size). The window keeps focus. Viewport adjusts if needed.

```
Before (B focused, Super+Shift+Right):  AA [BB] CC CC
After:                                  AA CC CC [BB]
```

## Mouse Interaction

| Input | Action |
|---|---|
| Click on window | Focus that window |
| Super+Drag | Move (reorder) window |
| Super+Scroll Down | Same as Super+Right (focus next) |
| Super+Scroll Up | Same as Super+Left (focus previous) |

## Overview Mode

**Super+M** toggles overview mode — a zoomed-out bird's-eye view of the entire World.

```
┌─────────────────────────────────────────────┐
│                                             │
│  W0: [A] [B] [CCCC] [D]                    │
│                                             │
│  W1: [DDDD] [E] [F]                        │
│                                             │
│  W2: [X] [Y]                               │
│                                             │
│  W3: (empty)                                │
│                                             │
└─────────────────────────────────────────────┘
         ↑ current focus highlighted
```

- All workspaces and their windows are shown as **scaled-down thumbnails**. Named workspaces display their names.
- The currently focused window is highlighted with the focus indicator.
- **Keyboard navigation:** Arrow keys move focus between windows across the 2D grid.
- **Click** on any thumbnail to jump to that window.
- Pressing **Enter** or **Super+M** again exits overview and animates the viewport to the selected window.
- Pressing **Escape** exits overview and returns to the previously focused window (no change).
- Overview works even when a window is fullscreen — the full World is visible.

Overview provides spatial orientation — the user can see where all their windows are across the World and jump to any of them.

## Text-Based Navigation

Workspaces can be navigated by name via an external app launcher. Typing a workspace name jumps directly to it. This is complementary to the spatial overview — overview is for visual orientation, text navigation is for fast targeted access.

## Animation

**All transitions are smoothly animated.** Every navigation action is a viewport move through the World:

| Action | Viewport motion | What changes |
|---|---|---|
| Super+Right (visible) | None | Focus highlight moves |
| Super+Right (off-screen) | Slide right | Focus + viewport |
| Super+Down | Slide down (+ horizontal adjust) | Workspace + focus + viewport |
| Super+Up | Slide up (+ horizontal adjust) | Workspace + focus + viewport |
| New window opens | Possibly slide right | Focus + viewport if needed |
| Window closes | Windows shift left | Gap fills, focus moves to neighbor |
| Super+F (resize) | Possibly slide | Strip grows/shrinks |
| Super+Shift+Right (move) | Possibly slide | Windows swap positions |
| Super+M (overview) | Zoom out | All workspaces visible |

Smooth animation is essential — the user must be able to visually track the viewport moving through the World to maintain spatial orientation.

## Configuration

All settings are user-configurable:

| Setting | Default | Description |
|---|---|---|
| Gap size | 10px | Space between windows and screen edges |
| Focus background color | rgba(124, 252, 0, 0.5) | Focus overlay fill |
| Focus border color | rgba(124, 252, 0, 1) | Focus overlay border |
| Focus border radius | 8px | Rounded corners of focus overlay |
| All keybindings | See table above | Every shortcut is rebindable |
