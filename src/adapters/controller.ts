import type { WindowId, WorkspaceId, PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, setFocus, updateMonitor, buildUpdate, enterFullscreen, exitFullscreen, widenWindow, restoreWorld } from '../domain/world.js';
import type { RestoreWorkspaceData } from '../domain/world.js';
import { createTiledWindow } from '../domain/window.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
import { moveLeft, moveRight, moveDown, moveUp, toggleSize } from '../domain/window-operations.js';
import { enterOverview, exitOverview, cancelOverview } from '../domain/overview.js';
import { computeLayout, computeLayoutForWorkspace } from '../domain/layout.js';
import { MonitorAdapter } from './monitor-adapter.js';
import { WindowEventAdapter, shouldTile } from './window-event-adapter.js';
import { CloneAdapter } from './clone-adapter.js';
import { WindowAdapter } from './window-adapter.js';
import { FocusAdapter } from './focus-adapter.js';
import { KeybindingAdapter } from './keybinding-adapter.js';
import { OverviewInputAdapter } from './overview-input-adapter.js';
import type { OverviewTransform } from './clone-adapter.js';
import { ConflictDetector } from './conflict-detector.js';
import { ReconciliationGuard } from './reconciliation-guard.js';
import { safeWindow } from './safe-window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

export class PaperFlowController {
    private _settings: Gio.Settings;
    private _world: World | null = null;
    private _monitorAdapter: MonitorAdapter | null = null;
    private _windowEventAdapter: WindowEventAdapter | null = null;
    private _cloneAdapter: CloneAdapter | null = null;
    private _windowAdapter: WindowAdapter | null = null;
    private _focusAdapter: FocusAdapter | null = null;
    private _keybindingAdapter: KeybindingAdapter | null = null;
    private _overviewInputAdapter: OverviewInputAdapter | null = null;
    private _conflictDetector: ConflictDetector | null = null;
    private _guard: ReconciliationGuard | null = null;
    /** State saved when entering overview, for Escape restore. */
    private _preOverviewState: { focusedWindow: WindowId | null; viewport: { workspaceIndex: number; scrollX: number } } | null = null;
    private _overviewTransform: OverviewTransform | null = null;
    private _internalFocusChange: boolean = false;
    private _wmDestroyId: number | null = null;
    private _wmMinimizeId: number | null = null;
    private _wmUnminimizeId: number | null = null;
    private _settlementTimerId: number | null = null;
    private _settlementStep: number = 0;
    private _animationTimerId: number | null = null;

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    enable(): void {
        try {
            console.log('[PaperFlow] enabling...');

            // Enable DBus Eval for development (gdbus call org.gnome.Shell.Eval)
            (global as any).context.unsafe_mode = true;

            // Expose controller on global for DBus debugging
            (global as any)._paperflow = this;

            // 0. Check for conflicting extensions
            this._conflictDetector = new ConflictDetector();
            this._conflictDetector.detectConflicts();

            this._guard = new ReconciliationGuard();

            // 1. Read config
            const config = this._readConfig();

            // 2. Init monitor adapter and read monitors
            this._monitorAdapter = new MonitorAdapter();
            const monitor = this._monitorAdapter.readPrimaryMonitor();

            // 3. Create domain world
            this._world = createWorld(config, monitor);

            // 4. Create adapters
            this._cloneAdapter = new CloneAdapter();
            this._cloneAdapter.init(monitor.workAreaY, monitor.totalHeight);
            this._cloneAdapter.syncWorkspaces(this._world.workspaces);

            this._windowAdapter = new WindowAdapter();
            this._windowAdapter.setWorkAreaY(monitor.workAreaY);
            this._windowAdapter.setMonitorWidth(monitor.totalWidth);
            this._focusAdapter = new FocusAdapter();

            // 5. Connect keybindings
            this._keybindingAdapter = new KeybindingAdapter();
            this._keybindingAdapter.connect(this._settings, {
                onFocusRight: () => this._handleFocusRight(),
                onFocusLeft: () => this._handleFocusLeft(),
                onFocusDown: () => this._handleFocusDown(),
                onFocusUp: () => this._handleFocusUp(),
                onMoveLeft: () => this._handleMoveLeft(),
                onMoveRight: () => this._handleMoveRight(),
                onMoveDown: () => this._handleMoveDown(),
                onMoveUp: () => this._handleMoveUp(),
                onToggleSize: () => this._handleToggleSize(),
                onToggleOverview: () => this._handleToggleOverview(),
            });

            // 6. Connect external focus changes (click-to-focus)
            this._focusAdapter.connectFocusChanged((windowId: WindowId) => {
                this._handleExternalFocus(windowId);
            });

            // 7. Connect monitor changes
            this._monitorAdapter.connectMonitorsChanged((info: MonitorInfo) => {
                this._handleMonitorChange(info);
            });

            // 8. Connect window signals
            this._windowEventAdapter = new WindowEventAdapter();
            this._windowEventAdapter.connect({
                onWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => {
                    this._handleWindowReady(windowId, metaWindow);
                },
                onWindowDestroyed: (windowId: WindowId) => {
                    this._handleWindowDestroyed(windowId);
                },
                onFloatWindowReady: (windowId: WindowId, rawMetaWindow: Meta.Window) => {
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

            // 9. Skip GNOME's window close and minimize animations — actors
            //    are hidden/cloned anyway, and delayed effects cause stale state.
            this._wmDestroyId = global.window_manager.connect('destroy',
                (shellWm: any, actor: Meta.WindowActor) => {
                    try {
                        shellWm.completed_destroy(actor);
                    } catch (e) {
                        console.error('[PaperFlow] Error completing destroy:', e);
                    }
                },
            );

            this._wmMinimizeId = global.window_manager.connect('minimize',
                (shellWm: any, actor: Meta.WindowActor) => {
                    try {
                        shellWm.completed_minimize(actor);
                    } catch (e) {
                        console.error('[PaperFlow] Error completing minimize:', e);
                    }
                },
            );

            this._wmUnminimizeId = global.window_manager.connect('unminimize',
                (shellWm: any, actor: Meta.WindowActor) => {
                    try {
                        shellWm.completed_unminimize(actor);
                    } catch (e) {
                        console.error('[PaperFlow] Error completing unminimize:', e);
                    }
                },
            );

            // 10. Try restoring saved state, then enumerate existing windows.
            // If restored, enumerateExisting will detect windows already in domain
            // and only set up adapter tracking (no duplicate addWindow).
            this._tryRestoreState(config, monitor);
            this._windowEventAdapter.enumerateExisting();

            console.log('[PaperFlow] enabled');
        } catch (e) {
            console.error('[PaperFlow] Failed to enable:', e);
        }
    }

    disable(): void {
        try {
            console.log('[PaperFlow] disabling...');

            // Save world state before teardown (survives screen lock disable/enable)
            this._saveState();

            // Reverse order
            if (this._wmDestroyId !== null) {
                global.window_manager.disconnect(this._wmDestroyId);
                this._wmDestroyId = null;
            }
            if (this._wmMinimizeId !== null) {
                global.window_manager.disconnect(this._wmMinimizeId);
                this._wmMinimizeId = null;
            }
            if (this._wmUnminimizeId !== null) {
                global.window_manager.disconnect(this._wmUnminimizeId);
                this._wmUnminimizeId = null;
            }

            if (this._settlementTimerId !== null) {
                GLib.source_remove(this._settlementTimerId);
                this._settlementTimerId = null;
            }
            if (this._animationTimerId !== null) {
                GLib.source_remove(this._animationTimerId);
                this._animationTimerId = null;
            }

            this._windowEventAdapter?.destroy();
            this._windowEventAdapter = null;

            this._overviewInputAdapter?.destroy();
            this._overviewInputAdapter = null;

            this._keybindingAdapter?.destroy();
            this._keybindingAdapter = null;

            this._monitorAdapter?.destroy();
            this._monitorAdapter = null;

            this._windowAdapter?.showAll();
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

    private _saveState(): void {
        try {
            if (!this._world) return;
            const state = {
                version: 1,
                workspaces: this._world.workspaces.map(ws => ({
                    windowIds: ws.windows.map(w => w.id),
                    slotSpans: ws.windows.map(w => w.slotSpan),
                })),
                focusedWindow: this._world.focusedWindow,
                viewportWorkspaceIndex: this._world.viewport.workspaceIndex,
                viewportScrollX: this._world.viewport.scrollX,
            };
            this._settings.set_string('saved-state', JSON.stringify(state));
            console.log(`[PaperFlow] saved state: ${state.workspaces.length} workspaces`);
        } catch (e) {
            console.error('[PaperFlow] Error saving state:', e);
        }
    }

    /**
     * Try to restore world from saved state. Returns true if restore succeeded.
     * Sets `this._world` to the restored domain world before `enumerateExisting`
     * runs — `_handleWindowReady` will detect windows already in the domain
     * and only do adapter tracking (no duplicate `addWindow`).
     */
    private _tryRestoreState(config: PaperFlowConfig, monitor: MonitorInfo): boolean {
        try {
            const json = this._settings.get_string('saved-state');
            if (!json) return false;

            // Clear saved state immediately to avoid stale restores
            this._settings.set_string('saved-state', '');

            const state = JSON.parse(json);
            if (state.version !== 1) return false;

            // Enumerate currently existing windows for matching
            const actors = global.get_window_actors();
            const existingWindowIds = new Set<string>();
            for (const actor of actors) {
                try {
                    const metaWindow = (actor as Meta.WindowActor).get_meta_window();
                    if (!metaWindow) continue;
                    existingWindowIds.add(String(metaWindow.get_stable_sequence()));
                } catch { /* skip */ }
            }

            // Build workspace data from saved state, matching by WindowId
            const workspaceData: RestoreWorkspaceData[] = [];

            for (const savedWs of state.workspaces) {
                const windows = [];
                for (let i = 0; i < savedWs.windowIds.length; i++) {
                    const id = savedWs.windowIds[i] as WindowId;
                    const slotSpan = (savedWs.slotSpans[i] ?? 1) as 1 | 2;
                    if (existingWindowIds.has(id)) {
                        windows.push(createTiledWindow(id, slotSpan));
                    }
                    // Saved window not found → skip (closed while locked)
                }
                workspaceData.push({ windows });
            }

            // Restore the domain world — _handleWindowReady will detect
            // existing windows and skip addWindow for them
            this._world = restoreWorld(
                config, monitor,
                workspaceData,
                state.viewportWorkspaceIndex ?? 0,
                state.viewportScrollX ?? 0,
                (state.focusedWindow as WindowId) ?? null,
            );

            this._cloneAdapter?.syncWorkspaces(this._world.workspaces);

            console.log(`[PaperFlow] restored state: ${this._world.workspaces.length} workspaces`);
            return true;
        } catch (e) {
            console.error('[PaperFlow] Error restoring state:', e);
            return false;
        }
    }

    private _readConfig(): PaperFlowConfig {
        return {
            gapSize: this._settings.get_int('gap-size'),
            edgeGap: this._settings.get_int('edge-gap'),
            focusBorderWidth: 3,
        };
    }

    /** Find which workspace contains a given window and return its ID. */
    private _findWorkspaceIdForWindow(world: World, windowId: WindowId): WorkspaceId | null {
        for (const ws of world.workspaces) {
            if (ws.windows.some(w => w.id === windowId)) {
                return ws.id;
            }
        }
        return null;
    }

    /** Get the workspace ID at a given viewport index. */
    private _wsIdAt(world: World, index: number): WorkspaceId | null {
        return world.workspaces[index]?.id ?? null;
    }

    private _handleWindowReady(windowId: WindowId, rawMetaWindow: Meta.Window): void {
        try {
            if (!this._world) return;
            if (!this._guard?.check('windowReady')) return;

            console.log(`[PaperFlow] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);

            // Wrap in safety proxy — all downstream adapters get a proxy that
            // throws JS errors instead of native SIGSEGV on dead GObjects.
            const metaWindow = safeWindow(rawMetaWindow);

            // Check if the window already exists in the domain (restored from saved state)
            const existsInDomain = this._world.workspaces.some(
                ws => ws.windows.some(w => w.id === windowId),
            );

            if (existsInDomain) {
                // Window was restored — only set up adapter tracking, don't re-add to domain
                // Unmaximize if needed so PaperFlow can control size
                if (metaWindow.maximized_horizontally || metaWindow.maximized_vertically) {
                    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                }
                const restoredWsId = this._findWorkspaceIdForWindow(this._world, windowId)!;
                this._windowAdapter?.track(windowId, metaWindow);
                this._focusAdapter?.track(windowId, metaWindow);
                this._cloneAdapter?.addClone(windowId, metaWindow, restoredWsId);

                // Apply current layout to position the restored window
                const layout = computeLayout(this._world);
                this._applyLayout(layout, false);
                this._focusWindow(this._world.focusedWindow);
                this._startSettlementRetry();
                return;
            }

            // Track in adapters — clone goes to the current workspace's scroll container
            const wsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex)!;
            this._windowAdapter?.track(windowId, metaWindow);
            this._focusAdapter?.track(windowId, metaWindow);
            this._cloneAdapter?.addClone(windowId, metaWindow, wsId);

            // Detect windows that started maximized — treat as 2-slot
            const wasMaximized = metaWindow.maximized_horizontally || metaWindow.maximized_vertically;
            if (wasMaximized) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            // Save old scroll position for viewport animation
            const oldScrollX = this._world.viewport.scrollX;

            // Update domain
            let update = addWindow(this._world, windowId, wasMaximized ? 2 : 1);
            this._world = update.world;

            // If the window is already fullscreen at creation time, enter fullscreen
            if (metaWindow.fullscreen) {
                update = enterFullscreen(this._world, windowId);
                this._world = update.world;
                this._cloneAdapter?.setWindowFullscreen(windowId, true);
                this._windowAdapter?.setWindowFullscreen(windowId, true);
            }

            // Sync workspace containers (ensureTrailingEmpty may have added one)
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            // Apply layout — snap all positions immediately
            this._applyLayout(update.layout, false);

            // Animate viewport from old scroll position to new
            if (update.layout.scrollX !== oldScrollX) {
                this._cloneAdapter?.setScroll(oldScrollX);
                this._cloneAdapter?.animateViewport(update.layout.scrollX);

                // Hide real windows during scroll animation
                this._windowAdapter?.hideActors();
                if (this._animationTimerId !== null) {
                    GLib.source_remove(this._animationTimerId);
                }
                this._animationTimerId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    PaperFlowController.ANIMATION_DURATION,
                    () => {
                        this._animationTimerId = null;
                        this._windowAdapter?.showActors();
                        return GLib.SOURCE_REMOVE;
                    },
                );
            }

            this._focusWindow(this._world.focusedWindow);

            // Start settlement retry: some apps (e.g. Chromium) don't
            // process the Wayland configure immediately, so their frame rect
            // is still at default size during the initial applyLayout.
            // Retry with backoff until the window settles to target size.
            this._startSettlementRetry();

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
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            // Update domain — prunes empty workspaces, navigates if needed
            const update = removeWindow(this._world, windowId);
            this._world = update.world;

            // Remove dead clone, then reconcile containers to match domain
            this._cloneAdapter?.removeClone(windowId);
            this._windowAdapter?.untrack(windowId);
            this._focusAdapter?.untrack(windowId);
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            // If workspace changed, sync scroll before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
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

            // Update clone and window adapters
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

            // Find the Meta.Window to unmaximize it
            const metaWindow = this._focusAdapter?.getMetaWindow(windowId);
            if (metaWindow) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            // Widen to 2-slot in domain
            const update = widenWindow(this._world, windowId);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);
            this._startSettlementRetry();
        } catch (e) {
            console.error('[PaperFlow] Error handling window maximized:', e);
        }
    }

    private _handleFocusRight(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('focusRight')) return;

            const update = focusRight(this._world);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus right:', e);
        }
    }

    private _handleFocusLeft(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('focusLeft')) return;

            const update = focusLeft(this._world);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus left:', e);
        }
    }

    private _handleFocusDown(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('focusDown')) return;

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = focusDown(this._world);
            this._world = update.world;

            // Sync arriving workspace's scroll to departing position before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus down:', e);
        }
    }

    private _handleFocusUp(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('focusUp')) return;

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = focusUp(this._world);
            this._world = update.world;

            // Sync arriving workspace's scroll to departing position before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus up:', e);
        }
    }

    private _handleMoveRight(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('moveRight')) return;

            const update = moveRight(this._world);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move right:', e);
        }
    }

    private _handleMoveLeft(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('moveLeft')) return;

            const update = moveLeft(this._world);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move left:', e);
        }
    }

    private _handleMoveDown(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('moveDown')) return;

            const oldScrollX = this._world.viewport.scrollX;
            const windowId = this._world.focusedWindow;
            const sourceWsIndex = this._world.viewport.workspaceIndex;
            const sourceWsId = this._wsIdAt(this._world, sourceWsIndex);

            const update = moveDown(this._world);
            this._world = update.world;

            // Reparent clone if window moved cross-workspace (detected by workspace ID)
            if (windowId && sourceWsId) {
                const targetWsId = this._findWorkspaceIdForWindow(update.world, windowId);
                if (targetWsId && targetWsId !== sourceWsId) {
                    this._cloneAdapter?.moveCloneToWorkspace(windowId, targetWsId);
                }
            }
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            // Sync arriving workspace's scroll before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== sourceWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);

            // Reposition remaining windows on source workspace so they close the gap.
            // Override workspaceIndex so applyLayout doesn't re-animate the workspace
            // strip back to the source workspace position.
            if (sourceWsId) {
                const sourceWsNewIndex = update.world.workspaces.findIndex(ws => ws.id === sourceWsId);
                if (sourceWsNewIndex >= 0) {
                    const sourceLayout = computeLayoutForWorkspace(update.world, sourceWsNewIndex);
                    this._cloneAdapter?.applyLayout(
                        { ...sourceLayout, workspaceIndex: update.world.viewport.workspaceIndex },
                        true,
                    );
                }
            }

            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move down:', e);
        }
    }

    private _handleMoveUp(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('moveUp')) return;

            const oldScrollX = this._world.viewport.scrollX;
            const windowId = this._world.focusedWindow;
            const sourceWsIndex = this._world.viewport.workspaceIndex;
            const sourceWsId = this._wsIdAt(this._world, sourceWsIndex);

            const update = moveUp(this._world);
            this._world = update.world;

            // Reparent clone if window moved cross-workspace (detected by workspace ID)
            if (windowId && sourceWsId) {
                const targetWsId = this._findWorkspaceIdForWindow(update.world, windowId);
                if (targetWsId && targetWsId !== sourceWsId) {
                    this._cloneAdapter?.moveCloneToWorkspace(windowId, targetWsId);
                }
            }
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            // Sync arriving workspace's scroll before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== sourceWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._applyLayout(update.layout, true);

            // Reposition remaining windows on source workspace so they close the gap.
            // Override workspaceIndex so applyLayout doesn't re-animate the workspace
            // strip back to the source workspace position.
            if (sourceWsId) {
                const sourceWsNewIndex = update.world.workspaces.findIndex(ws => ws.id === sourceWsId);
                if (sourceWsNewIndex >= 0) {
                    const sourceLayout = computeLayoutForWorkspace(update.world, sourceWsNewIndex);
                    this._cloneAdapter?.applyLayout(
                        { ...sourceLayout, workspaceIndex: update.world.viewport.workspaceIndex },
                        true,
                    );
                }
            }

            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move up:', e);
        }
    }

    private _handleToggleSize(): void {
        try {
            if (!this._world || this._world.overviewActive) return;
            if (!this._guard?.check('toggleSize')) return;

            const update = toggleSize(this._world);
            this._world = update.world;

            this._applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling toggle size:', e);
        }
    }

    private _handleToggleOverview(): void {
        try {
            if (!this._world) return;

            if (this._world.overviewActive) {
                // Super+M while in overview = confirm (same as Enter)
                this._handleOverviewConfirm();
            } else {
                this._enterOverview();
            }
        } catch (e) {
            console.error('[PaperFlow] Error handling toggle overview:', e);
        }
    }

    private _enterOverview(): void {
        if (!this._world) return;

        // Save pre-overview state for Escape restore
        this._preOverviewState = {
            focusedWindow: this._world.focusedWindow,
            viewport: {
                workspaceIndex: this._world.viewport.workspaceIndex,
                scrollX: this._world.viewport.scrollX,
            },
        };

        // Domain update
        const update = enterOverview(this._world);
        this._world = update.world;

        // Compute overview transform
        const numWorkspaces = this._world.workspaces.filter(ws => ws.windows.length > 0).length || 1;
        this._overviewTransform = this._computeOverviewTransform(numWorkspaces);

        // Visual: enter overview
        this._cloneAdapter?.enterOverview(this._overviewTransform, update.layout, numWorkspaces);

        // Activate modal input
        this._overviewInputAdapter = new OverviewInputAdapter();
        this._overviewInputAdapter.activate({
            onNavigate: (dir) => this._handleOverviewNavigate(dir),
            onConfirm: () => this._handleOverviewConfirm(),
            onCancel: () => this._handleOverviewCancel(),
            onClick: (x, y) => this._handleOverviewClick(x, y),
        });

        console.log('[PaperFlow] Entered overview');
    }

    private _handleOverviewNavigate(direction: 'left' | 'right' | 'up' | 'down'): void {
        try {
            if (!this._world || !this._overviewTransform) return;

            let update;
            switch (direction) {
                case 'left':
                    update = focusLeft(this._world);
                    break;
                case 'right':
                    update = focusRight(this._world);
                    break;
                case 'up':
                    update = focusUp(this._world);
                    break;
                case 'down':
                    update = focusDown(this._world);
                    break;
            }

            this._world = update.world;

            // Update focus indicator only — don't scroll or reposition
            this._cloneAdapter?.updateOverviewFocus(
                update.layout,
                update.world.viewport.workspaceIndex,
                this._overviewTransform,
            );
        } catch (e) {
            console.error('[PaperFlow] Error handling overview navigate:', e);
        }
    }

    private _handleOverviewConfirm(): void {
        try {
            if (!this._world) return;

            // Deactivate modal input first
            this._overviewInputAdapter?.deactivate();
            this._overviewInputAdapter = null;

            // Domain: exit overview (adjusts viewport to focused window)
            const update = exitOverview(this._world);
            this._world = update.world;

            // Visual: restore normal view
            this._cloneAdapter?.exitOverview(update.layout);

            // Hide real window actors during exit animation, show after
            this._windowAdapter?.hideActors();
            this._windowAdapter?.applyLayout(update.layout);
            if (this._animationTimerId !== null) {
                GLib.source_remove(this._animationTimerId);
            }
            this._animationTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                PaperFlowController.ANIMATION_DURATION,
                () => {
                    this._animationTimerId = null;
                    this._windowAdapter?.showActors();
                    this._windowAdapter?.refreshClips();
                    return GLib.SOURCE_REMOVE;
                },
            );

            // Activate the focused window
            this._focusWindow(this._world.focusedWindow);

            this._preOverviewState = null;
            this._overviewTransform = null;

            console.log('[PaperFlow] Exited overview (confirm)');
        } catch (e) {
            console.error('[PaperFlow] Error handling overview confirm:', e);
        }
    }

    private _handleOverviewCancel(): void {
        try {
            if (!this._world || !this._preOverviewState) return;

            // Deactivate modal input first
            this._overviewInputAdapter?.deactivate();
            this._overviewInputAdapter = null;

            // Domain: cancel overview (restores saved state)
            const update = cancelOverview(
                this._world,
                this._preOverviewState.focusedWindow,
                this._preOverviewState.viewport.workspaceIndex,
                this._preOverviewState.viewport.scrollX,
            );
            this._world = update.world;

            // Visual: restore normal view
            this._cloneAdapter?.exitOverview(update.layout);

            // Hide real window actors during exit animation, show after
            this._windowAdapter?.hideActors();
            this._windowAdapter?.applyLayout(update.layout);
            if (this._animationTimerId !== null) {
                GLib.source_remove(this._animationTimerId);
            }
            this._animationTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                PaperFlowController.ANIMATION_DURATION,
                () => {
                    this._animationTimerId = null;
                    this._windowAdapter?.showActors();
                    this._windowAdapter?.refreshClips();
                    return GLib.SOURCE_REMOVE;
                },
            );

            // Activate the restored focused window
            this._focusWindow(this._world.focusedWindow);

            this._preOverviewState = null;
            this._overviewTransform = null;

            console.log('[PaperFlow] Exited overview (cancel)');
        } catch (e) {
            console.error('[PaperFlow] Error handling overview cancel:', e);
        }
    }

    private _handleOverviewClick(x: number, y: number): void {
        try {
            if (!this._world || !this._overviewTransform) return;

            const { scale, offsetX, offsetY } = this._overviewTransform;
            const monitor = this._world.monitor;

            // Reverse-transform screen coordinates to layout coordinates
            const reverseX = (x - offsetX) / scale;
            const reverseY = (y - offsetY) / scale;

            // Determine which workspace row was clicked
            const wsIndex = Math.floor(reverseY / monitor.totalHeight);
            const nonEmptyCount = this._world.workspaces.filter(ws => ws.windows.length > 0).length;
            if (wsIndex < 0 || wsIndex >= nonEmptyCount) return;

            // Local Y within the workspace
            const localY = reverseY - wsIndex * monitor.totalHeight;

            // Compute layout for the clicked workspace to get window positions
            const wsLayout = computeLayoutForWorkspace(this._world, wsIndex);

            // Hit-test: find window containing the click point
            let hitWindowId: WindowId | null = null;
            for (const win of wsLayout.windows) {
                if (reverseX >= win.x && reverseX <= win.x + win.width &&
                    localY >= win.y && localY <= win.y + win.height) {
                    hitWindowId = win.windowId;
                    break;
                }
            }

            if (!hitWindowId) return; // Clicked empty space — ignore

            // Focus the clicked window and confirm
            const update = setFocus(this._world, hitWindowId);
            this._world = update.world;
            this._handleOverviewConfirm();
        } catch (e) {
            console.error('[PaperFlow] Error handling overview click:', e);
        }
    }

    /**
     * Compute the scale and offsets to fit all workspaces on screen.
     * The strip is numWorkspaces * monitorHeight tall, and we need it
     * to fit within the actual monitor height.
     */
    private _computeOverviewTransform(numWorkspaces: number): OverviewTransform {
        const monitor = this._world!.monitor;
        const stripHeight = numWorkspaces * monitor.totalHeight;

        // Find the widest workspace to determine horizontal scale
        let maxWsWidth = monitor.totalWidth;
        for (const ws of this._world!.workspaces) {
            if (ws.windows.length === 0) continue;
            const { gapSize, edgeGap } = this._world!.config;
            let width = edgeGap;
            for (const win of ws.windows) {
                width += win.slotSpan * monitor.slotWidth - gapSize + gapSize;
            }
            width += edgeGap - gapSize; // trailing edge gap minus extra gap
            if (width > maxWsWidth) maxWsWidth = width;
        }

        const scaleX = monitor.totalWidth / maxWsWidth;
        const scaleY = monitor.totalHeight / stripHeight;
        const scale = Math.min(scaleX, scaleY, 1); // never zoom in

        // Center the scaled strip
        const scaledWidth = maxWsWidth * scale;
        const scaledHeight = stripHeight * scale;
        const offsetX = Math.round((monitor.totalWidth - scaledWidth) / 2);
        const offsetY = Math.round((monitor.totalHeight - scaledHeight) / 2);

        return { scale, offsetX, offsetY };
    }

    private static readonly SETTLEMENT_DELAYS = [100, 150, 200, 300, 400, 500, 750, 1000];

    /**
     * Start exponential-backoff retry to re-apply layout until all windows
     * have settled (frame matches target). Some apps (e.g. Chromium) don't
     * process Wayland configure events immediately after creation.
     */
    private _startSettlementRetry(): void {
        // Cancel any running sequence and start fresh
        if (this._settlementTimerId !== null) {
            GLib.source_remove(this._settlementTimerId);
            this._settlementTimerId = null;
        }
        this._settlementStep = 0;
        this._scheduleNextSettlement();
    }

    private _scheduleNextSettlement(): void {
        const delays = PaperFlowController.SETTLEMENT_DELAYS;
        if (this._settlementStep >= delays.length) return;

        const delay = delays[this._settlementStep]!;
        this._settlementTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._settlementTimerId = null;
            try {
                if (!this._world) return GLib.SOURCE_REMOVE;
                if (!this._guard?.check('settlement')) return GLib.SOURCE_REMOVE;

                // Re-activate the focused window — some apps (e.g. Chromium)
                // don't process the Wayland configure until re-activated.
                this._focusWindow(this._world.focusedWindow);

                // Re-apply layout — picks up current frame rects.
                // Nudge unsettled windows by sending a 1px-different size
                // first to force Mutter to emit a fresh Wayland configure.
                const layout = computeLayout(this._world);
                this._applyLayout(layout, false, true);

                // If all windows now match their targets, we're done.
                // Refresh clips now that buffer rects have settled.
                if (!this._windowAdapter?.hasUnsettledWindows()) {
                    this._windowAdapter?.refreshClips();
                    return GLib.SOURCE_REMOVE;
                }

                // Schedule next attempt
                this._settlementStep++;
                this._scheduleNextSettlement();
            } catch (e) {
                console.error('[PaperFlow] Error in settlement retry:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private static readonly ANIMATION_DURATION = 250;

    /**
     * Apply layout to both window and clone adapters.
     * When animating, hides real window actors so they don't peek through
     * gaps in the clone layer, then shows them after animation completes.
     */
    private _applyLayout(layout: import('../domain/types.js').LayoutState, animate: boolean, nudgeUnsettled: boolean = false): void {
        if (animate) {
            this._windowAdapter?.hideActors();

            // Cancel any pending show timer (new animation supersedes previous)
            if (this._animationTimerId !== null) {
                GLib.source_remove(this._animationTimerId);
            }

            this._animationTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                PaperFlowController.ANIMATION_DURATION,
                () => {
                    this._animationTimerId = null;
                    this._windowAdapter?.showActors();
                    // Refresh clips — buffer rects should have settled by now
                    this._windowAdapter?.refreshClips();
                    return GLib.SOURCE_REMOVE;
                },
            );
        }

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
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = setFocus(this._world, windowId);
            this._world = update.world;

            // Sync arriving workspace's scroll to departing position before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
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
