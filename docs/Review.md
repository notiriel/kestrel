# PaperFlow Code Review (2026-02-17)

## Overall Rating: 7/10

The architecture is genuinely well-designed — hexagonal architecture is properly enforced with clean domain/adapter separation, the domain is fully testable, and the test suite is solid (146 tests, all passing). This is above-average for a GNOME Shell extension. The issues that hold it back from an 8+ are concentrated in two areas: significant DRY violations and an overweight controller/CloneAdapter.

---

## Hexagonal Architecture: 9/10

### Strengths

- The domain/adapter boundary is real and enforced. Domain modules have zero `gi://` imports — verified across all 9 domain files. The architecture test (`arch/domain-boundary.test.ts`) statically enforces that adapters never assemble world state directly.
- Data flows one direction: GNOME signals -> domain -> layout -> adapters. The domain is always the source of truth.
- Port interfaces exist in `src/ports/` (10 files) using `unknown` for GNOME types to avoid `gi://` leakage. Only one port has any import (`keybinding-port.ts` — type-only `Gio` import, acceptable).
- `WorldUpdate { world, layout }` is a clean contract between domain and adapters.
- Adapters are genuine translators: `WindowEventAdapter` translates GNOME signals to domain calls, `CloneAdapter` translates layout state to Clutter operations.

### Weaknesses

- **Not all collaborators are injectable.** The controller directly instantiates `ReconciliationGuard`, `OverviewHandler`, `SettlementRetry`, and `NavigationHandler`. Only port-based adapters are injectable via `ControllerPorts`.
- **Domain logic leaks into the adapter layer.** `_findWorkspaceIdForWindow()` and `_wsIdAt()` in the controller are domain traversal functions that belong in `domain/world.ts`.
- **ClonePort is a fat interface.** 14 methods spanning clone lifecycle, layout rendering, scrolling, and overview mode. Violates interface segregation.

---

## Cohesion & Coupling: 6.5/10

### Cohesion Issues

- **CloneAdapter (~560 lines)** manages tiled clone lifecycle, float clone lifecycle (via delegation to FloatCloneManager), layout rendering, focus indicator, and overview animations. Should be split into 3-4 focused classes.
- **Controller (~470 lines)** mixes composition-root duties with domain logic (workspace lookups, scroll sync) and debug serialization. Every handler method repeats the same boilerplate: null-check world, null-check guard, call domain, apply layout, focus window.
- **world.ts (386 lines)** is a god module — 43% of all domain code. Handles workspace creation, window management, focus, viewport, fullscreen, and restoration.

### Cohesion Successes

- Small adapters are excellent: `FocusAdapter` (56 lines), `MonitorAdapter` (41 lines), `ShellAdapter` (66 lines), `StatePersistence` (91 lines) — each has one clear job.
- Domain modules like `navigation.ts`, `workspace.ts`, `window-operations.ts`, `overview.ts` each do one thing.

### Coupling Issues

- **Temporal coupling in adapter orchestration.** The controller must call clone adapter methods in a specific sequence (e.g., `moveCloneToWorkspace` before `syncWorkspaces`, `setScrollForWorkspace` before `applyLayout`). This ordering is implicit and fragile.
- **NavigationHandler depends on ClonePort details.** Calls `setScrollForWorkspace`, `moveCloneToWorkspace`, `syncWorkspaces` in precise sequences — knows too much about clone adapter internals.
- **Handler closure dependencies.** All three handlers (`OverviewHandler`, `NavigationHandler`, `SettlementRetry`) accept deps objects with `getWorld(): World | null`, `getCloneAdapter(): Port | null`, etc. Everything is nullable with no lifecycle contract.

---

## DRY: 5/10

This is the weakest area. Significant violations:

### Domain Layer

1. **Navigation direction duplication** — `focusLeft`/`focusRight` are near-identical pairs differing by `windowBefore` vs `windowAfter`. Same for `focusUp`/`focusDown` (+1 vs -1). Same for `moveLeft`/`moveRight` and `moveUp`/`moveDown`. 4 pairs of ~identical functions across `navigation.ts` and `window-operations.ts`.

2. **Guard clause duplication** — `if (!world.focusedWindow) return buildUpdate(world)` appears 7 times (2x in navigation.ts, 5x in window-operations.ts).

3. **Update pattern duplication** — `buildUpdate(adjustViewport(newWorld))` appears 13 times across navigation.ts, window-operations.ts, and world.ts.

