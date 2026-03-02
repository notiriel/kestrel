import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import type { WindowId, WorkspaceId, MonitorInfo } from './domain/types.js';
import type { World } from './domain/world.js';
import { createWorld, setFocus, updateMonitor, updateConfig, wsIdAt, renameCurrentWorkspace, findWorkspaceByName, switchToWorkspace } from './domain/world.js';
import { diffScene, computeScene } from './domain/scene.js';
import type { SceneModel, CloneScene, RealWindowScene, FocusIndicatorScene, WorkspaceStripScene } from './domain/scene.js';
import { focusRight, focusLeft, focusDown, focusUp } from './domain/navigation.js';
import { moveLeft, moveRight, moveDown, moveUp, toggleSize, toggleStack } from './domain/window-operations.js';
import { forceWorkspaceUp, forceWorkspaceDown } from './domain/navigation.js';
import { allWindows } from './domain/workspace.js';
import type { ClonePort } from './ports/clone-port.js';
import type { WindowPort } from './ports/window-port.js';
import type { FocusPort } from './ports/focus-port.js';
import type { MonitorPort } from './ports/monitor-port.js';
import type { ShellPort } from './ports/shell-port.js';
import type { KeybindingPort } from './ports/keybinding-port.js';
import type { WindowEventPort } from './ports/window-event-port.js';
import type { ConflictDetectorPort } from './ports/conflict-detector-port.js';
import type { StatePersistencePort } from './ports/state-persistence-port.js';
import { MonitorAdapter } from './adapters/monitor-adapter.js';
import { ShellAdapter } from './adapters/shell-adapter.js';
import { WindowEventAdapter } from './adapters/window-event-adapter.js';
import { CloneAdapter } from './adapters/clone-adapter.js';
import { WindowAdapter } from './adapters/window-adapter.js';
import { FocusAdapter } from './adapters/focus-adapter.js';
import { KeybindingAdapter } from './adapters/keybinding-adapter.js';
import { OverviewInputAdapter } from './adapters/overview-input-adapter.js';
import { ConflictDetector } from './adapters/conflict-detector.js';
import { ReconciliationGuard } from './adapters/reconciliation-guard.js';
import { OverviewHandler } from './adapters/overview-handler.js';
import { SettlementRetry } from './adapters/settlement-retry.js';
import { StatePersistence } from './adapters/state-persistence.js';
import { NavigationHandler } from './adapters/navigation-handler.js';
import { WindowLifecycleHandler } from './adapters/window-lifecycle-handler.js';
import { PanelIndicatorAdapter } from './adapters/panel-indicator-adapter.js';
import { WorldHolder } from './adapters/world-holder.js';
import { NotificationCoordinator } from './adapters/notification-coordinator.js';
import { HelpOverlayAdapter } from './ui-components/help-overlay.js';
import { MouseInputAdapter } from './adapters/mouse-input-adapter.js';
import { QuakeWindowAdapter } from './adapters/quake-window-adapter.js';
import { toggleQuakeSlot, getUnoccupiedQuakeSlots } from './domain/quake.js';
import { getWorkspaceClaudeStatus } from './domain/notification.js';
import { safeWindow } from './adapters/safe-window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';

export default class KestrelExtension extends Extension {
    private _worldHolder: WorldHolder = new WorldHolder();
    private _monitorAdapter: MonitorPort | null = null;
    private _windowEventAdapter: WindowEventPort | null = null;
    private _cloneAdapter: ClonePort | null = null;
    private _windowAdapter: WindowPort | null = null;
    private _focusAdapter: FocusPort | null = null;
    private _keybindingAdapter: KeybindingPort | null = null;
    private _conflictDetector: ConflictDetectorPort | null = null;
    private _guard: ReconciliationGuard | null = null;
    private _overviewHandler: OverviewHandler | null = null;
    private _settlementRetry: SettlementRetry | null = null;
    private _statePersistence: StatePersistencePort | null = null;
    private _shellAdapter: ShellPort | null = null;
    private _navigationHandler: NavigationHandler | null = null;
    private _windowLifecycleHandler: WindowLifecycleHandler | null = null;
    private _panelIndicator: PanelIndicatorAdapter | null = null;
    private _notificationCoordinator: NotificationCoordinator | null = null;
    private _helpOverlay: HelpOverlayAdapter | null = null;
    private _mouseInputAdapter: MouseInputAdapter | null = null;
    private _quakeAdapter: QuakeWindowAdapter | null = null;
    private _debugMode: boolean = false;
    private _overviewDismissTimeout: ReturnType<typeof setTimeout> | null = null;
    private _settingsChangedId: number = 0;

