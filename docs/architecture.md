# Architecture

Visual guide to Kestrel's internals. For product design see [design.md](design.md), for technical decisions see [solution-design.md](solution-design.md).

---

## 1. Layer Overview

```mermaid
graph LR

    subgraph GNOME["GNOME Shell / Mutter"]
        Meta["Meta (windows, display)"]
        Clutter["Clutter (actors, input)"]
        St["St (widgets, UI)"]
        Shell["Shell (keybindings)"]
    end

    subgraph Adapters["Adapters Layer — src/adapters/"]
        WinEvent["window-event-adapter"]
        Clone["clone-adapter"]
        WinAdapt["window-adapter"]
        Focus["focus-adapter"]
        Monitor["monitor-adapter"]
        Keybind["keybinding-adapter"]
        OvHandler["overview-handler"]
        NavHandler["navigation-handler"]
        Settlement["settlement-retry"]
        OvInput["overview-input-adapter"]
        Persist["state-persistence"]
        DBus["dbus-service"]
        Notif["notification-overlay-adapter"]
        Panel["panel-indicator-adapter"]
        FloatClone["float-clone-manager"]
        StatusOv["status-overlay-adapter"]
        HelpOv["help-overlay-adapter"]
        NotifFocus["notification-focus-mode"]
        Conflict["conflict-detector"]
        Recon["reconciliation-guard"]
        ShellAdapt["shell-adapter"]
        SafeWin["safe-window"]
        SigUtil["signal-utils"]
    end

    subgraph Ports["Ports Layer — src/ports/"]
        CP["ClonePort"]
        WP["WindowPort"]
        FP["FocusPort"]
        MP["MonitorPort"]
        SP["ShellPort"]
        KP["KeybindingPort"]
        WEP["WindowEventPort"]
        SPP["StatePersistencePort"]
        NP["NotificationPort"]
        PIP["PanelIndicatorPort"]
        CDP["ConflictDetectorPort"]
    end

    subgraph Domain["Domain Core — src/domain/"]
        World["world.ts\n(aggregate root)"]
        Nav["navigation.ts"]
        WinOps["window-operations.ts"]
        Layout["layout.ts"]
        Overview["overview.ts"]
        WS["workspace.ts"]
        Win["window.ts"]
        VP["viewport.ts"]
        Types["types.ts"]
        NTypes["notification-types.ts"]
    end

    Ext["extension.ts\n(composition root)"]

    Ext --> CP & WP & FP & MP & SP & KP & WEP & SPP & CDP
    Ext --> World & Nav & WinOps & Layout & Overview

    CP -.-> Types
    WP -.-> Types
    FP -.-> Types
    MP -.-> Types
    WEP -.-> Types

    CP -->|implemented by| Clone
    WP -->|implemented by| WinAdapt
    FP -->|implemented by| Focus
    MP -->|implemented by| Monitor
    SP -->|implemented by| ShellAdapt
    KP -->|implemented by| Keybind
    WEP -->|implemented by| WinEvent
    SPP -->|implemented by| Persist
    NP -->|implemented by| Notif
    PIP -->|implemented by| Panel
    CDP -->|implemented by| Conflict

    Clone --> Meta & Clutter
    WinAdapt --> Meta
    Focus --> Meta & Shell
    Monitor --> Meta
    Keybind --> Meta & Shell
    WinEvent --> Meta
    OvInput --> Clutter & St & Shell
    Notif --> St & Clutter
    Panel --> St & Clutter

    style Domain fill:#e8f5e9,stroke:#4caf50
    style Ports fill:#e3f2fd,stroke:#2196f3
    style Adapters fill:#fff3e0,stroke:#ff9800
    style GNOME fill:#fce4ec,stroke:#e91e63
```

**Import rule:** Domain and Ports never import `gi://` modules. All GNOME interaction flows through Adapters.

---

## 2. Module Dependency Map

### Domain internals

```mermaid
graph LR
    Types["types.ts"]
    VP["viewport.ts"]
    Win["window.ts"]
    WS["workspace.ts"]
    Layout["layout.ts"]
    World["world.ts"]
    Nav["navigation.ts"]
    WinOps["window-operations.ts"]
    Overview["overview.ts"]
    NTypes["notification-types.ts"]

    Win --> Types
    WS --> Types & Win
    Layout --> Types & World & WS
    World --> Types & Win & WS & VP & Layout
    Nav --> Types & World & WS
    WinOps --> Types & World & WS
    Overview --> Types & World

    style Types fill:#c8e6c9
    style World fill:#a5d6a7,stroke:#388e3c,stroke-width:2px
```

`world.ts` is the aggregate root — all state mutations go through it. `navigation.ts`, `window-operations.ts`, and `overview.ts` are operation modules that take a `World` and return a `WorldUpdate`.