4. **Workspace maintenance duplication** — `pruneEmptyWorkspaces + ensureTrailingEmpty` repeated 3 times in world.ts and window-operations.ts.

5. **Slot iteration duplication** — `workspace.ts:slotIndexOf` and `workspace.ts:windowAtSlot` both iterate with identical `let slot = 1; for (const w) { ... slot += w.slotSpan }` loop structure.

6. **Window search across workspaces** — The pattern `for (i in workspaces) { find window by id }` appears 3 times in `world.ts`.

7. **`computeLayout` / `computeLayoutForWorkspace`** (layout.ts) — The layout computation loop is duplicated.

### Adapter Layer

8. **`_findWorkspaceIdForWindow()`** — Duplicated identically in `controller.ts` and `navigation-handler.ts`. Should live in the domain.

9. **Clone allocation logic** — `CloneAdapter._allocateClone` and `FloatCloneManager._syncFloatClone` share ~80% identical logic for computing clone geometry from frame/buffer rects.

10. **Signal handler boilerplate** — The pattern `connect('signal', () => { try { handler() } catch (e) { console.error(...) } })` repeated across 8 adapters with 79 console.log/error/warn calls using manual `[PaperFlow]` prefix.

11. **Keybinding save/restore** (keybinding-adapter.ts) — "get settings, save strv, set empty" / "restore" repeated 3 times for Mutter, Shell, and WM schemas.

12. **Actor opacity setting** — `try { metaWindow.get_compositor_private()?.set_opacity(N) } catch {}` duplicated 6 times in `window-adapter.ts`.

---

## SOLID: 6.5/10

### S — Single Responsibility: 5/10

- **CloneAdapter** — 560 lines, 5 responsibilities. Biggest SRP violation.
- **Controller** — 470 lines. Composition root + event routing + state management + domain logic.
- **world.ts** — 386 lines, 20+ exported functions. Handles too many domain concerns.
- Domain modules like `navigation.ts`, `workspace.ts`, `overview.ts` are well-factored.

### O — Open/Closed: 7/10

- The domain is open for extension — new functions take/return `World`/`WorldUpdate` without modifying existing code.
- Hardcoded constants (`ANIMATION_DURATION`, `SETTLEMENT_DELAYS`, conflict extension list) require code changes to modify.
- Callback-based adapter wiring (`KeybindingCallbacks`, `WindowEventCallbacks`) is a reasonable extension point.

### L — Liskov Substitution: 8/10

- Mostly N/A — no inheritance hierarchy (composition throughout, which is good).
- Immutable value types and branded types provide good substitutability guarantees.

### I — Interface Segregation: 6/10

- **ClonePort** has 14 methods spanning 4 concerns (lifecycle, rendering, overview, float). Should be split into `CloneLifecyclePort`, `CloneRenderPort`, `OverviewRenderPort`.
- **WindowEventCallbacks** has 6 required callbacks — tiled and float events are bundled together.
- **WindowPort** and **ClonePort** overlap: both have `applyLayout()` and `setWindowFullscreen()`.

### D — Dependency Inversion: 7.5/10

- Domain layer is perfectly clean — depends on nothing external.
- Port interfaces exist and are used for all main adapters (9 adapters implement ports).
- But `ReconciliationGuard`, `OverviewHandler`, `SettlementRetry`, `NavigationHandler` are directly instantiated — not injectable.
- Handler deps use closure-based getters instead of stable interfaces — testing requires mocking functions.

---

## Test Quality

### Domain Tests: 9/10

- 100% module coverage (9 domain modules, all tested).
- 146 tests total, all passing, 2289 lines of test code.
- Tests are behavior-focused (what should happen, not how).
- Good edge cases: empty workspaces, double-width windows, slot targeting, round-trip navigation.
- Immutability verification — tests confirm original state is not mutated.
- The textual model notation (`<[B] C>`) for describing world state is clear and readable.
- Architectural boundary test (`domain-boundary.test.ts`) statically prevents domain violations.

### Adapter Tests: 5/10

- 3 adapter test files (controller, navigation-handler, overview-handler) with 43 tests.
- **CloneAdapter** (most complex, most bug-prone) is untested.
- **WindowAdapter** positioning logic untested.
- **SettlementRetry** (critical for Wayland async) untested.
- Mock infrastructure is solid — `mock-ports.ts` provides factory functions for all 9 port mocks.
- Reasonable pragmatism: concrete adapters wrap GNOME Shell APIs that require a live runtime.

