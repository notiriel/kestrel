# Domain Logic Leakage in OverviewHandler

**Found:** 2026-02-28
**File:** `src/adapters/overview-handler.ts`
**Status:** Open

## Summary

The `OverviewHandler` adapter contains domain logic that violates the hexagonal architecture rule: "Adapters never compute layout, focus, or workspace state." All findings are in the same file — the rest of the adapters are clean.

## Findings

### 1. Overview geometry calculations (Critical)

**Lines:** 596-631

Three pure functions compute layout dimensions for the overview zoom-out view:

- `_computeTransform(world, numWorkspaces)` — calculates scale factors and pixel offsets
- `_computeMaxWorkspaceWidth(world)` — iterates workspaces to find the widest one
- `_computeWorkspaceWidth(world, ws)` — computes pixel width from slot spans, gaps, and edge gaps

These are deterministic functions of world state with no GNOME dependencies. They should live in a domain module (e.g. `src/domain/overview-geometry.ts`) and be testable with Vitest.

### 2. Filtered workspace navigation (Moderate)

**Lines:** 142-166

- `_navigateFilteredVertical(world, direction)` — decides whether to use filtered or standard navigation
- `_computeFilteredTarget(currentPos, direction)` — computes which filtered workspace index to navigate to

This is workspace ordering and focus decision logic — a domain concern. The adapter should maintain filter text as UI state but delegate navigation decisions to the domain.

### 3. Hit-testing geometry (Moderate)

**Lines:** 358-403

- `_hitTest(x, y)` — entry point, reverses overview transform to find workspace + window
- `_resolveWorkspaceIndex(visualSlot)` — maps visual row to workspace index
- `_hitTestWindows(ws, localX, localY)` — finds which window a coordinate falls on
- `_isInsideWindow(win, x, y, ws)` — bounds check using slot spans and layout config

These reverse-map screen coordinates to domain entities using domain concepts (monitor dimensions, slot widths, gap sizes). A domain function like `hitTestOverview(world, scale, x, y) → WindowId | null` would be testable without GNOME.

## What's Clean

All other adapters follow the architecture correctly:

- **WindowAdapter** — applies positions, never computes them
- **NavigationHandler** — delegates to domain `focusRight`/`focusLeft`/etc.
- **WindowLifecycleHandler** — calls domain `addWindow`/`removeWindow`
- **CloneAdapter** — pure rendering
- **FocusAdapter** — only activates windows
- **SettlementRetry** — calls domain `computeLayout` and applies results

## Proposed Fix

1. Create `src/domain/overview-geometry.ts` with pure functions for transform computation, workspace width, and hit-testing
2. Create corresponding Vitest tests
3. Have `OverviewHandler` call domain functions and apply results
4. Move filtered navigation logic to domain (new function or extend `navigation.ts`)