    enable(): void {
        try {
            console.log('[Kestrel] enabling...');

            const settings = this.getSettings();

            // Read debug mode from settings
            this._debugMode = settings.get_boolean('debug-mode');

            if (this._debugMode) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any).context.unsafe_mode = true;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any)._kestrel = {
                    debugState: () => this._debugState(),
                    diagnostics: () => this._getDiagnostics(),
                    quakeToggle: (slot: number) => this._handleQuakeToggle(slot),
                };
            }

            // 0. Check for conflicting extensions
            this._conflictDetector = new ConflictDetector();
            this._conflictDetector.detectConflicts();

            this._guard = new ReconciliationGuard();

            // 1. Read config
            this._statePersistence = new StatePersistence(settings);
            const config = this._statePersistence.readConfig();

            // 2. Init monitor adapter and read monitors
            this._monitorAdapter = new MonitorAdapter();
            const monitor = this._monitorAdapter.readPrimaryMonitor(config.columnCount);

            // 3. Create domain world
            this._worldHolder.setWorld(createWorld(config, monitor));

            // 4. Create adapters
            this._cloneAdapter = new CloneAdapter();
            this._cloneAdapter.init(monitor.workAreaY, monitor.totalHeight, config);
            this._cloneAdapter.syncWorkspaces(this._worldHolder.world!.workspaces);

            this._windowAdapter = new WindowAdapter();
            this._windowAdapter.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter.setMonitorBounds(monitor.stageOffsetX, monitor.totalWidth);
            this._focusAdapter = new FocusAdapter();
            this._shellAdapter = new ShellAdapter();
            this._quakeAdapter = new QuakeWindowAdapter();
            const kestrelLayer = (this._cloneAdapter as CloneAdapter)?.getLayer?.();
            if (kestrelLayer) this._quakeAdapter.setKestrelLayer(kestrelLayer);
            (this._shellAdapter as ShellAdapter).setQuakeWindowCheck(
                (actor) => this._quakeAdapter?.isQuakeActor(actor) ?? false,
            );

            // Panel indicator in top bar
            this._panelIndicator = new PanelIndicatorAdapter();
            this._panelIndicator.init((wsIndex) => {
                try {
                    if (!this._worldHolder.world) return;
                    const oldScrollX = this._worldHolder.world.viewport.scrollX;
                    const oldWsId = wsIdAt(this._worldHolder.world, this._worldHolder.world.viewport.workspaceIndex);
                    const update = switchToWorkspace(this._worldHolder.world, wsIndex);
                    this._applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
                } catch (e) {
                    console.error('[Kestrel] Error switching workspace from panel:', e);
                }
            });

            // Wire WorldHolder callback for panel indicator updates
            this._worldHolder.setOnWorldChanged((w) => {
                this._panelIndicator?.update(w);
            });
            // Fire initial update
            this._panelIndicator.update(this._worldHolder.world!);

            // Notification coordinator (status overlay, notification overlay, DBus, focus mode)
            this._notificationCoordinator = new NotificationCoordinator({
                getWorld: () => this._worldHolder.world,
                setWorld: (w) => { this._setWorld(w); },
                extensionPath: this.path,
                getLayer: () => (this._cloneAdapter as CloneAdapter)?.getLayer?.() ?? null,
                visitSession: (sessionId) => this._visitSession(sessionId),
                getMetaWindow: (wid) => this._focusAdapter?.getMetaWindow(wid),
                isOverviewActive: () => this._overviewHandler?.isActive ?? false,
                getMonitor: () => {
                    const m = this._worldHolder.world?.monitor;
                    return {
                        x: m?.stageOffsetX ?? 0,
                        y: m?.workAreaY ?? 0,
                        width: m?.totalWidth ?? 1920,
                        height: m?.totalHeight ?? 1080,
                    };
                },
                listWorkspaces: () => this._listWorkspaces(),
                switchToWorkspaceByName: (name) => this._switchToWorkspaceByName(name),
                renameCurrentWorkspace: (name) => this._renameCurrentWorkspace(name),
                getDiagnostics: () => this._getDiagnostics(),
            });
            this._notificationCoordinator.init();

            // Help overlay (Super+')
            this._helpOverlay = new HelpOverlayAdapter(this.path);

            // 5. Create collaborators
            this._overviewHandler = new OverviewHandler({
                getWorld: () => this._worldHolder.world,
                setWorld: (w) => { this._setWorld(w); },
                focusWindow: (id) => this._focusAdapter?.focusInternal(id),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                createOverviewInputAdapter: () => new OverviewInputAdapter(),
                notifyOverviewEnter: (transform) => {
                    const positions = (this._cloneAdapter as CloneAdapter)?.getClonePositions?.();
                    if (positions) {
                        this._notificationCoordinator?.enterOverview(transform, positions);
                    }
                },
                notifyOverviewExit: () => {
                    this._notificationCoordinator?.exitOverview();
                },
                onOverviewEnter: () => {
                    this._mouseInputAdapter?.deactivate();
                    // Domain auto-dismisses quake in enterOverview; apply the scene
                    if (this._worldHolder.world) {
                        this._quakeAdapter?.applyQuakeScene(computeScene(this._worldHolder.world).quakeWindow);
                    }
                },
                onOverviewExit: () => {
                    this._mouseInputAdapter?.activate();
                },
            });

            this._settlementRetry = new SettlementRetry({
                getWorld: () => this._worldHolder.world,
                checkGuard: (label) => this._guard?.check(label) ?? false,
                focusWindow: (id) => this._focusAdapter?.focusInternal(id),
                getWindowAdapter: () => this._windowAdapter,
                getCloneAdapter: () => this._cloneAdapter,
            });

            this._navigationHandler = new NavigationHandler({
                getWorld: () => this._worldHolder.world,
                setWorld: (w) => { this._setWorld(w); },
                checkGuard: (label) => this._guard?.check(label) ?? false,
                focusWindow: (id) => this._focusAdapter?.focusInternal(id),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                applyScene: (scene, animate) => this._applyScene(scene, animate),
                applyUpdateWithScroll: (update, animate, oldScrollX, oldWsId) =>
                    this._applyUpdateWithScroll(update, animate, oldScrollX, oldWsId),
            });

            this._mouseInputAdapter = new MouseInputAdapter({
                getWorld: () => this._worldHolder.world,
                isOverviewActive: () => this._overviewHandler?.isActive ?? false,
                onScrollHorizontal: (direction) => {
                    if (direction === 'left') this._navigationHandler!.handleSimpleCommand(focusLeft, 'scrollLeft');
                    else this._navigationHandler!.handleSimpleCommand(focusRight, 'scrollRight');
                },
                onScrollVertical: (direction) => {
                    if (direction === 'up') this._navigationHandler!.handleVerticalFocus(focusUp, 'scrollUp');
                    else this._navigationHandler!.handleVerticalFocus(focusDown, 'scrollDown');
                },
            });

            this._windowLifecycleHandler = new WindowLifecycleHandler({
                getWorld: () => this._worldHolder.world,
                setWorld: (w) => { this._setWorld(w); },
                checkGuard: (label) => this._guard?.check(label) ?? false,
                applyScene: (scene, animate) => this._applyScene(scene, animate),
                applyUpdateWithScroll: (update, animate, oldScrollX, oldWsId) =>
                    this._applyUpdateWithScroll(update, animate, oldScrollX, oldWsId),
                focusWindow: (id) => this._focusAdapter?.focusInternal(id),
                log: (msg) => this._log(msg),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                getFocusAdapter: () => this._focusAdapter,
                startSettlement: () => this._settlementRetry?.start(),
                watchWindow: (wid, meta) => this._notificationCoordinator?.watchWindow(wid, meta as Meta.Window),
                unwatchWindow: (wid) => this._notificationCoordinator?.unwatchWindow(wid),
                matchQuakeSlot: (metaWindow) => {
                    if (!this._quakeAdapter || !this._worldHolder.world) return null;
                    return this._quakeAdapter.matchWindowToSlot(metaWindow, this._worldHolder.world.config) ?? null;
                },
                trackQuakeWindow: (wid, metaWindow) => this._quakeAdapter?.track(wid, metaWindow),
                untrackQuakeWindow: (wid) => this._quakeAdapter?.untrack(wid),
                applyQuakeScene: (world) => {
                    const scene = computeScene(world);
                    this._quakeAdapter?.applyQuakeScene(scene.quakeWindow);
                },
            });

            // 6. Connect keybindings
            this._keybindingAdapter = new KeybindingAdapter();
            this._keybindingAdapter.connect(settings, {
                onFocusRight: () => this._navigationHandler!.handleSimpleCommand(focusRight, 'focusRight'),
                onFocusLeft: () => this._navigationHandler!.handleSimpleCommand(focusLeft, 'focusLeft'),
                onFocusDown: () => this._navigationHandler!.handleVerticalFocus(focusDown, 'focusDown'),
                onFocusUp: () => this._navigationHandler!.handleVerticalFocus(focusUp, 'focusUp'),
                onMoveLeft: () => this._navigationHandler!.handleSimpleCommand(moveLeft, 'moveLeft'),
                onMoveRight: () => this._navigationHandler!.handleSimpleCommand(moveRight, 'moveRight'),
                onMoveDown: () => this._navigationHandler!.handleVerticalMove(moveDown, 'moveDown'),
                onMoveUp: () => this._navigationHandler!.handleVerticalMove(moveUp, 'moveUp'),
                onToggleSize: () => this._navigationHandler!.handleSimpleCommand(toggleSize, 'toggleSize'),
                onToggleOverview: () => this._overviewHandler!.handleToggle(),
                onNewWindow: () => {
                    try {
                        const focusedWindow = this._worldHolder.world?.focusedWindow;
                        if (focusedWindow) this._focusAdapter?.openNewWindow(focusedWindow);
                    } catch (e) {
                        console.error('[Kestrel] Error opening new window:', e);
                    }
                },
                onToggleNotifications: () => this._notificationCoordinator?.toggle(),
                onToggleHelp: () => this._helpOverlay?.toggle(),
                onCloseWindow: () => {
                    try {
                        const focusedWindow = this._worldHolder.world?.focusedWindow;
                        if (focusedWindow) this._focusAdapter?.closeWindow(focusedWindow);
                    } catch (e) {
                        console.error('[Kestrel] Error closing window:', e);
                    }
                },
                onJoinStack: () => this._navigationHandler!.handleSimpleCommand(toggleStack, 'joinStack'),
                onForceWorkspaceUp: () => this._navigationHandler!.handleVerticalFocus(forceWorkspaceUp, 'forceWorkspaceUp'),
                onForceWorkspaceDown: () => this._navigationHandler!.handleVerticalFocus(forceWorkspaceDown, 'forceWorkspaceDown'),
                onQuakeSlot1: () => this._handleQuakeToggle(0),
                onQuakeSlot2: () => this._handleQuakeToggle(1),
                onQuakeSlot3: () => this._handleQuakeToggle(2),
                onQuakeSlot4: () => this._handleQuakeToggle(3),
                onQuakeSlot5: () => this._handleQuakeToggle(4),
            });

            // 7b. Activate mouse scroll handler
            this._mouseInputAdapter.activate();

            // 7. Connect external focus changes (click-to-focus)
            this._focusAdapter.connectFocusChanged((windowId: WindowId) => {
                this._handleExternalFocus(windowId);
            });

            // 8. Connect monitor changes
            this._monitorAdapter.connectMonitorsChanged(config.columnCount, (info: MonitorInfo) => {
                this._handleMonitorChange(info);
            });

            // 9. Connect window signals
            this._windowEventAdapter = new WindowEventAdapter();
            this._windowEventAdapter.connect({
                onWindowReady: (windowId: WindowId, metaWindow: unknown) => {
                    this._windowLifecycleHandler?.handleWindowReady(windowId, metaWindow as Meta.Window);
                },
                onWindowDestroyed: (windowId: WindowId) => {
                    this._windowLifecycleHandler?.handleWindowDestroyed(windowId);
                },
                onFloatWindowReady: (windowId: WindowId, metaWindow: unknown) => {
                    const rawMetaWindow = metaWindow as Meta.Window;
                    this._log(`[Kestrel] float window added: ${windowId} title="${rawMetaWindow.get_title()}"`);
                    this._cloneAdapter?.addFloatClone(windowId, safeWindow(rawMetaWindow));
                },
                onFloatWindowDestroyed: (windowId: WindowId) => {
                    this._log(`[Kestrel] float window removed: ${windowId}`);
                    this._cloneAdapter?.removeFloatClone(windowId);
                },
                onWindowFullscreenChanged: (windowId: WindowId, isFullscreen: boolean) => {
                    this._windowLifecycleHandler?.handleFullscreenChanged(windowId, isFullscreen);
                },
                onWindowMaximized: (windowId: WindowId) => {
                    this._windowLifecycleHandler?.handleWindowMaximized(windowId);
                },
            });

            // 10. Skip GNOME's window close and minimize animations
            this._shellAdapter.interceptWmAnimations();

            // 11. Try restoring saved state, then enumerate existing windows.
            const restored = this._statePersistence.tryRestore(config, monitor);
            if (restored) {
                this._setWorld(restored);
                this._cloneAdapter.syncWorkspaces(this._worldHolder.world!.workspaces);
            }
            this._windowEventAdapter.enumerateExisting();

            // Dismiss GNOME overview if it's showing (e.g. on login).
            // Also pre-launch quake apps after a delay (windows need time to enumerate).
            this._overviewDismissTimeout = setTimeout(() => {
                this._overviewDismissTimeout = null;
                this._shellAdapter?.hideOverview();
                if (settings.get_boolean('quake-prelaunch')) {
                    this._prelaunchQuakeApps();
                }
            }, 1000);

            // 12. Live settings reload
            this._settingsChangedId = settings.connect('changed', (_settings: Gio.Settings, key: string) => {
                try {
                    this._onSettingChanged(key);
                } catch (e) {
                    console.error('[Kestrel] settings changed error:', e);
                }
            });

            console.log('[Kestrel] enabled');
        } catch (e) {
            console.error('[Kestrel] Failed to enable:', e);
        }
    }

    disable(): void {
        try {
            console.log('[Kestrel] disabling...');

            if (this._worldHolder.world) {
                this._statePersistence?.save(this._worldHolder.world);
            }

            if (this._settingsChangedId) {
                this.getSettings().disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }

            if (this._overviewDismissTimeout !== null) {
                clearTimeout(this._overviewDismissTimeout);
                this._overviewDismissTimeout = null;
            }

            this._notificationCoordinator?.destroy();
            this._notificationCoordinator = null;

            this._quakeAdapter?.destroy();
            this._quakeAdapter = null;

            this._shellAdapter?.destroy();
            this._shellAdapter = null;

            this._settlementRetry?.destroy();
            this._settlementRetry = null;

            this._helpOverlay?.destroy();
            this._helpOverlay = null;

            this._panelIndicator?.destroy();
            this._panelIndicator = null;

            this._overviewHandler?.destroy();
            this._overviewHandler = null;

            this._mouseInputAdapter?.destroy();
            this._mouseInputAdapter = null;

            this._navigationHandler = null;
            this._windowLifecycleHandler = null;

            this._windowEventAdapter?.destroy();
            this._windowEventAdapter = null;

            this._keybindingAdapter?.destroy();
            this._keybindingAdapter = null;

            this._monitorAdapter?.destroy();
            this._monitorAdapter = null;

            this._windowAdapter?.destroy();
            this._windowAdapter = null;

            this._focusAdapter?.destroy();
            this._focusAdapter = null;

            this._cloneAdapter?.destroy();
            this._cloneAdapter = null;

            this._guard?.destroy();
            this._guard = null;

            this._conflictDetector?.destroy();
            this._conflictDetector = null;

            this._statePersistence = null;

            this._worldHolder.setOnWorldChanged(null);
            this._worldHolder = new WorldHolder();
            if (this._debugMode) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any)._kestrel = null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (global as any).context.unsafe_mode = false;
            }

            console.log('[Kestrel] disabled');
        } catch (e) {
            console.error('[Kestrel] Failed to disable:', e);
        }
    }

    /** Set Claude session status for a window. Called via DBus from hook scripts. */
    setWindowStatus(sessionId: string, status: string): void {
        this._notificationCoordinator?.setWindowStatus(sessionId, status);
    }

    private _log(msg: string): void {
        if (this._debugMode) console.log(msg);
    }

    private _onSettingChanged(key: string): void {
        if (key === 'saved-state' || key === 'debug-mode') return;
        if (!this._worldHolder.world || !this._statePersistence) return;

        this._log(`[Kestrel] setting changed: ${key}`);

        const config = this._statePersistence.readConfig();

        // If columnCount changed, recompute monitor info (slotWidth depends on it)
        if (config.columnCount !== this._worldHolder.world.config.columnCount) {
            const monitor = this._monitorAdapter?.readPrimaryMonitor(config.columnCount);
            if (monitor) {
                const update = updateMonitor(
                    { ...this._worldHolder.world, config },
                    monitor,
                );
                this._setWorld(update.world);
                this._cloneAdapter?.updateConfig?.(config);
                this._applyScene(update.scene, true);
                return;
            }
        }

        const update = updateConfig(this._worldHolder.world, config);
        this._setWorld(update.world);

        this._cloneAdapter?.updateConfig?.(config);
        this._applyScene(update.scene, true);
    }

    private _setWorld(world: World): void {
        this._worldHolder.setWorld(world);
    }

    private _visitSession(sessionId: string): void {
        if (!this._worldHolder.world) return;
        const wid = this._worldHolder.world.notificationState.sessionWindows.get(sessionId) ?? null;
        if (!wid) return;
        const oldScrollX = this._worldHolder.world.viewport.scrollX;
        const oldWsId = wsIdAt(this._worldHolder.world, this._worldHolder.world.viewport.workspaceIndex);
        const update = setFocus(this._worldHolder.world, wid);
        this._applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
    }

    private _debugState(): string {
        if (!this._worldHolder.world) return '{"error":"no world"}';
        const scene = computeScene(this._worldHolder.world);
        return JSON.stringify({
            world: {
                config: this._worldHolder.world.config,
                monitor: this._worldHolder.world.monitor,
                focusedWindow: this._worldHolder.world.focusedWindow,
                overviewActive: this._worldHolder.world.overviewActive,
                workspaces: this._worldHolder.world.workspaces.map(ws => ({
                    id: ws.id,
                    name: ws.name,
                    columns: ws.columns.map(col => ({
                        slotSpan: col.slotSpan,
                        windows: col.windows.map(w => ({ id: w.id })),
                    })),
                })),
                viewport: this._worldHolder.world.viewport,
            },
            scene: {
                focusedWindowId: scene.focusedWindowId,
                clones: scene.clones,
                focusIndicator: scene.focusIndicator,
                workspaceStrip: scene.workspaceStrip,
            },
        });
    }

    private _getDiagnostics(): string {
        try {
            const world = this._worldHolder.world;
            if (!world) return '{"error":"no world"}';

            // Expected scene comes directly from domain
            const expected = computeScene(world);

            // Read actual state from adapters
            const adapter = this._cloneAdapter as CloneAdapter;
            const clonePositions = adapter?.getClonePositions?.();
            const windowStates = (this._windowAdapter as WindowAdapter)?.getWindowStates?.();
            const focusState = adapter?.getFocusIndicatorState?.();
            const stripState = adapter?.getWorkspaceStripState?.();

            // Build actual clone scenes
            const actualClones: CloneScene[] = [];
            if (clonePositions) {
                for (const [windowId, pos] of clonePositions) {
                    actualClones.push({
                        windowId,
                        workspaceId: pos.workspaceId,
                        x: pos.x,
                        y: pos.y,
                        width: pos.width,
                        height: pos.height,
                        visible: pos.visible,
                    });
                }
            }

            // Build actual real window scenes
            const actualRealWindows: RealWindowScene[] = [];
            if (windowStates) {
                for (const [windowId, state] of windowStates) {
                    actualRealWindows.push({
                        windowId,
                        x: state.frameX,
                        y: state.frameY,
                        width: state.frameWidth,
                        height: state.frameHeight,
                        opacity: state.fullscreen ? 255 : 0,
                        minimized: state.offscreen,
                    });
                }
            }

            // Build actual focus indicator
            const actualFocus: FocusIndicatorScene = focusState
                ? focusState
                : { visible: false, x: 0, y: 0, width: 0, height: 0 };

            // Build actual workspace strip
            const actualStrip: WorkspaceStripScene = stripState
                ? { y: stripState.y, workspaces: stripState.workspaces }
                : expected.workspaceStrip;

            const actual: SceneModel = {
                focusedWindowId: expected.focusedWindowId,
                clones: actualClones,
                realWindows: actualRealWindows,
                focusIndicator: actualFocus,
                workspaceStrip: actualStrip,
                quakeWindow: expected.quakeWindow,
            };

            const mismatches = diffScene(expected, actual);

            return JSON.stringify({ expected, actual, mismatches });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _renameCurrentWorkspace(name: string): string {
        try {
            if (!this._worldHolder.world) return '{"error":"no world"}';
            this._setWorld(renameCurrentWorkspace(this._worldHolder.world, name || null));
            this._cloneAdapter?.syncWorkspaces(this._worldHolder.world!.workspaces);
            return '{"ok":true}';
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _switchToWorkspaceByName(name: string): string {
        try {
            if (!this._worldHolder.world) return '{"error":"no world"}';
            const wsIndex = findWorkspaceByName(this._worldHolder.world, name);
            if (wsIndex === -1) return '{"error":"workspace not found"}';

            const oldScrollX = this._worldHolder.world.viewport.scrollX;
            const oldWsId = wsIdAt(this._worldHolder.world, this._worldHolder.world.viewport.workspaceIndex);

            const update = switchToWorkspace(this._worldHolder.world, wsIndex);
            this._applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
            return '{"ok":true}';
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _listWorkspaces(): string {
        try {
            if (!this._worldHolder.world) return '{"error":"no world"}';
            const result = this._worldHolder.world.workspaces
                .map((ws, i) => ({
                    index: i,
                    name: ws.name,
                    windowCount: allWindows(ws).length,
                    isCurrent: i === this._worldHolder.world!.viewport.workspaceIndex,
                    claudeStatus: this._getWorkspaceClaudeStatus(i),
                }))
                .filter(ws => ws.windowCount > 0);
            return JSON.stringify(result);
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _getWorkspaceClaudeStatus(wsIndex: number): string | null {
        if (!this._worldHolder.world) return null;
        const ws = this._worldHolder.world.workspaces[wsIndex];
        if (!ws) return null;
        return getWorkspaceClaudeStatus(this._worldHolder.world.notificationState, ws);
    }

    private _applyUpdateWithScroll(
        update: import('./domain/types.js').WorldUpdate, animate: boolean,
        oldScrollX: number, oldWsId: WorkspaceId | null,
    ): void {
        this._setWorld(update.world);
        const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
        if (newWsId && newWsId !== oldWsId) {
            this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
        }
        this._applyScene(update.scene, animate);
        this._focusAdapter?.focusInternal(update.world.focusedWindow);
    }

    private _applyScene(scene: import('./domain/scene.js').SceneModel, animate: boolean, nudgeUnsettled: boolean = false): void {
        this._windowAdapter?.applyScene(scene, nudgeUnsettled);
        this._cloneAdapter?.applyScene(scene, animate);
    }

    /** Launch all configured quake apps that don't already have a window assigned. */
    private _prelaunchQuakeApps(): void {
        try {
            if (!this._worldHolder.world || !this._quakeAdapter) return;
            for (const { slotIndex, appId } of getUnoccupiedQuakeSlots(this._worldHolder.world)) {
                this._log(`[Kestrel] pre-launching quake slot ${slotIndex}: ${appId}`);
                this._quakeAdapter.launchApp(appId);
            }
        } catch (e) {
            console.error('[Kestrel] Error pre-launching quake apps:', e);
        }
    }

    private _handleQuakeToggle(slotIndex: number): void {
        try {
            if (!this._worldHolder.world || !this._quakeAdapter) return;

            const config = this._worldHolder.world.config;
            const slotConfig = config.quakeSlots[slotIndex];
            if (!slotConfig?.appId) return;  // Slot not configured

            const { quakeState } = this._worldHolder.world;
            const windowId = quakeState.slots[slotIndex];

            this._log(`[Kestrel] quake toggle slot=${slotIndex} windowId=${windowId} activeSlot=${quakeState.activeSlot}`);

            if (!windowId) {
                // No window assigned — launch the app
                this._log(`[Kestrel] quake launching app: ${slotConfig.appId}`);
                this._quakeAdapter.launchApp(slotConfig.appId);
                return;
            }

            // Toggle the slot
            const update = toggleQuakeSlot(this._worldHolder.world, slotIndex);
            this._setWorld(update.world);
            this._log(`[Kestrel] quake toggled: newActiveSlot=${update.world.quakeState.activeSlot} quakeScene=${update.scene.quakeWindow ? 'visible' : 'null'}`);
            this._quakeAdapter.applyQuakeScene(update.scene.quakeWindow);

            // Focus management
            if (update.world.quakeState.activeSlot === null) {
                // Quake was dismissed — restore tiled focus
                this._quakeAdapter.restoreFocus(
                    update.world.focusedWindow,
                    (id) => this._focusAdapter?.focusInternal(id),
                );
            }
        } catch (e) {
            console.error('[Kestrel] Error handling quake toggle:', e);
        }
    }

    private _handleExternalFocus(windowId: WindowId): void {
        try {
            if (!this._worldHolder.world) return;
            if (!this._guard?.check('externalFocus')) return;
            if (this._worldHolder.world.focusedWindow === windowId) return;

            const oldScrollX = this._worldHolder.world.viewport.scrollX;
            const oldWsId = wsIdAt(this._worldHolder.world, this._worldHolder.world.viewport.workspaceIndex);

            const update = setFocus(this._worldHolder.world, windowId);
            this._applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
            this._quakeAdapter?.applyQuakeScene(update.scene.quakeWindow);
        } catch (e) {
            console.error('[Kestrel] Error handling external focus:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._worldHolder.world) return;
            if (!this._guard?.check('monitorChange')) return;

            this._log('[Kestrel] monitors changed');

            const update = updateMonitor(this._worldHolder.world, monitor);
            this._setWorld(update.world);

            this._cloneAdapter?.updateWorkArea(monitor.workAreaY, monitor.totalHeight);
            this._windowAdapter?.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter?.setMonitorBounds(monitor.stageOffsetX, monitor.totalWidth);

            this._applyScene(update.scene, false);
        } catch (e) {
            console.error('[Kestrel] Error handling monitor change:', e);
        }
    }
}