### Extension wiring

```mermaid
graph LR
    Ext["extension.ts"]

    subgraph Handlers["Extracted Handlers"]
        NavH["navigation-handler"]
        OvH["overview-handler"]
        WinLC["window-lifecycle-handler"]
        Settle["settlement-retry"]
        NotifCoord["notification-coordinator"]
    end

    subgraph AdapterImpls["Adapter Implementations"]
        Clone["clone-adapter"]
        WinA["window-adapter"]
        FocusA["focus-adapter"]
        MonA["monitor-adapter"]
        KeyA["keybinding-adapter"]
        WinEA["window-event-adapter"]
        ShellA["shell-adapter"]
        OvIA["overview-input-adapter"]
        ConflA["conflict-detector"]
        PersA["state-persistence"]
        PanelA["panel-indicator-adapter"]
        NotifA["notification-overlay-adapter"]
        DBusA["dbus-service"]
        StatusA["status-overlay-adapter"]
        NotifFM["notification-focus-mode"]
        HelpA["help-overlay-adapter"]
        LaunchA["launcher-adapter"]
    end

    subgraph Utilities["Utilities"]
        Guard["reconciliation-guard"]
        SafeW["safe-window"]
        WorldH["world-holder"]
    end

    Ext --> NavH & OvH & WinLC & Settle & NotifCoord
    Ext --> Clone & WinA & FocusA & MonA & KeyA & WinEA & ShellA
    Ext --> OvIA & ConflA & PersA & PanelA & HelpA & LaunchA
    Ext --> Guard & SafeW & WorldH

    NotifCoord --> NotifA & DBusA & StatusA & NotifFM
    OvH --> OvIA
    Clone --> FloatCM["float-clone-manager"]

    style Ext fill:#ffe0b2,stroke:#e65100,stroke-width:2px
```

---

## 3. Port–Adapter Matrix

| Port | Adapter | Responsibility |
|------|---------|----------------|
| `ClonePort` | `clone-adapter` | Clone lifecycle, workspace strip, focus indicator, overview zoom |
| `WindowPort` | `window-adapter` | `move_resize_frame()` on real `Meta.Window`s |
| `FocusPort` | `focus-adapter` | `Meta.Window.activate()`, external focus tracking |
| `MonitorPort` | `monitor-adapter` | Read monitor geometry, `monitors-changed` signal |
| `ShellPort` | `shell-adapter` | Shell method wrappers (`Main.*`) |
| `KeybindingPort` | `keybinding-adapter` | Register/unregister `Meta.KeyBindingAction`s |
| `WindowEventPort` | `window-event-adapter` | `window-created`, `first-frame`, `destroy` signals |
| `StatePersistencePort` | `state-persistence` | Save/restore `World` across enable/disable cycles |
| `NotificationPort` | `notification-overlay-adapter` | Claude Code notification cards in overview |
| `PanelIndicatorPort` | `panel-indicator-adapter` | Workspace name in GNOME top bar |
| `ConflictDetectorPort` | `conflict-detector` | Detect keybinding conflicts with other extensions |

---

## 4. State Machines

### Window lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: window-created signal
    Created --> WaitingFirstFrame: deferred classification
    WaitingFirstFrame --> Tiled: shouldTile() = true
    WaitingFirstFrame --> Floating: shouldFloat() = true
    WaitingFirstFrame --> Tiled: timeout (2000ms)

    state Tiled {
        [*] --> Positioned: domain.addWindow() → applyLayout()
        Positioned --> Settling: settlement-retry loop
        Settling --> Settled: all windows match target positions
        Settling --> Settling: unsettled → retry (backoff)
        Settled --> Fullscreen: fullscreen toggled on
        Fullscreen --> Settled: fullscreen toggled off
        Settled --> Widened: maximized → unmaximize + widen
        Widened --> Settled: toggleSize back
    }

    Floating --> FloatClone: addFloatClone()

    Tiled --> [*]: actor destroy signal
    Floating --> [*]: actor destroy signal
```

### Overview mode

```mermaid
stateDiagram-v2
    [*] --> Closed

    Closed --> Open: Super+M / toggle keybinding
    note right of Open: domain.enterOverview()\nclone-adapter zooms out\noverview-input-adapter activates

    Open --> Navigating: Arrow keys
    Navigating --> Navigating: Arrow keys
    Navigating --> Open: no more input

    Open --> Closed: Enter / Super+M (confirm)
    Navigating --> Closed: Enter / Super+M (confirm)
    note right of Closed: domain.exitOverview()\nfocus navigated window\nclone-adapter zooms in

    Open --> Cancelled: Escape
    Navigating --> Cancelled: Escape
    Cancelled --> Closed: restore pre-overview state
    note left of Cancelled: domain.cancelOverview()\nrestore saved focus + viewport

    Open --> ClickFocus: click on window clone
    ClickFocus --> Closed: domain.setFocus() → confirm exit
