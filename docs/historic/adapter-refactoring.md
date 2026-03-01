# Adapter Refactoring Design

Enforce complexity <= 5 and LOC <= 20 per function across all adapter files. This document describes the architectural changes needed to get there.

## Current state

577 adapter functions measured. 74 violate the complexity cap, 86 violate the LOC cap. The violations cluster into a small number of repeating patterns rooted in two architectural failures:

1. **Domain logic leaked into adapters** — filtering, state machines, layout computation, and response parsing live in adapter code instead of the pure domain core.
2. **Monolithic UI construction** — widget trees, signal wiring, animation choreography, and state management are mixed in single methods instead of being composed from small, single-purpose pieces.

The window/layout/navigation domain is clean. The notification and overview subsystems are where almost all violations live.

## Violation patterns

### P1: Monolithic UI construction

**Where:** `question-card.ts`, `permission-card.ts`, `notification-focus-mode.ts`, `help-overlay-adapter.ts`, `card-base.ts`

Constructors and `_init()` methods build entire widget trees inline — 50-100 LOC of nested `St.BoxLayout`, style strings, label creation, and signal connections in a single method.

**Fix:** Introduce a `src/ui-components/` layer for reusable widget builders. UI components are allowed a relaxed LOC limit (e.g., 40) but must still respect the complexity cap of 5. Each card type delegates to small factory functions in this layer: `buildHeader()`, `buildOptionList()`, `buildTimeoutBar()`, `buildActionButtons()`. Each factory returns a widget subtree. The adapter constructor calls `build()` and connects signals, nothing more.

The `ui-components` layer sits between adapters and GNOME Shell — it may import `gi://` (St, Clutter) but must not import domain types or adapter state. It is purely presentational.

### P2: Conditional branching where polymorphism belongs

**Where:** `notification-focus-mode.ts` (C=25 in `_handleQuestionKeyPress`), `notification-overlay-adapter.ts` (C=20 in `_relayout`), `question-card.ts` (C=14 in key handling)

Methods branch on card type (`permission` vs `notification` vs `question`) or card state (`isSubmitPage`, `multiSelect`, `expanded`) using long if/else chains.

**Fix:** Define a `CardBehavior` interface with methods like `handleKeyPress(key)`, `relayout(position, scale)`, `getPreferredHeight()`. Each card type implements this interface. The focus mode and overlay adapter dispatch to the behavior instead of branching on type. This converts N*M conditional branches (N types x M operations) into N polymorphic implementations.

### P3: Duplicated state across rendering contexts

**Where:** `notification-focus-mode.ts`, `question-card.ts`

The same logical notification exists as two independent widget instances (overlay card and focus-mode card). State changes in one must be manually synced to the other via `syncState()`.

**Fix:** Separate card state from card rendering. The `CardModel` (current page, selected answers, timeout remaining) lives in the domain as part of the `Notification` type from P4. Both the overlay card and focus-mode card read from the same domain notification state. When one context mutates the model via a domain operation, the other re-renders from it. No sync step needed because the domain is the single source of truth.

### P4: Notification lifecycle owned by adapters

**Where:** `notification-coordinator.ts`, `notification-overlay-adapter.ts`, `notification-focus-mode.ts`, `dbus-service.ts`

Notifications are created in adapters, queued in adapters, responded to in adapters, and expired in adapters. The domain has no awareness of notification state. The coordinator wires four adapters together through 10+ callback functions.

**Fix:** Move notification lifecycle into the domain. Add to the domain:

- A `Notification` type with a state machine: `pending` -> `responded` / `dismissed` / `expired`
- A `NotificationId` branded type
- Card interaction state as part of `Notification`: current page, selected answers, timeout remaining (enables P3)
- Operations: `addNotification()`, `respondToNotification()`, `dismissNotification()`, `navigateQuestion()`, `selectOption()`
- State on `World`: `notifications: Map<NotificationId, Notification>`

The domain owns the notification queue, state transitions, response validation, and question interaction state. Adapters become thin: DBus adapter calls `addNotification()`, card adapter calls `respondToNotification()`, overlay adapter reads `world.notifications` and renders. The coordinator simplifies to a wiring class with no logic. This also brings notification logic under domain test coverage.

### P5: Overview filter and rename logic in adapters

**Where:** `overview-handler.ts` (C=19 in `_applyFilter`, C=13 in enter/exit), `overview-input-adapter.ts` (C=23 in `_handleKeyPress`), `clone-adapter.ts` (C=11 in `applyOverviewFilter`)

Filter text, visible workspace computation, rename state, and key-to-action routing all live in adapter code. The domain has `enterOverview()`/`exitOverview()` but nothing for filter state.

**Fix:** Move overview interaction state into the domain:

