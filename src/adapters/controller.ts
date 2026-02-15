import type { WindowId, PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, withMonitor, buildUpdate } from '../domain/world.js';
import { focusRight, focusLeft } from '../domain/navigation.js';
import { MonitorAdapter } from './monitor-adapter.js';
import { WindowEventAdapter, shouldTile } from './window-event-adapter.js';
import { CloneAdapter } from './clone-adapter.js';
import { WindowAdapter } from './window-adapter.js';
import { FocusAdapter } from './focus-adapter.js';
import { KeybindingAdapter } from './keybinding-adapter.js';
import { ConflictDetector } from './conflict-detector.js';
import type Gio from 'gi://Gio';
import type Meta from 'gi://Meta';

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
            this._cloneAdapter.init(monitor.workAreaY);

            this._windowAdapter = new WindowAdapter();
            this._windowAdapter.setWorkAreaY(monitor.workAreaY);
            this._focusAdapter = new FocusAdapter();

            // 5. Connect keybindings
            this._keybindingAdapter = new KeybindingAdapter();
            this._keybindingAdapter.connect(this._settings, {
                onFocusRight: () => this._handleFocusRight(),
                onFocusLeft: () => this._handleFocusLeft(),
            });

            // 6. Connect monitor changes
            this._monitorAdapter.connectMonitorsChanged((info: MonitorInfo) => {
                this._handleMonitorChange(info);
            });

            // 7. Connect window signals
            this._windowEventAdapter = new WindowEventAdapter();
            this._windowEventAdapter.connect({
                onWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => {
                    this._handleWindowReady(windowId, metaWindow);
                },
                onWindowDestroyed: (windowId: WindowId) => {
                    this._handleWindowDestroyed(windowId);
                },
                onFloatWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => {
                    console.log(`[PaperFlow] float window added: ${windowId} title="${metaWindow.get_title()}"`);
                    this._cloneAdapter?.addFloatClone(windowId, metaWindow);
                },
                onFloatWindowDestroyed: (windowId: WindowId) => {
                    console.log(`[PaperFlow] float window removed: ${windowId}`);
                    this._cloneAdapter?.removeFloatClone(windowId);
                },
            });

            // 8. Enumerate existing windows
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

    private _handleWindowReady(windowId: WindowId, metaWindow: Meta.Window): void {
        try {
            if (!this._world) return;

            // Re-check filter — properties like skip_taskbar/wm_class may not
            // be set yet when enumerateExisting runs at startup
            if (!shouldTile(metaWindow)) {
                console.log(`[PaperFlow] skipping window: ${windowId} title="${metaWindow.get_title()}" wmclass="${metaWindow.get_wm_class()}"`);
                return;
            }

            console.log(`[PaperFlow] window added: ${windowId} title="${metaWindow.get_title()}" wmclass="${metaWindow.get_wm_class()}"`);

            // Track in adapters
            this._windowAdapter?.track(windowId, metaWindow);
            this._focusAdapter?.track(windowId, metaWindow);
            this._cloneAdapter?.addClone(windowId, metaWindow);

            // Save old scroll position for viewport animation
            const oldScrollX = this._world.viewport.scrollX;

            // Update domain
            const update = addWindow(this._world, windowId);
            this._world = update.world;

            // Apply layout — snap all positions immediately
            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, false);

            // Animate viewport from old scroll position to new
            if (update.layout.scrollX !== oldScrollX) {
                this._cloneAdapter?.setScroll(oldScrollX);
                this._cloneAdapter?.animateViewport(update.layout.scrollX);
            }

            this._focusAdapter?.focus(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling window ready:', e);
        }
    }

    private _handleWindowDestroyed(windowId: WindowId): void {
        try {
            if (!this._world) return;

            console.log(`[PaperFlow] window removed: ${windowId}`);

            // Save old scroll position for viewport animation
            const oldScrollX = this._world.viewport.scrollX;

            // Update domain
            const update = removeWindow(this._world, windowId);
            this._world = update.world;

            // Remove from adapters
            this._cloneAdapter?.removeClone(windowId);
            this._windowAdapter?.untrack(windowId);
            this._focusAdapter?.untrack(windowId);

            // Apply layout — snap positions immediately
            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, false);

            // Animate viewport from old scroll position to new
            if (update.layout.scrollX !== oldScrollX) {
                this._cloneAdapter?.setScroll(oldScrollX);
                this._cloneAdapter?.animateViewport(update.layout.scrollX);
            }

            this._focusAdapter?.focus(this._world.focusedWindow);

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
            this._focusAdapter?.focus(this._world.focusedWindow);

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
            this._focusAdapter?.focus(this._world.focusedWindow);

        } catch (e) {
            console.error('[PaperFlow] Error handling focus left:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._world) return;

            console.log('[PaperFlow] monitors changed');
            this._world = withMonitor(this._world, monitor);

            this._cloneAdapter?.updateWorkArea(monitor.workAreaY);
            this._windowAdapter?.setWorkAreaY(monitor.workAreaY);

            const update = buildUpdate(this._world);
            this._windowAdapter?.applyLayout(update.layout);
            this._cloneAdapter?.applyLayout(update.layout, false);
        } catch (e) {
            console.error('[PaperFlow] Error handling monitor change:', e);
        }
    }
}
