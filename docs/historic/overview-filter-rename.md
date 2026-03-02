# Overview Filter & Rename — Interaction Design

## Context

Currently, workspace switching-by-name and renaming use ULauncher via a virtual keyboard approach that has timing and modifier issues on Wayland. We're replacing this with native interactions built into the existing overview mode (Super+M).

---

## 1. Type-to-Filter (in overview)

### Entry
User opens overview (Super+M), then starts typing any printable character. No special activation — typing immediately begins filtering.

### Behavior
- Each character appended narrows the visible workspaces using **fuzzy matching** on workspace names. Matching workspaces are **sorted by score** (best match first), with a tiny positional tiebreaker `(1 - index/len) * 0.1` to preserve original order among equal scores.

  Fuzzy matching algorithm (sequential character matching with bonuses):
  - +10 for matching the first character of the target
  - +8 for consecutive character matches
  - +5 for matches after word boundaries (`_`, `-`, ` `, `.`) or camelCase transitions
  - +1 per matched character
  - -0.5 penalty per excess character in target vs query

- **Non-matching workspaces hide and matching ones collapse together** — no empty gaps. The overview rescales/recenters to fit the visible set.

- If the currently focused workspace is filtered out, focus jumps to the first window of the top-ranked matching workspace.

- **Arrow keys behave normally during filtering** — they change focus between windows and workspaces as usual (Left/Right between windows, Up/Down between workspaces), but constrained to the visible filtered set. This lets the user filter down, then navigate to the exact window they want.

### Filter indicator
A search input component at the top center of the screen: a rounded rectangle with a magnifier icon and the typed characters. Visible only while the filter is non-empty.

### Clearing
- **Backspace** removes the last character (if filter becomes empty, all workspaces reappear)
- **Escape (first press)** clears the entire filter and restores all workspaces
- **Escape (second press)** cancels overview (restores pre-overview focus/viewport)

### Confirming
- **Enter** confirms — exits overview on the currently focused (filtered) workspace
- **Click** on a workspace window confirms that window

### Example flow
```
User has 5 workspaces: "Frontend", "Backend", "DevOps", "Design", "Docs"

1. Super+M          → overview opens, all 5 visible
2. Types "d"        → "DevOps", "Design", "Docs" visible (ranked by score,
                       collapsed, rescaled), focus on first window of "DevOps"
3. Types "o"        → filter is "do" → "Docs", "DevOps" visible, in this
                       order because "Docs" scores higher. Focus on first
                       window of "Docs".
4. Down arrow       → focus moves to first window of "DevOps"
5. Enter            → exits overview, now on "DevOps" workspace
```

---

## 2. Workspace Rename (F2 in overview)

### Entry
While overview is active, user presses **F2**. An inline text entry appears over the focused workspace's name label.

### Behavior
- The entry is pre-filled with the current workspace name, fully selected
- User types a new name (full text editing: cursor, selection, backspace all work via St.Entry)
- While the rename entry is active, typing does **not** trigger filtering

### Confirming
- **Enter** saves the new name and closes the entry. The workspace label updates immediately.
- **Escape** cancels — discards changes, closes the entry, returns to normal overview

### After rename
User stays in overview and can continue navigating, filtering, or pressing Enter to exit.

### Example flow
```
1. Super+M          → overview opens
2. Down arrow       → focus moves to "Workspace 2"
3. F2               → rename entry appears with "Workspace 2" selected
4. Types "Backend"  → entry now shows "Backend"
5. Enter            → workspace renamed, label updates, back to normal overview
6. Enter            → exits overview on "Backend" workspace
```

---

## 3. What Gets Removed

- `LauncherAdapter` and all ULauncher integration (virtual keyboard, DBus toggle, modifier polling)
- `launch-workspace-switcher` keybinding (Super+<)
- `launch-workspace-rename` keybinding (Super+Shift+<)
- ULauncher dependency for workspace operations

---

## 4. Keybinding Summary

| Context | Key | Action |
|---------|-----|--------|
| Normal mode | Super+M | Enter overview |
| Overview | Any printable key | Append to filter |
| Overview | Backspace | Remove last filter character |
| Overview | Escape | Clear filter (or cancel overview if filter empty) |
| Overview | Enter | Confirm — exit overview on focused workspace |
| Overview | Arrows | Navigate normally (constrained to filtered workspaces) |
| Overview | F2 | Start rename on focused workspace |
| Rename active | Enter | Save name |
| Rename active | Escape | Cancel rename |

---

## 5. Edge Cases

- **Zero filter matches**: All workspaces hidden, filter indicator stays visible. User can backspace or Escape to recover.
- **Empty workspace name**: Renaming to empty string clears the name (reverts to default "Workspace N").
- **Rename while filtered**: Allowed — renames the focused workspace. Filter remains active after rename completes.
- **Click during filter**: Hit-test uses filtered/collapsed positions, not original positions.
