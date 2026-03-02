import type { WindowId, KestrelConfig, MonitorInfo } from '../domain/types.js';
import type { World, RestoreWorkspaceData, RestoreColumnData } from '../domain/world.js';
import type { StatePersistencePort } from '../ports/state-persistence-port.js';
import { restoreWorld } from '../domain/world.js';
import { createTiledWindow } from '../domain/window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';

/** Version 3 saved format: column-based */
interface SavedColumn {
    windowIds: string[];
    slotSpan: number;
}

interface SavedWorkspaceV3 {
    columns: SavedColumn[];
    name: string | null;
}

/** Version 1/2 saved format: flat windows */
interface SavedWorkspaceV1V2 {
    windowIds: string[];
    slotSpans: number[];
    name: string | null;
}

interface SavedState {
    version: number;
    workspaces: (SavedWorkspaceV3 | SavedWorkspaceV1V2)[];
    focusedWindow: string | null;
    viewportWorkspaceIndex: number;
    viewportScrollX: number;
    quakeWindowIds?: string[];
}

export class StatePersistence implements StatePersistencePort {
    private _settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    readConfig(): KestrelConfig {
        const quakeSlots = [];
        for (let i = 1; i <= 5; i++) {
            quakeSlots.push({ appId: this._settings.get_string(`quake-slot-${i}`) });
        }
        return {
            gapSize: this._settings.get_int('gap-size'),
            edgeGap: this._settings.get_int('edge-gap'),
            focusBorderWidth: this._settings.get_int('focus-border-width'),
            focusBorderColor: this._settings.get_string('focus-border-color'),
            focusBorderRadius: this._settings.get_int('focus-border-radius'),
            focusBgColor: this._settings.get_string('focus-background-color'),
            columnCount: this._settings.get_int('column-count'),
            quakeSlots,
            quakeWidthPercent: this._settings.get_int('quake-width-percent'),
            quakeHeightPercent: this._settings.get_int('quake-height-percent'),
        };
    }

    save(world: World): void {
        try {
            const state: SavedState = {
                version: 3,
                workspaces: this._serializeWorkspaces(world),
                focusedWindow: world.focusedWindow,
                viewportWorkspaceIndex: world.viewport.workspaceIndex,
                viewportScrollX: world.viewport.scrollX,
                quakeWindowIds: world.quakeState.slots.filter((id): id is WindowId => id !== null),
            };
            this._settings.set_string('saved-state', JSON.stringify(state));
        } catch (e) {
            console.error('[Kestrel] Error saving state:', e);
        }
    }

    private _serializeWorkspaces(world: World): SavedWorkspaceV3[] {
        return world.workspaces.map(ws => ({
            columns: ws.columns.map(col => ({
                windowIds: col.windows.map(w => w.id),
                slotSpan: col.slotSpan,
            })),
            name: ws.name,
        }));
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
        if (state.version !== 1 && state.version !== 2 && state.version !== 3) return null;

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
        const quakeIds = new Set(state.quakeWindowIds ?? []);
        return state.workspaces.map(savedWs => {
            if (state.version === 3) {
                return this._buildV3WorkspaceData(savedWs as SavedWorkspaceV3, existingWindowIds, quakeIds);
            }
            // Migrate v1/v2: each window becomes a single-window column
            return this._migrateV1V2WorkspaceData(savedWs as SavedWorkspaceV1V2, existingWindowIds, quakeIds);
        });
    }

    private _buildV3WorkspaceData(savedWs: SavedWorkspaceV3, existingWindowIds: Set<string>, quakeIds: Set<string>): RestoreWorkspaceData {
        const columns: RestoreColumnData[] = [];
        for (const savedCol of savedWs.columns) {
            const windows = savedCol.windowIds
                .filter(id => existingWindowIds.has(id) && !quakeIds.has(id))
                .map(id => createTiledWindow(id as WindowId));
            if (windows.length > 0) {
                columns.push({ windows, slotSpan: savedCol.slotSpan });
            }
        }
        return { columns, name: savedWs.name ?? null };
    }

    private _migrateV1V2WorkspaceData(savedWs: SavedWorkspaceV1V2, existingWindowIds: Set<string>, quakeIds: Set<string>): RestoreWorkspaceData {
        const columns: RestoreColumnData[] = savedWs.windowIds
            .map((idStr, i) => ({
                id: idStr,
                slotSpan: (savedWs.slotSpans[i] ?? 1),
            }))
            .filter(({ id }) => existingWindowIds.has(id) && !quakeIds.has(id))
            .map(({ id, slotSpan }) => ({
                windows: [createTiledWindow(id as WindowId)],
                slotSpan,
            }));
        return { columns, name: savedWs.name ?? null };
    }
}
