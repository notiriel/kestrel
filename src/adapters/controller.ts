import type { WindowId, WorkspaceId, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, setFocus, updateMonitor, updateConfig, buildUpdate, enterFullscreen, exitFullscreen, widenWindow, findWorkspaceIdForWindow, wsIdAt, renameCurrentWorkspace, findWorkspaceByName, switchToWorkspace } from '../domain/world.js';
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
import { StatusOverlayAdapter } from './status-overlay-adapter.js';
import { PanelIndicatorAdapter } from './panel-indicator-adapter.js';
import { NotificationOverlayAdapter } from './notification-overlay-adapter.js';
import { KestrelDBusService } from './dbus-service.js';
import { NotificationFocusMode } from './notification-focus-mode.js';
import { safeWindow } from './safe-window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

export class KestrelController {
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
    private _statusOverlay: StatusOverlayAdapter | null = null;
    private _panelIndicator: import('./panel-indicator-adapter.js').PanelIndicatorAdapter | null = null;
    private _notificationOverlay: import('./notification-overlay-adapter.js').NotificationOverlayAdapter | null = null;
    private _dbusService: KestrelDBusService | null = null;
    private _notificationFocusMode: NotificationFocusMode | null = null;
    private _extensionPath: string;
    private _debugMode: boolean = false;
    private _internalFocusChange: boolean = false;
    private _overviewDismissTimeout: ReturnType<typeof setTimeout> | null = null;
    private _settingsChangedId: number = 0;

    constructor(settings: Gio.Settings, ports?: Partial<ControllerPorts>, extensionPath?: string) {
        this._settings = settings;
        this._ports = ports ?? {};
        this._extensionPath = extensionPath ?? '';
        this._statePersistence = this._ports.statePersistence ?? new StatePersistence(settings);
    }

    enable(): void {
        try {
            console.log('[Kestrel] enabling...');

            // Read debug mode from settings
            this._debugMode = this._settings.get_boolean('debug-mode');

            if (this._debugMode) {
                // Enable DBus Eval for development (gdbus call org.gnome.Shell.Eval)
                (global as any).context.unsafe_mode = true;
                // Expose controller on global for DBus debugging
                (global as any)._kestrel = this;
            }

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
            this._cloneAdapter.init(monitor.workAreaY, monitor.totalHeight, config);
            this._cloneAdapter.syncWorkspaces(this._world.workspaces);

            this._windowAdapter = this._ports.window ?? new WindowAdapter();
            this._windowAdapter.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter.setMonitorBounds(monitor.stageOffsetX, monitor.totalWidth);
            this._focusAdapter = this._ports.focus ?? new FocusAdapter();
            this._shellAdapter = this._ports.shell ?? new ShellAdapter();

            // Status overlay for Claude session indicators
            this._statusOverlay = new StatusOverlayAdapter();
            const layer = (this._cloneAdapter as CloneAdapter).getLayer?.();
            if (layer) {
                this._statusOverlay.init(layer, `${this._extensionPath}/data`);
            }

            // Panel indicator in top bar
            this._panelIndicator = new PanelIndicatorAdapter();
            this._panelIndicator.init((wsIndex) => {
                try {
                    if (!this._world) return;
                    const oldScrollX = this._world.viewport.scrollX;
                    const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);
                    const update = switchToWorkspace(this._world, wsIndex);
                    this._setWorld(update.world);
                    const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
                    if (newWsId && newWsId !== oldWsId) {
                        this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
                    }
                    this._applyLayout(update.layout, true);
                    this._focusWindow(update.world.focusedWindow);
                } catch (e) {
                    console.error('[Kestrel] Error switching workspace from panel:', e);
                }
            });

            // Notification overlay for Claude permission requests
            this._notificationOverlay = new NotificationOverlayAdapter();
            this._notificationOverlay.init({
                onVisitSession: (sessionId) => {
                    const wid = this._statusOverlay?.getWindowForSession(sessionId) ?? null;
                    if (!wid || !this._world) return;
                    const oldScrollX = this._world.viewport.scrollX;
                    const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);
                    const update = setFocus(this._world, wid);
                    this._setWorld(update.world);
                    const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
                    if (newWsId && newWsId !== oldWsId) {
                        this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
                    }
                    this._applyLayout(update.layout, true);
                    this._focusWindow(wid);
                },
            });

            // Export DBus service for hook scripts
            this._dbusService = new KestrelDBusService({
                handleNotification: (payload) => this.handleNotification(payload),
                handlePermissionRequest: (payload) => this.handlePermissionRequest(payload),
                setWindowStatus: (sessionId, status) => this.setWindowStatus(sessionId, status),
                getNotificationResponse: (id) => this.getNotificationResponse(id),
            });

