import type { WindowId, WorkspaceId, PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, setFocus, updateMonitor, buildUpdate } from '../domain/world.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
import { moveLeft, moveRight, moveDown, moveUp, toggleSize } from '../domain/window-operations.js';
import { computeLayout, computeLayoutForWorkspace } from '../domain/layout.js';
import { MonitorAdapter } from './monitor-adapter.js';
import { WindowEventAdapter } from './window-event-adapter.js';
import { CloneAdapter } from './clone-adapter.js';
import { WindowAdapter } from './window-adapter.js';
import { FocusAdapter } from './focus-adapter.js';
import { KeybindingAdapter } from './keybinding-adapter.js';
import { ConflictDetector } from './conflict-detector.js';
import { safeWindow } from './safe-window.js';
import type Gio from 'gi://Gio';
import type Meta from 'gi://Meta';
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
    private _conflictDetector: ConflictDetector | null = null;
    private _internalFocusChange: boolean = false;
    private _wmDestroyId: number | null = null;
    private _wmMinimizeId: number | null = null;
    private _wmUnminimizeId: number | null = null;
    private _settlementTimerId: number | null = null;
    private _settlementStep: number = 0;

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

            // 10. Enumerate existing windows
            this._windowEventAdapter.enumerateExisting();

            console.log('[PaperFlow] enabled');
        } catch (e) {
            console.error('[PaperFlow] Failed to enable:', e);
        }
    }

    disable(): void {
        try {
            console.log('[PaperFlow] disabling...');

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

            this._windowEventAdapter?.destroy();
            this._windowEventAdapter = null;

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

            console.log(`[PaperFlow] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);

            // Wrap in safety proxy — all downstream adapters get a proxy that
            // throws JS errors instead of native SIGSEGV on dead GObjects.
            const metaWindow = safeWindow(rawMetaWindow);

            // Track in adapters — clone goes to the current workspace's scroll container
            const wsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex)!;
            this._windowAdapter?.track(windowId, metaWindow);
            this._focusAdapter?.track(windowId, metaWindow);
            this._cloneAdapter?.addClone(windowId, metaWindow, wsId);

            // Save old scroll position for viewport animation
            const oldScrollX = this._world.viewport.scrollX;

            // Update domain
            const update = addWindow(this._world, windowId);
            this._world = update.world;

            // Sync workspace containers (ensureTrailingEmpty may have added one)
            this._cloneAdapter?.syncWorkspaces(update.world.workspaces);

            // Apply layout — snap all positions immediately
            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, false);

            // Animate viewport from old scroll position to new
            if (update.layout.scrollX !== oldScrollX) {
                this._cloneAdapter?.setScroll(oldScrollX);
                this._cloneAdapter?.animateViewport(update.layout.scrollX);
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

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);

            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling window destroyed:', e);
        }
    }

    private _handleFocusRight(): void {
        try {
            if (!this._world) return;

            const update = focusRight(this._world);
            this._world = update.world;

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus right:', e);
        }
    }

    private _handleFocusLeft(): void {
        try {
            if (!this._world) return;

            const update = focusLeft(this._world);
            this._world = update.world;

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus left:', e);
        }
    }

    private _handleFocusDown(): void {
        try {
            if (!this._world) return;

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = focusDown(this._world);
            this._world = update.world;

            // Sync arriving workspace's scroll to departing position before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus down:', e);
        }
    }

    private _handleFocusUp(): void {
        try {
            if (!this._world) return;

            const oldScrollX = this._world.viewport.scrollX;
            const oldWsId = this._wsIdAt(this._world, this._world.viewport.workspaceIndex);

            const update = focusUp(this._world);
            this._world = update.world;

            // Sync arriving workspace's scroll to departing position before animating
            const newWsId = this._wsIdAt(update.world, update.world.viewport.workspaceIndex);
            if (newWsId && newWsId !== oldWsId) {
                this._cloneAdapter?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus up:', e);
        }
    }

    private _handleMoveRight(): void {
        try {
            if (!this._world) return;

            const update = moveRight(this._world);
            this._world = update.world;

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move right:', e);
        }
    }

    private _handleMoveLeft(): void {
        try {
            if (!this._world) return;

            const update = moveLeft(this._world);
            this._world = update.world;

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling move left:', e);
        }
    }

    private _handleMoveDown(): void {
        try {
            if (!this._world) return;

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

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);

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
            if (!this._world) return;

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

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);

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
            if (!this._world) return;

            const update = toggleSize(this._world);
            this._world = update.world;

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
            this._focusWindow(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling toggle size:', e);
        }
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

                // Re-activate the focused window — some apps (e.g. Chromium)
                // don't process the Wayland configure until re-activated.
                this._focusWindow(this._world.focusedWindow);

                // Re-apply layout — picks up current frame rects.
                // Nudge unsettled windows by sending a 1px-different size
                // first to force Mutter to emit a fresh Wayland configure.
                const layout = computeLayout(this._world);
                this._windowAdapter?.applyLayout(layout, true);
                this._cloneAdapter?.applyLayout(layout, false);

                // If all windows now match their targets, we're done.
                if (!this._windowAdapter?.hasUnsettledWindows()) {
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

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, true);
        } catch (e) {
            console.error('[PaperFlow] Error handling external focus:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._world) return;

            console.log('[PaperFlow] monitors changed');

            const update = updateMonitor(this._world, monitor);
            this._world = update.world;

            this._cloneAdapter?.updateWorkArea(monitor.workAreaY, monitor.totalHeight);
            this._windowAdapter?.setWorkAreaY(monitor.workAreaY);

            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, false);
        } catch (e) {
            console.error('[PaperFlow] Error handling monitor change:', e);
        }
    }
}