```

### Settlement retry

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Checking: start() called after layout change
    note right of Checking: Backoff delays (ms) 100 / 150 / 200 / 300 / 400 / 500 / 750 / 1000

    Checking --> Applying: timer fires
    Applying --> Checking: hasUnsettledWindows() = true\nincrement step, schedule next
    Applying --> Idle: all windows settled OR max retries
    Checking --> Idle: cancel() or destroy()
```

### Viewport scroll

```mermaid
stateDiagram-v2
    [*] --> Centered: viewport centered on focused window

    Centered --> Scrolling: focus/move changes viewport
    note right of Scrolling: domain.adjustViewport()\nclone-adapter animates strip X

    Scrolling --> Centered: animation completes

    Centered --> OverviewZoom: enter overview
    OverviewZoom --> Centered: exit overview
```

---

## 5. Signal Choreography

### Window creation flow

```mermaid
sequenceDiagram
    participant Mutter
    participant WEA as WindowEventAdapter
    participant Ext as Extension
    participant Domain
    participant Clone as CloneAdapter
    participant WinA as WindowAdapter
    participant Focus as FocusAdapter
    participant Settle as SettlementRetry

    Mutter->>WEA: window-created signal
    WEA->>WEA: defer to first-frame / timeout

    alt first-frame fires
        Mutter->>WEA: first-frame signal
    else timeout (2000ms)
        WEA->>WEA: timeout fires
    end

    WEA->>WEA: classify: shouldTile()?
    WEA->>Ext: onWindowReady(windowId)
    Ext->>Ext: reconciliation guard check
    Ext->>Clone: addClone(window)
    Ext->>Domain: addWindow(world, windowId)
    Domain-->>Ext: WorldUpdate { world, layout }
    Ext->>WinA: applyLayout(layout)
    Ext->>Clone: applyLayout(layout)
    Ext->>Focus: focusInternal(focusedWindow)
    Ext->>Settle: start()
    Settle->>Settle: schedule check (100ms)

    loop until settled or max retries
        Settle->>Domain: computeLayout(world)
        Domain-->>Settle: LayoutState
        Settle->>WinA: applyLayout(layout)
        Settle->>Clone: applyLayout(layout)
        Settle->>WinA: hasUnsettledWindows()?
        alt unsettled
            Settle->>Settle: schedule next (backoff)
        end
    end
```

### Keybinding → layout flow

```mermaid
sequenceDiagram
    participant User
    participant KeyA as KeybindingAdapter
    participant NavH as NavigationHandler
    participant Domain
    participant Ext as Extension
    participant Clone as CloneAdapter
    participant WinA as WindowAdapter
    participant Focus as FocusAdapter

    User->>KeyA: Super+Right
    KeyA->>Ext: keybinding callback
    Ext->>NavH: handleSimpleCommand(focusRight)

    NavH->>NavH: reconciliation guard check
    NavH->>Domain: focusRight(world)
    Domain-->>NavH: WorldUpdate { world, layout }
    NavH->>Ext: set new world
    NavH->>WinA: applyLayout(layout)
    NavH->>Clone: applyLayout(layout)
    NavH->>Focus: focusInternal(newFocusWindow)
```

### Vertical move (cross-workspace)

```mermaid
sequenceDiagram
    participant NavH as NavigationHandler
    participant Domain
    participant Clone as CloneAdapter
    participant WinA as WindowAdapter
    participant Focus as FocusAdapter

    NavH->>NavH: save source workspace ID & scroll X
    NavH->>Domain: moveDown(world)
    Domain-->>NavH: WorldUpdate { world, layout }
    NavH->>Clone: moveCloneToWorkspace(windowId, newWsId)
    NavH->>Clone: syncWorkspaceContainers(world)
    NavH->>Clone: setScrollForWorkspace(newWsId, savedScrollX)
    NavH->>WinA: applyLayout(mainLayout)
    NavH->>Domain: computeLayoutForWorkspace(sourceWs)
    NavH->>WinA: applyLayout(sourceLayout)
    NavH->>Clone: applyLayout(sourceLayout)
    NavH->>Focus: activate(movedWindow)
```

### Overview enter/exit

