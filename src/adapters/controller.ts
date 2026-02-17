import type { WindowId, WorkspaceId, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, setFocus, updateMonitor, buildUpdate, enterFullscreen, exitFullscreen, widenWindow, findWorkspaceIdForWindow, wsIdAt } from '../domain/world.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
import { moveLeft, moveRight, moveDown, moveUp, toggleSize } from '../domain/window-operations.js';
import { computeLayout } from '../domain/layout.js';
import type { ClonePort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { FocusPort } from '../ports/focus-port.js';
import type { MonitorPort } from '../ports/monitor-port.js';
import type { ShellPort } from '../ports/shell-port.js';
import type { KeybindingPort } from '../ports/keybinding-port.js';
import type { WindowEventPort } from '../ports/window-event-port.js';
import type { ConflictDetectorPort } from '../ports/conflict-detector-port.js';
import type { StatePersistencePort } from '../ports/state-persistence-port.js';
import type { ControllerPorts } from '../ports/controller-ports.js';
import { MonitorAdapter } from './monitor-adapter.js';
import { ShellAdapter } from './shell-adapter.js';
import { WindowEventAdapter } from './window-event-adapter.js';
import { CloneAdapter } from './clone-adapter.js';
import { WindowAdapter } from './window-adapter.js';
import { FocusAdapter } from './focus-adapter.js';
import { KeybindingAdapter } from './keybinding-adapter.js';
import { OverviewInputAdapter } from './overview-input-adapter.js';
import { ConflictDetector } from './conflict-detector.js';
import { ReconciliationGuard } from './reconciliation-guard.js';
import { OverviewHandler } from './overview-handler.js';
import { SettlementRetry } from './settlement-retry.js';
import { StatePersistence } from './state-persistence.js';
import { NavigationHandler } from './navigation-handler.js';
import { safeWindow } from './safe-window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';

export class PaperFlowController {
    private _settings: Gio.Settings;
    private _ports: Partial<ControllerPorts>;
    private _world: World | null = null;
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
    private _statePersistence: StatePersistencePort;
    private _shellAdapter: ShellPort | null = null;
    private _navigationHandler: NavigationHandler | null = null;
    private _internalFocusChange: boolean = false;
    private _overviewDismissTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(settings: Gio.Settings, ports?: Partial<ControllerPorts>) {
        this._settings = settings;
        this._ports = ports ?? {};
        this._statePersistence = this._ports.statePersistence ?? new StatePersistence(settings);
    }

    enable(): void {
        try {
            console.log('[PaperFlow] enabling...');

            // Enable DBus Eval for development (gdbus call org.gnome.Shell.Eval)
            (global as any).context.unsafe_mode = true;

            // Expose controller on global for DBus debugging
            (global as any)._paperflow = this;

            // 0. Check for conflicting extensions
            this._conflictDetector = this._ports.conflictDetector ?? new ConflictDetector();
            this._conflictDetector.detectConflicts();

            this._guard = new ReconciliationGuard();

            // 1. Read config
            const config = this._statePersistence.readConfig();

            // 2. Init monitor adapter and read monitors
            this._monitorAdapter = this._ports.monitor ?? new MonitorAdapter();
            const monitor = this._monitorAdapter.readPrimaryMonitor();

            // 3. Create domain world
            this._world = createWorld(config, monitor);

            // 4. Create adapters
            this._cloneAdapter = this._ports.clone ?? new CloneAdapter();
            this._cloneAdapter.init(monitor.workAreaY, monitor.totalHeight);
            this._cloneAdapter.syncWorkspaces(this._world.workspaces);

            this._windowAdapter = this._ports.window ?? new WindowAdapter();
            this._windowAdapter.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter.setMonitorWidth(monitor.totalWidth);
            this._focusAdapter = this._ports.focus ?? new FocusAdapter();
            this._shellAdapter = this._ports.shell ?? new ShellAdapter();

            // 5. Create collaborators
            this._overviewHandler = new OverviewHandler({
                getWorld: () => this._world,
                setWorld: (w) => { this._world = w; },
                focusWindow: (id) => this._focusWindow(id),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                createOverviewInputAdapter: () => new OverviewInputAdapter(),
            });

            this._settlementRetry = new SettlementRetry({
                getWorld: () => this._world,
                checkGuard: (label) => this._guard?.check(label) ?? false,
                focusWindow: (id) => this._focusWindow(id),
                getWindowAdapter: () => this._windowAdapter,
                getCloneAdapter: () => this._cloneAdapter,
            });

            this._navigationHandler = new NavigationHandler({
                getWorld: () => this._world,
                setWorld: (w) => { this._world = w; },
                checkGuard: (label) => this._guard?.check(label) ?? false,
                focusWindow: (id) => this._focusWindow(id),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                applyLayout: (layout, animate) => this._applyLayout(layout, animate),
            });

            // 6. Connect keybindings
            this._keybindingAdapter = this._ports.keybinding ?? new KeybindingAdapter();
            this._keybindingAdapter.connect(this._settings, {
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
            });

            // 7. Connect external focus changes (click-to-focus)
            this._focusAdapter.connectFocusChanged((windowId: WindowId) => {
                this._handleExternalFocus(windowId);
            });

            // 8. Connect monitor changes
            this._monitorAdapter.connectMonitorsChanged((info: MonitorInfo) => {
                this._handleMonitorChange(info);
            });

            // 9. Connect window signals
            this._windowEventAdapter = this._ports.windowEvent ?? new WindowEventAdapter();
            this._windowEventAdapter.connect({
                onWindowReady: (windowId: WindowId, metaWindow: unknown) => {
                    this._handleWindowReady(windowId, metaWindow as Meta.Window);
                },
                onWindowDestroyed: (windowId: WindowId) => {
                    this._handleWindowDestroyed(windowId);
                },
                onFloatWindowReady: (windowId: WindowId, metaWindow: unknown) => {
                    const rawMetaWindow = metaWindow as Meta.Window;
                    console.log(`[PaperFlow] float window added: ${windowId} title="${rawMetaWindow.get_title()}"`);
                    this._cloneAdapter?.addFloatClone(windowId, safeWindow(rawMetaWindow));
                },
                onFloatWindowDestroyed: (windowId: WindowId) => {
                    console.log(`[PaperFlow] float window removed: ${windowId}`);
                    this._cloneAdapter?.removeFloatClone(windowId);
                },
                onWindowFullscreenChanged: (windowId: WindowId, isFullscreen: boolean) => {
                    this._handleFullscreenChanged(windowId, isFullscreen);
                },
                onWindowMaximized: (windowId: WindowId) => {
                    this._handleWindowMaximized(windowId);
                },
            });

            // 10. Skip GNOME's window close and minimize animations
            this._shellAdapter.interceptWmAnimations();

            // 11. Try restoring saved state, then enumerate existing windows.
            const restored = this._statePersistence.tryRestore(config, monitor);
            if (restored) {
                this._world = restored;
                this._cloneAdapter.syncWorkspaces(this._world.workspaces);
            }
            this._windowEventAdapter.enumerateExisting();

            // Dismiss GNOME overview if it's showing (e.g. on login).
            // Use a delay because GNOME may show the overview after enable() runs.
            this._overviewDismissTimeout = setTimeout(() => {
                this._overviewDismissTimeout = null;
                this._shellAdapter?.hideOverview();
            }, 1000);

            console.log('[PaperFlow] enabled');
        } catch (e) {
            console.error('[PaperFlow] Failed to enable:', e);
        }
    }

    disable(): void {
        try {
            console.log('[PaperFlow] disabling...');

            if (this._world) {
                this._statePersistence.save(this._world);
            }

            if (this._overviewDismissTimeout !== null) {
                clearTimeout(this._overviewDismissTimeout);
                this._overviewDismissTimeout = null;
            }

            this._shellAdapter?.destroy();
            this._shellAdapter = null;

            this._settlementRetry?.destroy();
            this._settlementRetry = null;

            this._overviewHandler?.destroy();
            this._overviewHandler = null;

            this._navigationHandler = null;

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

            this._world = null;
            (global as any)._paperflow = null;

            console.log('[PaperFlow] disabled');
        } catch (e) {
            console.error('[PaperFlow] Failed to disable:', e);
        }
    }

    /** Serializable snapshot for DBus debugging: global._paperflow.debugState() */
    debugState(): string {
        if (!this._world) return '{"error":"no world"}';
        const layout = buildUpdate(this._world).layout;
        return JSON.stringify({
            world: {
                config: this._world.config,
                monitor: this._world.monitor,
                focusedWindow: this._world.focusedWindow,
                overviewActive: this._world.overviewActive,
                workspaces: this._world.workspaces.map(ws => ({
                    id: ws.id,
                    windows: ws.windows.map(w => ({ id: w.id, slotSpan: w.slotSpan })),
                })),
                viewport: this._world.viewport,
            },
            layout: {
                scrollX: layout.scrollX,
                focusedWindowId: layout.focusedWindowId,
                windows: layout.windows,
            },
        });
    }

    private _handleWindowReady(windowId: WindowId, rawMetaWindow: Meta.Window): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowReady')) return;

            console.log(`[PaperFlow] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);

            const metaWindow = safeWindow(rawMetaWindow);

            // Check if the window already exists in the domain (restored from saved state)
            const existsInDomain = this._world.workspaces.some(
                ws => ws.windows.some(w => w.id === windowId),
            );

            if (existsInDomain) {
                if (metaWindow.maximized_horizontally || metaWindow.maximized_vertically) {
                    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                }
                const restoredWsId = findWorkspaceIdForWindow(this._world, windowId)!;
                this._windowAdapter?.track(windowId, metaWindow);
                this._focusAdapter?.track(windowId, metaWindow);
                this._cloneAdapter?.addClone(windowId, metaWindow, restoredWsId);

                const layout = computeLayout(this._world);
                this._applyLayout(layout, false);
                this._focusWindow(this._world.focusedWindow);
                this._settlementRetry?.start();
                return;
            }

            // Track in adapters
            const wsId = wsIdAt(this._world, this._world.viewport.workspaceIndex)!;
            this._windowAdapter?.track(windowId, metaWindow);
            this._focusAdapter?.track(windowId, metaWindow);
            this._cloneAdapter?.addClone(windowId, metaWindow, wsId);

            const wasMaximized = metaWindow.maximized_horizontally || metaWindow.maximized_vertically;
            if (wasMaximized) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            const oldScrollX = this._world.viewport.scrollX;

            let update = addWindow(this._world, windowId, wasMaximized ? 2 : 1);
            this._world = update.world;

            if (metaWindow.fullscreen) {
                update = enterFullscreen(this._world, windowId);
                this._world = update.world;
                this._cloneAdapter?.setWindowFullscreen(windowId, true);
                this._windowAdapter?.setWindowFullscreen(windowId, true);
            }

            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);
            this._applyLayout(update.layout, false);

            if (update.layout.scrollX !== oldScrollX) {
                this._cloneAdapter?.setScroll(oldScrollX);
                this._cloneAdapter?.animateViewport(update.layout.scrollX);
            }

            this._focusWindow(this._world.focusedWindow);
            this._settlementRetry?.start();
        } catch (e) {
            console.error('[PaperFlow] Error handling window ready:', e);
        }
    }

    private _handleWindowDestroyed(windowId: WindowId): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowDestroyed')) return;

            console.log(`[PaperFlow] window removed: ${windowId}`);

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = removeWindow(this._world, windowId);
            this._world = update.world;

            this._cloneAdapter?.removeClone(windowId);
            this._windowAdapter?.untrack(windowId);
            this._focusAdapter?.untrack(windowId);
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
        } catch (e) {
            console.error('[PaperFlow] Error handling window destroyed:', e);
        }
    }

    private _handleFullscreenChanged(windowId: WindowId, isFullscreen: boolean): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('fullscreenChanged')) return;

            console.log(`[PaperFlow] fullscreen changed: ${windowId} → ${isFullscreen}`);

            const update = isFullscreen
                ? enterFullscreen(this._world, windowId)
                : exitFullscreen(this._world, windowId);
            this._world = update.world;

            this._cloneAdapter?.setWindowFullscreen(windowId, isFullscreen);
            this._windowAdapter?.setWindowFullscreen(windowId, isFullscreen);

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
        } catch (e) {
            console.error('[PaperFlow] Error handling fullscreen change:', e);
        }
    }

    private _handleWindowMaximized(windowId: WindowId): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowMaximized')) return;

            console.log(`[PaperFlow] window maximized: ${windowId} → widening to 2-slot`);

            const metaWindow = this._focusAdapter?.getMetaWindow(windowId) as Meta.Window | undefined;
            if (metaWindow) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            const update = widenWindow(this._world, windowId);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
            this._settlementRetry?.start();
        } catch (e) {
            console.error('[PaperFlow] Error handling window maximized:', e);
        }
    }

    private _applyLayout(layout: import('../domain/types.js').LayoutState, animate: boolean, nudgeUnsettled: boolean = false): void {
        this._windowAdapter?.applyLayout(layout, nudgeUnsettled);
        this._cloneAdapter?.applyLayout(layout, animate);
    }

    private _focusWindow(windowId: WindowId | null): void {
        if (!windowId) return;
        this._internalFocusChange = true;
        this._focusAdapter?.focus(windowId);
        this._internalFocusChange = false;
    }

    private _handleExternalFocus(windowId: WindowId): void {
        try {
            if (this._internalFocusChange) return;
            if (!this._world) return;
            if (!this._guard?.check('externalFocus')) return;
            if (this._world.focusedWindow === windowId) return;

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = setFocus(this._world, windowId);
            this._world = update.world;

            const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
        } catch (e) {
            console.error('[PaperFlow] Error handling external focus:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('monitorChange')) return;

            console.log('[PaperFlow] monitors changed');

            const update = updateMonitor(this._world, monitor);
            this._world = update.world;

            this._cloneAdapter?.updateWorkArea(monitor.workAreaY, monitor.totalHeight);
            this._windowAdapter?.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter?.setMonitorWidth(monitor.totalWidth);

            this._applyLayout(update.layout, false);
        } catch (e) {
            console.error('[PaperFlow] Error handling monitor change:', e);
        }
    }
}
