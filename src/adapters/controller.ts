import type { WindowId, PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { createWorld, addWindow, removeWindow, withMonitor } from '../domain/world.js';
import { computeLayout } from '../domain/layout.js';
import { MonitorAdapter } from './monitor-adapter.js';
import { WindowEventAdapter } from './window-event-adapter.js';
import { CloneAdapter } from './clone-adapter.js';
import { WindowAdapter } from './window-adapter.js';
import { FocusAdapter } from './focus-adapter.js';
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

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    enable(): void {
        try {
            console.log('[PaperFlow] enabling...');

            // 1. Read config
            const config = this._readConfig();

            // 2. Init monitor adapter and read monitors
            this._monitorAdapter = new MonitorAdapter();
            const monitor = this._monitorAdapter.readPrimaryMonitor();

            // 3. Create domain world
            this._world = createWorld(config, monitor);

            // 4. Create adapters
            this._cloneAdapter = new CloneAdapter();
            this._cloneAdapter.init();

            this._windowAdapter = new WindowAdapter();
            this._focusAdapter = new FocusAdapter();

            // 5. Connect monitor changes
            this._monitorAdapter.connectMonitorsChanged((info: MonitorInfo) => {
                this._handleMonitorChange(info);
            });

            // 6. Connect window signals
            this._windowEventAdapter = new WindowEventAdapter();
            this._windowEventAdapter.connect({
                onWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => {
                    this._handleWindowReady(windowId, metaWindow);
                },
                onWindowDestroyed: (windowId: WindowId) => {
                    this._handleWindowDestroyed(windowId);
                },
            });

            // 7. Enumerate existing windows
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

            this._monitorAdapter?.destroy();
            this._monitorAdapter = null;

            this._windowAdapter?.showAll();
            this._windowAdapter?.destroy();
            this._windowAdapter = null;

            this._focusAdapter?.destroy();
            this._focusAdapter = null;

            this._cloneAdapter?.destroy();
            this._cloneAdapter = null;

            this._world = null;

            console.log('[PaperFlow] disabled');
        } catch (e) {
            console.error('[PaperFlow] Failed to disable:', e);
        }
    }

    private _readConfig(): PaperFlowConfig {
        return {
            gapSize: this._settings.get_int('gap-size'),
            edgeGap: this._settings.get_int('edge-gap'),
        };
    }

    private _handleWindowReady(windowId: WindowId, metaWindow: Meta.Window): void {
        try {
            if (!this._world) return;

            console.log(`[PaperFlow] window added: ${windowId}`);

            // Track in adapters
            this._windowAdapter?.track(windowId, metaWindow);
            this._focusAdapter?.track(windowId, metaWindow);
            this._cloneAdapter?.addClone(windowId, metaWindow);

            // Update domain
            const update = addWindow(this._world, windowId);
            this._world = update.world;

            // Apply layout
            this._cloneAdapter?.applyLayout(update.layout);
            this._windowAdapter?.applyLayout(update.layout);
            this._focusAdapter?.focus(this._world.focusedWindow);
        } catch (e) {
            console.error('[PaperFlow] Error handling window ready:', e);
        }
    }

    private _handleWindowDestroyed(windowId: WindowId): void {
        try {
            if (!this._world) return;

            console.log(`[PaperFlow] window removed: ${windowId}`);

            // Update domain
            const update = removeWindow(this._world, windowId);
            this._world = update.world;

            // Remove from adapters
            this._cloneAdapter?.removeClone(windowId);
            this._windowAdapter?.untrack(windowId);
            this._focusAdapter?.untrack(windowId);

            // Apply layout
            this._cloneAdapter?.applyLayout(update.layout);
            this._windowAdapter?.applyLayout(update.layout);
            this._focusAdapter?.focus(this._world.focusedWindow);
        } catch (e) {
            console.error('[PaperFlow] Error handling window destroyed:', e);
        }
    }

    private _handleMonitorChange(monitor: MonitorInfo): void {
        try {
            if (!this._world) return;

            console.log('[PaperFlow] monitors changed');
            this._world = withMonitor(this._world, monitor);

            // Recompute layout for current state
            const update = { world: this._world, layout: this._buildCurrentLayout() };
            this._cloneAdapter?.applyLayout(update.layout);
            this._windowAdapter?.applyLayout(update.layout);
        } catch (e) {
            console.error('[PaperFlow] Error handling monitor change:', e);
        }
    }

    private _buildCurrentLayout() {
        if (!this._world) return { windows: [] };
        const ws = this._world.workspaces[this._world.viewport.workspaceIndex]!;
        return computeLayout(ws, this._world.config, this._world.monitor);
    }
}