---

## Biggest Problems (Ranked)

### 1. Pervasive DRY violations across domain and adapter layers

13 duplicated `buildUpdate(adjustViewport(...))` calls, 7 identical guard clauses, 4 pairs of near-identical directional functions in navigation/movement, ~80% duplicate clone allocation logic, 6x actor opacity pattern, tripled keybinding save/restore. This is the highest-ROI fix — a handful of utility extractions would eliminate hundreds of lines and reduce maintenance risk.

### 2. CloneAdapter is a god object

560 lines, 5 distinct responsibilities (tiled clone lifecycle, float delegation, layout rendering, focus indicator, overview animations), 14+ public methods. Splitting into focused classes would make each piece testable and maintainable.

### 3. Controller god class with leaked domain logic

470 lines mixing composition-root duties with domain traversal (`_findWorkspaceIdForWindow`, `_wsIdAt`), event handling boilerplate, and scroll sync. Every handler repeats null-check → domain call → apply layout → focus window.

### 4. ClonePort is a fat interface (ISP violation)

14 methods spanning lifecycle, rendering, scrolling, and overview. Forces any implementation or mock to implement everything. Should be split into 3 focused interfaces.

### 5. world.ts is a god module

386 lines (43% of all domain code) with 20+ exported functions handling workspace creation, window management, focus, viewport, fullscreen, and restoration. Should be split into focused sub-modules.

### 6. Temporal coupling in adapter orchestration

Clone adapter methods must be called in precise sequences. A `reconcile(oldWorld, newWorld)` pattern would encapsulate ordering and make the contract explicit.

### 7. Handler dependency injection is fragile

Closure-based `getWorld(): World | null` / `getCloneAdapter(): Port | null` pattern means everything is nullable, there's no lifecycle contract, and testing requires mocking functions instead of objects. A stable `WorldStore` reference with non-null adapter references would be cleaner.

---

## What's Good

- The domain layer is genuinely excellent: pure, immutable, well-tested, ~900 lines for all business logic.
- Hexagonal architecture boundary is real and enforced — both by convention (zero `gi://` imports) and by test (`domain-boundary.test.ts`).
- Branded types (`WindowId`, `WorkspaceId`) prevent accidental ID mixing.
- Robust error handling — every signal handler wrapped in try/catch prevents GNOME Shell crashes.
- Safe window proxy (`safe-window.ts`) is a smart defensive pattern for dealing with dead GObjects.
- `ReconciliationGuard` prevents infinite re-entrant adapter calls — a real risk in signal-driven architectures.
- Resource cleanup is thorough — every adapter has `destroy()`, controller tears down in reverse initialization order.
- `safeDisconnect` utility prevents common GObject signal crashes (used by 8 adapters).
- Signal timeout IDs are tracked and cleaned up (`WindowEventAdapter`, `SettlementRetry`).
- Port interfaces use `unknown` for GNOME types, keeping the boundary clean.
- Small adapters (`FocusAdapter`, `MonitorAdapter`, `ShellAdapter`, `StatePersistence`) are excellently focused.

---

## Scorecard

| Area | Score | Notes |
|------|-------|-------|
| Hexagonal Architecture | 9/10 | Real boundary, enforced by tests. Fat ClonePort is the weak spot. |
| Cohesion | 6.5/10 | Domain is great. CloneAdapter/Controller/world.ts carry too much. |
| Coupling | 7/10 | Generally low. Temporal coupling and closure deps are concerns. |
| DRY | 5/10 | Weakest area. 13x update pattern, 7x guard clause, 4 near-identical pairs. |
| SRP | 5/10 | CloneAdapter, controller, and world.ts carry too many responsibilities. |
| OCP | 7/10 | Domain is extensible. Hardcoded constants limit adapter extensibility. |
| LSP | 8/10 | N/A mostly — composition over inheritance throughout. |
| ISP | 6/10 | ClonePort is fat (14 methods). Callback interfaces are coarse-grained. |
| DIP | 7.5/10 | Ports exist and work well. Not all collaborators injectable. |
| Domain Tests | 9/10 | Thorough, behavioral, good edge cases, boundary enforcement. |
| Adapter Tests | 5/10 | 3 of 16 adapters tested. Mock infrastructure is solid. |
| **Overall** | **7/10** | Strong foundation, real architectural discipline. Needs DRY cleanup and SRP refactoring. |
