import type { WindowId, WorkspaceId, WorldUpdate } from '../domain/world/types.js';
import type { World } from '../domain/world/world.js';
import { findWorkspaceIdForWindow } from '../domain/world/world.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { SceneApplyOptions } from './world-holder.js';

export interface NavigationDeps {
    getWorld(): World | null;
    checkGuard(label: string): boolean;
    getCloneAdapter(): (CloneLifecyclePort & CloneRenderPort) | null;
    getWindowAdapter(): WindowPort | null;
    applyUpdate(update: WorldUpdate, options: SceneApplyOptions): void;
}

function getActiveWsId(world: World): WorkspaceId | null {
    return world.workspaces[world.viewport.workspaceIndex]?.id ?? null;
}

export class NavigationHandler {
    private _deps: NavigationDeps;

    constructor(deps: NavigationDeps) {
        this._deps = deps;
    }

    /** Simple command: guard -> domain call -> applyUpdate */
    handleSimpleCommand(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard(label)) return;

            const update = domainFn(world);
            this._deps.applyUpdate(update, { animate: true });
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    /** Vertical focus: saves scroll state, syncs workspace scroll on switch */
    handleVerticalFocus(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard(label)) return;

            const oldWsId = getActiveWsId(world);
            const update = domainFn(world);
            const scrollTransfer = this._buildScrollTransfer(world, update, oldWsId);

            this._deps.applyUpdate(update, { animate: true, scrollTransfer });
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    /** Vertical move: reparents clone, syncs workspaces, repositions source */
    handleVerticalMove(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard(label)) return;

            const sourceWsId = getActiveWsId(world);
            const update = domainFn(world);

            this._reparentCloneIfMoved(world.focusedWindow, sourceWsId, update);
            this._syncWorkspaces(update);

            const scrollTransfer = this._buildScrollTransfer(world, update, sourceWsId);
            this._deps.applyUpdate(update, { animate: true, scrollTransfer });
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    private _buildScrollTransfer(
        oldWorld: World, update: WorldUpdate, oldWsId: WorkspaceId | null,
    ): { workspaceId: WorkspaceId; oldScrollX: number } | undefined {
        const newWsId = getActiveWsId(update.world);
        if (!newWsId || newWsId === oldWsId) return undefined;
        return { workspaceId: newWsId, oldScrollX: oldWorld.viewport.scrollX };
    }

    private _syncWorkspaces(update: WorldUpdate): void {
        const clone = this._deps.getCloneAdapter();
        if (clone) clone.syncWorkspaces(update.world.workspaces);
    }

    /** If window moved cross-workspace, reparent its clone */
    private _reparentCloneIfMoved(windowId: WindowId | null, sourceWsId: WorkspaceId | null, update: WorldUpdate): void {
        if (!windowId || !sourceWsId) return;
        const targetWsId = findWorkspaceIdForWindow(update.world, windowId);
        this._reparentClone(windowId, sourceWsId, targetWsId);
    }

    private _reparentClone(windowId: WindowId, sourceWsId: WorkspaceId, targetWsId: WorkspaceId | null): void {
        if (!targetWsId || targetWsId === sourceWsId) return;
        const clone = this._deps.getCloneAdapter();
        if (clone) clone.moveCloneToWorkspace(windowId, targetWsId);
    }

}
