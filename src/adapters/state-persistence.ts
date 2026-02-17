import type { WindowId, PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World, RestoreWorkspaceData } from '../domain/world.js';
import type { StatePersistencePort } from '../ports/state-persistence-port.js';
import { restoreWorld } from '../domain/world.js';
import { createTiledWindow } from '../domain/window.js';
import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';

export class StatePersistence implements StatePersistencePort {
    private _settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    readConfig(): PaperFlowConfig {
        return {
            gapSize: this._settings.get_int('gap-size'),
            edgeGap: this._settings.get_int('edge-gap'),
            focusBorderWidth: 3,
        };
    }

    save(world: World): void {
        try {
            const state = {
                version: 1,
                workspaces: world.workspaces.map(ws => ({
                    windowIds: ws.windows.map(w => w.id),
                    slotSpans: ws.windows.map(w => w.slotSpan),
                })),
                focusedWindow: world.focusedWindow,
                viewportWorkspaceIndex: world.viewport.workspaceIndex,
                viewportScrollX: world.viewport.scrollX,
            };
            this._settings.set_string('saved-state', JSON.stringify(state));
            console.log(`[PaperFlow] saved state: ${state.workspaces.length} workspaces`);
        } catch (e) {
            console.error('[PaperFlow] Error saving state:', e);
        }
    }

    tryRestore(config: PaperFlowConfig, monitor: MonitorInfo): World | null {
        try {
            const json = this._settings.get_string('saved-state');
            if (!json) return null;

            this._settings.set_string('saved-state', '');

            const state = JSON.parse(json);
            if (state.version !== 1) return null;

            const actors = global.get_window_actors();
            const existingWindowIds = new Set<string>();
            for (const actor of actors) {
                try {
                    const metaWindow = (actor as Meta.WindowActor).get_meta_window();
                    if (!metaWindow) continue;
                    existingWindowIds.add(String(metaWindow.get_stable_sequence()));
                } catch { /* skip */ }
            }

            const workspaceData: RestoreWorkspaceData[] = [];
            for (const savedWs of state.workspaces) {
                const windows = [];
                for (let i = 0; i < savedWs.windowIds.length; i++) {
                    const id = savedWs.windowIds[i] as WindowId;
                    const slotSpan = (savedWs.slotSpans[i] ?? 1) as 1 | 2;
                    if (existingWindowIds.has(id)) {
                        windows.push(createTiledWindow(id, slotSpan));
                    }
                }
                workspaceData.push({ windows });
            }

            const world = restoreWorld(
                config, monitor,
                workspaceData,
                state.viewportWorkspaceIndex ?? 0,
                state.viewportScrollX ?? 0,
                (state.focusedWindow as WindowId) ?? null,
            );

            console.log(`[PaperFlow] restored state: ${world.workspaces.length} workspaces`);
            return world;
        } catch (e) {
            console.error('[PaperFlow] Error restoring state:', e);
            return null;
        }
    }
}