            // Notification focus mode (Super+.)
            this._notificationFocusMode = new NotificationFocusMode({
                getPendingEntries: () => this._notificationOverlay?.getPendingEntries() ?? [],
                getWindowForSession: (sid) => this._statusOverlay?.getWindowForSession(sid) ?? null,
                getMetaWindow: (wid) => this._focusAdapter?.getMetaWindow(wid) as Meta.Window | undefined,
                respondToEntry: (id, action) => this._notificationOverlay?.respond(id, action),
                visitSession: (sessionId) => {
                    const wid = this._statusOverlay?.getWindowForSession(sessionId) ?? null;
                    if (!wid || !this._world) return;
                    const oldScrollX = this._world.viewport.scrollX;
                    const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);
                    const update = setFocus(this._world, wid);
                    this._setWorld(update.world);
                    const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
                    if (newWsId && newWsId !== oldWsId) {
                        this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
                    }
                    this._applyLayout(update.layout, true);
                    this._focusWindow(wid);
                },
                getMonitor: () => {
                    const m = this._world?.monitor;
                    return {
                        x: m?.stageOffsetX ?? 0,
                        y: m?.workAreaY ?? 0,
                        width: m?.totalWidth ?? 1920,
                        height: m?.totalHeight ?? 1080,
                    };
                },
                isOverviewActive: () => this._overviewHandler?.isActive ?? false,
                registerEntriesChanged: (cb) => {
                    if (this._notificationOverlay) {
                        this._notificationOverlay.onEntriesChanged = cb;
                    }
                },
                unregisterEntriesChanged: () => {
                    if (this._notificationOverlay) {
                        this._notificationOverlay.onEntriesChanged = null;
                    }
                },
                // Question support
                getQuestionState: (id) => this._notificationOverlay?.getQuestionState(id) ?? null,
                questionNavigate: (id, delta) => this._notificationOverlay?.questionNavigate(id, delta),
                questionSelectOption: (id, qi, oi) => this._notificationOverlay?.questionSelectOption(id, qi, oi),
                questionSend: (id) => this._notificationOverlay?.questionSend(id),
                questionDismiss: (id) => this._notificationOverlay?.questionDismiss(id),
                questionVisit: (id) => this._notificationOverlay?.questionVisit(id),
            });

            // 5. Create collaborators
            this._overviewHandler = new OverviewHandler({
                getWorld: () => this._world,
                setWorld: (w) => { this._setWorld(w); },
                focusWindow: (id) => this._focusWindow(id),
                getCloneAdapter: () => this._cloneAdapter,
                getWindowAdapter: () => this._windowAdapter,
                createOverviewInputAdapter: () => new OverviewInputAdapter(),
                notifyOverviewEnter: (transform) => {
                    const positions = (this._cloneAdapter as CloneAdapter)?.getClonePositions?.();
                    if (positions) {
                        this._statusOverlay?.enterOverview(transform, positions);
                    }
                },
                notifyOverviewExit: () => {
                    this._statusOverlay?.exitOverview();
                },
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
                setWorld: (w) => { this._setWorld(w); },
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
                onNewWindow: () => this._handleNewWindow(),
                onToggleNotifications: () => this._notificationFocusMode?.toggle(),
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
                    this._log(`[Kestrel] float window added: ${windowId} title="${rawMetaWindow.get_title()}"`);
                    this._cloneAdapter?.addFloatClone(windowId, safeWindow(rawMetaWindow));
                },
                onFloatWindowDestroyed: (windowId: WindowId) => {
                    this._log(`[Kestrel] float window removed: ${windowId}`);
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
                this._setWorld(restored);
                this._cloneAdapter.syncWorkspaces(this._world.workspaces);
            }
            this._windowEventAdapter.enumerateExisting();

            // Dismiss GNOME overview if it's showing (e.g. on login).
            // Use a delay because GNOME may show the overview after enable() runs.
            this._overviewDismissTimeout = setTimeout(() => {
                this._overviewDismissTimeout = null;
                this._shellAdapter?.hideOverview();
            }, 1000);

            // 12. Live settings reload
            this._settingsChangedId = this._settings.connect('changed', (_settings: Gio.Settings, key: string) => {
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

            if (this._world) {
                this._statePersistence.save(this._world);
            }

            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }

            if (this._overviewDismissTimeout !== null) {
                clearTimeout(this._overviewDismissTimeout);
                this._overviewDismissTimeout = null;
            }

            this._dbusService?.destroy();
            this._dbusService = null;

            this._shellAdapter?.destroy();
            this._shellAdapter = null;

            this._settlementRetry?.destroy();
            this._settlementRetry = null;

            this._notificationFocusMode?.destroy();
            this._notificationFocusMode = null;

            this._notificationOverlay?.destroy();
            this._notificationOverlay = null;

            this._panelIndicator?.destroy();
            this._panelIndicator = null;

            this._statusOverlay?.destroy();
            this._statusOverlay = null;

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
            if (this._debugMode) {
                (global as any)._kestrel = null;
                (global as any).context.unsafe_mode = false;
            }

            console.log('[Kestrel] disabled');
        } catch (e) {
            console.error('[Kestrel] Failed to disable:', e);
        }
    }

    /** Set Claude session status for a window. Called via DBus from hook scripts. */
    setWindowStatus(sessionId: string, status: string): void {
        this._statusOverlay?.setWindowStatus(sessionId, status);
        if (this._world) {
            this._panelIndicator?.update(this._world, this._statusOverlay ?? undefined);
        }
    }

    private _log(msg: string): void {
        if (this._debugMode) console.log(msg);
    }

    private _onSettingChanged(key: string): void {
        if (key === 'saved-state' || key === 'debug-mode') return;
        if (!this._world) return;

        this._log(`[Kestrel] setting changed: ${key}`);

        const config = this._statePersistence.readConfig();
        const update = updateConfig(this._world, config);
        this._setWorld(update.world);

        this._cloneAdapter?.updateConfig?.(config);
        this._applyLayout(update.layout, true);
    }

    /** Centralized world state setter — updates panel indicator after every change. */
    private _setWorld(world: World): void {
        this._world = world;
        this._panelIndicator?.update(world, this._statusOverlay ?? undefined);
    }

    /** Serializable snapshot for DBus debugging: global._kestrel.debugState() */
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
                    name: ws.name,
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

    /** Rename current workspace. Called via DBus. */
    renameCurrentWorkspace(name: string): string {
        try {
            if (!this._world) return '{"error":"no world"}';
            this._setWorld(renameCurrentWorkspace(this._world, name || null));
            return '{"ok":true}';
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Switch to workspace by name. Called via DBus. */
    switchToWorkspaceByName(name: string): string {
        try {
            if (!this._world) return '{"error":"no world"}';
            const wsIndex = findWorkspaceByName(this._world, name);
            if (wsIndex === -1) return '{"error":"workspace not found"}';

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = switchToWorkspace(this._world, wsIndex);
            this._setWorld(update.world);

            const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
            this._focusWindow(update.world.focusedWindow);
            return '{"ok":true}';
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** List all non-empty workspaces with metadata. Called via DBus. */
    listWorkspaces(): string {
        try {
            if (!this._world) return '{"error":"no world"}';
            const result = this._world.workspaces
                .map((ws, i) => ({
                    index: i,
                    name: ws.name,
                    windowCount: ws.windows.length,
                    isCurrent: i === this._world!.viewport.workspaceIndex,
                    claudeStatus: this._getWorkspaceClaudeStatus(i),
                }))
                .filter(ws => ws.windowCount > 0);
            return JSON.stringify(result);
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Handle incoming permission request from Claude hook. Called via DBus. */
    handlePermissionRequest(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            payload.workspace_name = this._workspaceNameForSession(String(payload.session_id ?? ''));
            const id = `notif-${GLib.uuid_string_random()}`;

            // Route AskUserQuestion to question card
            if (payload.tool_name === 'AskUserQuestion' && payload.tool_input?.questions) {
                payload.questions = payload.tool_input.questions;
                const qCount = Array.isArray(payload.tool_input.questions) ? payload.tool_input.questions.length : 0;
                payload.title = `Claude asks ${qCount} question${qCount !== 1 ? 's' : ''}`;
                payload.message = 'Session wants your input';
                this._notificationOverlay?.showQuestion(id, payload);
            } else {
                this._notificationOverlay?.showPermission(id, payload);
            }

            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Handle incoming notification from Claude hook. Called via DBus. */
    handleNotification(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            payload.workspace_name = this._workspaceNameForSession(String(payload.session_id ?? ''));
            const id = `notif-${GLib.uuid_string_random()}`;
            this._notificationOverlay?.showNotification(id, payload);
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Get notification response (for hook polling). Called via DBus. */
    getNotificationResponse(id: string): string {
        try {
            const response = this._notificationOverlay?.getResponse(id);
            if (!response) return '{"pending":true}';

            // Question cards respond with 'allow:{"0":["opt"]}' — parse the answers
            if (response.startsWith('allow:')) {
                const answersJson = response.slice(6);
                try {
                    const answers = JSON.parse(answersJson);
                    return JSON.stringify({ action: 'allow', answers });
                } catch {
                    return JSON.stringify({ action: 'allow' });
                }
            }

            return JSON.stringify({ action: response });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Get the workspace name for a given Claude session, or null if unknown. */
    private _workspaceNameForSession(sessionId: string): string | null {
        if (!this._world || !this._statusOverlay) return null;
        const windowId = this._statusOverlay.getWindowForSession(sessionId);
        if (!windowId) return null;
        for (let i = 0; i < this._world.workspaces.length; i++) {
            if (this._world.workspaces[i].windows.some(w => w.id === windowId)) {
                return this._world.workspaces[i].name ?? null;
            }
        }
        return null;
    }

    /** Get aggregate Claude status for a workspace. */
    private _getWorkspaceClaudeStatus(wsIndex: number): string | null {
        if (!this._world || !this._statusOverlay) return null;
        const ws = this._world.workspaces[wsIndex];
        if (!ws) return null;

        const statusMap = this._statusOverlay.getWindowStatusMap();
        let best: string | null = null;
        const priority: Record<string, number> = { 'needs-input': 3, 'working': 2, 'done': 1 };

        for (const win of ws.windows) {
            const status = statusMap.get(win.id);
            if (status && (priority[status] ?? 0) > (priority[best ?? ''] ?? 0)) {
                best = status;
            }
        }
        return best;
    }

    private _handleWindowReady(windowId: WindowId, rawMetaWindow: Meta.Window): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowReady')) return;

            this._log(`[Kestrel] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);

            this._statusOverlay?.watchWindow(windowId, rawMetaWindow);

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
            this._setWorld(update.world);

            if (metaWindow.fullscreen) {
                update = enterFullscreen(this._world!, windowId);
                this._setWorld(update.world);
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
            console.error('[Kestrel] Error handling window ready:', e);
        }
    }

    private _handleWindowDestroyed(windowId: WindowId): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowDestroyed')) return;

            this._log(`[Kestrel] window removed: ${windowId}`);

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = removeWindow(this._world, windowId);
            this._setWorld(update.world);

            this._cloneAdapter?.removeClone(windowId);
            this._windowAdapter?.untrack(windowId);
            this._focusAdapter?.untrack(windowId);
            this._statusOverlay?.unwatchWindow(windowId);
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
        } catch (e) {
            console.error('[Kestrel] Error handling window destroyed:', e);
        }
    }

    private _handleFullscreenChanged(windowId: WindowId, isFullscreen: boolean): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('fullscreenChanged')) return;

            this._log(`[Kestrel] fullscreen changed: ${windowId} → ${isFullscreen}`);

            const update = isFullscreen
                ? enterFullscreen(this._world, windowId)
                : exitFullscreen(this._world, windowId);
            this._setWorld(update.world);

            this._cloneAdapter?.setWindowFullscreen(windowId, isFullscreen);
            this._windowAdapter?.setWindowFullscreen(windowId, isFullscreen);

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
        } catch (e) {
            console.error('[Kestrel] Error handling fullscreen change:', e);
        }
    }

    private _handleWindowMaximized(windowId: WindowId): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowMaximized')) return;

            this._log(`[Kestrel] window maximized: ${windowId} → widening to 2-slot`);

            const metaWindow = this._focusAdapter?.getMetaWindow(windowId) as Meta.Window | undefined;
            if (metaWindow) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            const update = widenWindow(this._world, windowId);
            this._setWorld(update.world);

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
            this._settlementRetry?.start();
        } catch (e) {
            console.error('[Kestrel] Error handling window maximized:', e);
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
            this._setWorld(update.world);

            const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
        } catch (e) {
            console.error('[Kestrel] Error handling external focus:', e);
        }
    }

    private _handleNewWindow(): void {
        try {
            if (!this._world) return;
            const focusedWindow = this._world.focusedWindow;
            if (!focusedWindow) return;
            this._focusAdapter?.openNewWindow(focusedWindow);
        } catch (e) {
            console.error('[Kestrel] Error opening new window:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('monitorChange')) return;

            this._log('[Kestrel] monitors changed');

            const update = updateMonitor(this._world, monitor);
            this._setWorld(update.world);

            this._cloneAdapter?.updateWorkArea(monitor.workAreaY, monitor.totalHeight);
            this._windowAdapter?.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter?.setMonitorBounds(monitor.stageOffsetX, monitor.totalWidth);

            this._applyLayout(update.layout, false);
        } catch (e) {
            console.error('[Kestrel] Error handling monitor change:', e);
        }
    }
}