```mermaid
sequenceDiagram
    participant User
    participant OvH as OverviewHandler
    participant Domain
    participant Clone as CloneAdapter
    participant OvInput as OverviewInputAdapter
    participant WinA as WindowAdapter
    participant Focus as FocusAdapter

    User->>OvH: Super+M (toggle)
    OvH->>OvH: save focus & viewport snapshot
    OvH->>Domain: enterOverview(world)
    Domain-->>OvH: WorldUpdate { world, layout }
    OvH->>Clone: enterOverview(transform, layout)
    OvH->>OvInput: activate()

    Note over User,Focus: User navigates in overview...

    User->>OvInput: Arrow key
    OvInput->>OvH: onNavigate(direction)
    OvH->>Domain: focusRight/Left/Up/Down(world)
    Domain-->>OvH: WorldUpdate
    OvH->>Clone: updateOverviewFocus(layout)

    User->>OvInput: Enter (confirm)
    OvInput->>OvH: onConfirm()
    OvH->>Domain: exitOverview(world)
    Domain-->>OvH: WorldUpdate { world, layout }
    OvH->>OvInput: deactivate()
    OvH->>Clone: exitOverview()
    OvH->>WinA: applyLayout(layout)
    OvH->>Focus: activate(selectedWindow)
```

### Window destruction flow

```mermaid
sequenceDiagram
    participant Mutter
    participant WEA as WindowEventAdapter
    participant Ext as Extension
    participant Domain
    participant Clone as CloneAdapter
    participant WinA as WindowAdapter
    participant Focus as FocusAdapter

    Mutter->>WEA: actor destroy signal
    WEA->>Ext: onWindowDestroyed(windowId)
    Ext->>Ext: reconciliation guard check
    Ext->>Domain: removeWindow(world, windowId)
    Domain-->>Ext: WorldUpdate { world, layout }
    Note over Domain: empty workspace pruned,<br/>indices adjusted
    Ext->>Clone: removeClone(windowId)
    Ext->>WinA: applyLayout(layout)
    Ext->>Clone: applyLayout(layout)
    Ext->>Clone: syncWorkspaceContainers(world)
    Ext->>Focus: focusInternal(newFocusWindow)
```

---

## 6. Feature Walkthrough

### Adding a new keybinding

**Example:** Add `Super+G` to group windows.

1. **Schema** — `schemas/org.gnome.shell.extensions.kestrel.gschema.xml`
   - Add a new key: `<key name="group-windows" type="as"><default>['&lt;Super&gt;g']</default></key>`

2. **Domain** — `src/domain/window-operations.ts` (or new file)
   - Write a pure function: `groupWindows(world: World): WorldUpdate`
   - Add tests in `test/domain/`

3. **Port** — `src/ports/keybinding-port.ts`
   - Add the binding name to `KeybindingCallbacks` interface

4. **Adapter** — `src/adapters/keybinding-adapter.ts`
   - Register the binding in `enable()`, unregister in `destroy()`

5. **Extension** — `src/extension.ts`
   - Wire the callback: call domain function → `_applyLayout()` → `focusInternal()`

6. **Build & test**
   ```bash
   npx vitest run test/domain/window-operations.test.ts
   make install
   ```

### Adding a new adapter

**Example:** Add a sound-effects adapter.

1. **Port** — `src/ports/sound-port.ts`
   - Define interface: `interface SoundPort { playNavigate(): void; playOverview(): void; }`

2. **Adapter** — `src/adapters/sound-adapter.ts`
   - Implement `SoundPort` using `gi://` audio APIs
   - Include `destroy()` for cleanup

3. **Extension** — `src/extension.ts`
   - Import and instantiate in `enable()`
   - Call port methods at appropriate points (after navigation, overview enter/exit)
   - Call `destroy()` in `disable()`

---

## 7. Glossary

| Term | Meaning |
|------|---------|
| **World** | Complete domain state: all workspaces, windows, focus, viewport, config |
| **WorldUpdate** | Return type of domain operations: `{ world, layout }` — new state + computed positions |
| **Workspace** | Virtual container of windows (Kestrel concept, not GNOME workspaces) |
| **Slot** | Half-monitor-width unit. A window occupies 1 or 2 slots. |
| **Viewport** | 2D camera showing a portion of the workspace. Width = monitor. Scrolls in 1-slot increments. |
| **Clone** | `Clutter.Clone` of a `Meta.WindowActor`, positioned on a custom layer for scrolling |
| **Clone wrapper** | `Clutter.Actor` parent of a clone, sized to layout target, clips overflow |
| **Settlement** | State where all real windows match their target positions (Wayland configures complete) |
| **Settlement retry** | Exponential-backoff loop re-applying layout until windows settle |
| **Reconciliation guard** | Debounce mechanism preventing duplicate signal processing within a frame |
| **Overview transform** | Scale + offset that zooms out the workspace strip to show all workspaces |
| **Float clone** | Clone of a non-tiled window (dialog, popup) rendered above the tiling layer |
| **Layout** | `LayoutState` — computed pixel positions for all windows in a workspace |
| **Branded type** | TypeScript type with a phantom brand field (`WindowId`, `WorkspaceId`) for type safety |
