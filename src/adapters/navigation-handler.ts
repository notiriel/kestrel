import type { WindowId, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { findWorkspaceIdForWindow } from '../domain/world.js';
import { computeLayoutForWorkspace } from '../domain/layout.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';

export interface NavigationDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    checkGuard(label: string): boolean;
    focusWindow(windowId: WindowId | null): void;
    getCloneAdapter(): (CloneLifecyclePort & CloneRenderPort) | null;
    getWindowAdapter(): WindowPort | null;
    applyLayout(layout: WorldUpdate['layout'], animate: boolean): void;
}

export class NavigationHandler {
    private _deps: NavigationDeps;

    constructor(deps: NavigationDeps) {
        this._deps = deps;
    }

    /** Simple command: guard → domain call → animate → focus */
    handleSimpleCommand(domainFn: (world: World) => WorldUpdate, label: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world || world.overviewActive) return;
            if (!this._deps.checkGuard(label)) return;

            const update = domainFn(world);
            this._deps.setWorld(update.world);

            this._deps.applyLayout(update.layout, true);
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
            const oldWsId = world.workspaces[world.viewport.workspaceIndex]?.id ?? null;

            const update = domainFn(world);
            this._deps.setWorld(update.world);

            const newWsId = update.world.workspaces[update.world.viewport.workspaceIndex]?.id ?? null;
            if (newWsId && newWsId !== oldWsId) {
                this._deps.getCloneAdapter()?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._deps.applyLayout(update.layout, true);
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

            const oldScrollX = world.viewport.scrollX;
            const windowId = world.focusedWindow;
            const sourceWsId = world.workspaces[world.viewport.workspaceIndex]?.id ?? null;

            const update = domainFn(world);
            this._deps.setWorld(update.world);

            // Reparent clone if window moved cross-workspace
            if (windowId && sourceWsId) {
                const targetWsId = findWorkspaceIdForWindow(update.world, windowId);
                if (targetWsId && targetWsId !== sourceWsId) {
                    this._deps.getCloneAdapter()?.moveCloneToWorkspace(windowId, targetWsId);
                }
            }
            this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);

            const newWsId = update.world.workspaces[update.world.viewport.workspaceIndex]?.id ?? null;
            if (newWsId && newWsId !== sourceWsId) {
                this._deps.getCloneAdapter()?.setScrollForWorkspace(newWsId, oldScrollX);
            }

            this._deps.applyLayout(update.layout, true);

            // Reposition remaining windows on source workspace
            if (sourceWsId) {
                const sourceWsNewIndex = update.world.workspaces.findIndex(ws => ws.id === sourceWsId);
                if (sourceWsNewIndex >= 0) {
                    const sourceLayout = computeLayoutForWorkspace(update.world, sourceWsNewIndex);
                    this._deps.getCloneAdapter()?.applyLayout(
                        { ...sourceLayout, workspaceIndex: update.world.viewport.workspaceIndex },
                        true,
                    );
                }
            }

            this._deps.focusWindow(update.world.focusedWindow);
        } catch (e) {
            console.error(`[Kestrel] Error handling ${label}:`, e);
        }
    }

}
