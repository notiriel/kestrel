import type { WindowId, KestrelConfig, MonitorInfo } from '../domain/types.js';
import type { World, RestoreWorkspaceData } from '../domain/world.js';
import type { StatePersistencePort } from '../ports/state-persistence-port.js';
import { restoreWorld } from '../domain/world.js';
import { createTiledWindow } from '../domain/window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';

interface SavedWorkspace {
    windowIds: string[];
    slotSpans: number[];
    name: string | null;
}

interface SavedState {
    version: number;
    workspaces: SavedWorkspace[];
    focusedWindow: string | null;
    viewportWorkspaceIndex: number;
    viewportScrollX: number;
}

export class StatePersistence implements StatePersistencePort {
    private _settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    readConfig(): KestrelConfig {
        return {
            gapSize: this._settings.get_int('gap-size'),
            edgeGap: this._settings.get_int('edge-gap'),
            focusBorderWidth: this._settings.get_int('focus-border-width'),
            focusBorderColor: this._settings.get_string('focus-border-color'),
            focusBorderRadius: this._settings.get_int('focus-border-radius'),
            focusBgColor: this._settings.get_string('focus-background-color'),
        };
    }

    save(world: World): void {
        try {
            const state = {
                version: 2,
                workspaces: world.workspaces.map(ws => ({
                    windowIds: ws.windows.map(w => w.id),
                    slotSpans: ws.windows.map(w => w.slotSpan),
                    name: ws.name,
                })),
                focusedWindow: world.focusedWindow,
                viewportWorkspaceIndex: world.viewport.workspaceIndex,
                viewportScrollX: world.viewport.scrollX,
            };
            this._settings.set_string('saved-state', JSON.stringify(state));
        } catch (e) {
            console.error('[Kestrel] Error saving state:', e);
        }
    }

    tryRestore(config: KestrelConfig, monitor: MonitorInfo): World | null {
        try {
            const state = this._readAndValidateState();
            if (!state) return null;

            return this._restoreFromState(state, config, monitor);
        } catch (e) {
            console.error('[Kestrel] Error restoring state:', e);
            return null;
        }
    }

    private _restoreFromState(state: SavedState, config: KestrelConfig, monitor: MonitorInfo): World {
        const existingWindowIds = this._collectExistingWindowIds();
        const workspaceData = this._buildWorkspaceData(state, existingWindowIds);

        return restoreWorld(
            config, monitor,
            workspaceData,
            state.viewportWorkspaceIndex ?? 0,
            state.viewportScrollX ?? 0,
            (state.focusedWindow as WindowId) ?? null,
        );
    }

    private _readAndValidateState(): SavedState | null {
        const json = this._settings.get_string('saved-state');
        if (!json) return null;

        this._settings.set_string('saved-state', '');

        const state = JSON.parse(json) as SavedState;
        if (state.version !== 1 && state.version !== 2) return null;

        return state;
    }

    private _collectExistingWindowIds(): Set<string> {
        const actors = global.get_window_actors();
        const existingWindowIds = new Set<string>();
        for (const actor of actors) {
            try {
                const metaWindow = (actor as Meta.WindowActor).get_meta_window();
                if (!metaWindow) continue;
                existingWindowIds.add(String(metaWindow.get_stable_sequence()));
            } catch { /* skip */ }
        }
        return existingWindowIds;
    }

    private _buildWorkspaceData(state: SavedState, existingWindowIds: Set<string>): RestoreWorkspaceData[] {
        return state.workspaces.map(savedWs => ({
            windows: this._filterExistingWindows(savedWs, existingWindowIds),
            name: savedWs.name ?? null,
        }));
    }

    private _filterExistingWindows(
        savedWs: SavedWorkspace, existingWindowIds: Set<string>,
    ): ReturnType<typeof createTiledWindow>[] {
        return savedWs.windowIds
            .map((idStr, i) => ({ id: idStr as WindowId, slotSpan: (savedWs.slotSpans[i] ?? 1) as 1 | 2 }))
            .filter(({ id }) => existingWindowIds.has(id))
            .map(({ id, slotSpan }) => createTiledWindow(id, slotSpan));
    }
}
