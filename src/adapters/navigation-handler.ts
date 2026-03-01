import type { WindowId, WorkspaceId, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { findWorkspaceIdForWindow } from '../domain/world.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';

export interface NavigationDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    checkGuard(label: string): boolean;
    focusWindow(windowId: WindowId | null): void;
    getCloneAdapter(): (CloneLifecyclePort & CloneRenderPort) | null;
    getWindowAdapter(): WindowPort | null;
    applyScene(scene: WorldUpdate['scene'], animate: boolean): void;
}

function getActiveWsId(world: World): WorkspaceId | null {
    return world.workspaces[world.viewport.workspaceIndex]?.id ?? null;
}

export class NavigationHandler {
    private _deps: NavigationDeps;

    constructor(deps: NavigationDeps) {
        this._deps = deps;
    }

    /** Simple command: guard -> domain call -> animate -> focus */
    handleSimpleCommand(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world || world.overviewActive) return;
            if (!this._deps.checkGuard(label)) return;

            const update = domainFn(world);
            this._deps.setWorld(update.world);

            this._deps.applyScene(update.scene, true);
            this._deps.focusWindow(update.world.focusedWindow);
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    /** Vertical focus: saves scroll state, syncs workspace scroll on switch */
    handleVerticalFocus(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world || world.overviewActive) return;
            if (!this._deps.checkGuard(label)) return;

            const oldScrollX = world.viewport.scrollX;
            const oldWsId = getActiveWsId(world);

            const update = domainFn(world);
            this._deps.setWorld(update.world);

            this._syncScrollOnSwitch(oldScrollX, oldWsId, update.world);
            this._deps.applyScene(update.scene, true);
            this._deps.focusWindow(update.world.focusedWindow);
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    /** Vertical move: reparents clone, syncs workspaces, repositions source */
    handleVerticalMove(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world || world.overviewActive) return;
            if (!this._deps.checkGuard(label)) return;

            const sourceWsId = getActiveWsId(world);
            const update = domainFn(world);
            this._deps.setWorld(update.world);

            this._reparentCloneIfMoved(world.focusedWindow, sourceWsId, update);
            this._syncWorkspaces(update);
            this._syncScrollOnSwitch(world.viewport.scrollX, sourceWsId, update.world);
            this._deps.applyScene(update.scene, true);
            this._deps.focusWindow(update.world.focusedWindow);
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

    private _syncWorkspaces(update: WorldUpdate): void {
        const clone = this._deps.getCloneAdapter();
        if (clone) clone.syncWorkspaces(update.world.workspaces);
    }

    /** If the new workspace differs from oldWsId, carry scroll state over */
    private _syncScrollOnSwitch(oldScrollX: number, oldWsId: WorkspaceId | null, newWorld: World): void {
        const newWsId = getActiveWsId(newWorld);
        if (!newWsId || newWsId === oldWsId) return;
        const clone = this._deps.getCloneAdapter();
        if (clone) clone.setScrollForWorkspace(newWsId, oldScrollX);
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