- Add to `World`: `overview: { active, filterText, renaming, focusedIndex }`
- Add domain operations: `setOverviewFilter(text)` -> computes visible indices via fuzzy match (already in domain as `fuzzyMatch()`), `startRename()`, `commitRename(name)`, `navigateOverview(direction)`
- The adapter's key handler becomes a thin dispatcher: read key, call domain operation, apply returned layout. No filtering logic, no rename state tracking, no index computation.

This brings overview interaction logic under domain test coverage.

### P6: Async animation choreography

**Where:** `notification-focus-mode.ts` (`_exit` LOC=84), `clone-adapter.ts` (multiple 50+ LOC methods), `window-adapter.ts` (`applyLayout` LOC=60)

Methods mix animation setup, deferred cleanup (`GLib.idle_add`), try/catch at every level, and state nullification in a single flow.

**Fix:** Decompose into three phases per operation: **prepare** (compute targets, capture state), **animate** (call `ease()` with targets), **cleanup** (run in `onComplete` or on next frame). Each phase is a separate method. Use a small `AnimationSequence` helper that chains prepare -> animate -> cleanup and handles try/catch once at the boundary, not at every level.

### P7: applyLayout complexity in window-adapter and clone-adapter

**Where:** `window-adapter.ts` (C=17 in `applyLayout`), `clone-adapter.ts` (C=14 in `applyLayout`, C=13 in `_updateWorkspaceStructure`)

These methods iterate over layout state, diff against tracked state, compute compensations (oversized frames), and minimize/show windows — all in one method.

**Fix:** Move the diff/compensation logic into the domain. The adapter should:

1. `diffLayout(current, target)` -> produces a list of `LayoutChange` operations (move, resize, show, hide, minimize) — pure function in domain, fully testable
2. `applyChanges(changes)` -> executes each change in the adapter

The diff logic and oversized-frame compensation become domain-tested pure functions. The apply step is a simple loop over changes with no branching.

## New layer: `src/ui-components/`

A new presentational layer for reusable GNOME Shell widget builders.

**Rules:**
- May import `gi://` (St, Clutter, GObject)
- Must NOT import domain types or adapter state
- Relaxed LOC limit: 40 lines per function (vs 20 for adapters)
- Same complexity limit: 5 (no branching logic in UI builders)
- Each function takes plain data (strings, numbers, config objects) and returns a widget subtree
- No signal handling — callers connect signals after receiving the widget

**Contents:** Card skeleton builders, label factories, button row factories, layout helpers. Extracted from P1 refactoring of card and overlay files.

## Execution order

The refactorings have dependencies. Recommended order:

| Phase | Refactoring | Rationale |
|-------|------------|-----------|
| 1 | P1: UI component extraction | Mechanical, introduces `ui-components` layer, high violation count reduction |
| 2 | P6: Animation decomposition | Mechanical, reduces LOC violations in clone/window adapters |
| 3 | P7: Layout diff/apply to domain | Moves logic to testable domain, reduces clone/window adapter complexity |
| 4 | P4: Notification domain model | Architectural, enables P2 and P3, increases test coverage |
| 5 | P5: Overview domain model | Architectural, reduces overview adapter complexity, increases test coverage |
| 6 | P2: Card polymorphism | Requires P4's domain model, eliminates type-branching |
| 7 | P3: Shared card model via domain | Requires P4, eliminates state duplication using domain as source of truth |

Phases 1-3 are mechanical and can be done file-by-file without cross-cutting changes. Phases 4-7 are architectural and change the domain boundary, bringing significant logic under domain test coverage.

## Files by violation count

For prioritization within each phase:

| File | Complexity violations | LOC violations | Phase |
|------|----------------------|----------------|-------|
| notification-focus-mode.ts | 10 | 8 | 4, 6, 7 |
| question-card.ts | 5 | 9 | 1, 2, 6 |
| clone-adapter.ts | 7 | 8 | 2, 3, 7 |
| overview-handler.ts | 9 | 5 | 5 |
| notification-overlay-adapter.ts | 6 | 6 | 4, 6 |
| overview-input-adapter.ts | 3 | 4 | 5 |
| window-event-adapter.ts | 4 | 3 | 2 |
| window-adapter.ts | 4 | 2 | 3, 7 |
| navigation-handler.ts | 2 | 1 | 5 |
| window-lifecycle-handler.ts | 4 | 1 | 1 |
| state-persistence.ts | 1 | 1 | 1 |
| all others | 1-2 each | 1-2 each | 1 |

## Constraints

- No behavioral changes. Every refactoring preserves existing behavior.
- Adapter tests must continue to pass throughout. New domain logic gets new domain tests.
- One phase at a time. Each phase results in a working build with `make install` passing.
- The eslint rules are set to `error` from the start. Each phase must bring its target files under the threshold or use `// eslint-disable-next-line` with a TODO comment referencing the next phase that will fix it.
