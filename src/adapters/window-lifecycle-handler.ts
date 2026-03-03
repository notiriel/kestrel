import type { WindowId, WorkspaceId, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { addWindow, removeWindow, enterFullscreen, exitFullscreen, widenWindow, findWorkspaceIdForWindow, wsIdAt, buildUpdate } from '../domain/world.js';
import { allWindows } from '../domain/workspace.js';
import { isQuakeWindow, releaseQuakeWindow, assignQuakeWindow } from '../domain/quake.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { FocusPort } from '../ports/focus-port.js';
import type { SceneApplyOptions } from './world-holder.js';
import Meta from 'gi://Meta';
import { safeWindow } from './safe-window.js';

export interface WindowLifecycleDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    checkGuard(label: string): boolean;
    applyUpdate(update: WorldUpdate, options: SceneApplyOptions): void;
    log(msg: string): void;
    getCloneAdapter(): (CloneLifecyclePort & CloneRenderPort) | null;
    getWindowAdapter(): WindowPort | null;
    getFocusAdapter(): FocusPort | null;
    startSettlement(): void;
    watchWindow(windowId: WindowId, metaWindow: unknown): void;
    unwatchWindow(windowId: WindowId): void;
    matchQuakeSlot(metaWindow: Meta.Window): number | null;
    trackQuakeWindow(windowId: WindowId, metaWindow: Meta.Window): void;
    untrackQuakeWindow(windowId: WindowId): void;
}

export class WindowLifecycleHandler {
    private _deps: WindowLifecycleDeps;

    constructor(deps: WindowLifecycleDeps) {
        this._deps = deps;
    }

    handleWindowReady(windowId: WindowId, rawMetaWindow: Meta.Window): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._deps.checkGuard('windowReady')) return;

            this._deps.log(`[Kestrel] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);
            this._deps.watchWindow(windowId, rawMetaWindow);

            const metaWindow = safeWindow(rawMetaWindow);
            if (this._tryHandleQuakeWindow(world, windowId, metaWindow)) return;
            this._routeWindow(world, windowId, metaWindow);
        } catch (e) {
            console.error('[Kestrel] Error handling window ready:', e);
        }
    }

    private _routeWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): void {
        const existsInDomain = world.workspaces.some(ws => allWindows(ws).some(w => w.id === windowId));
        if (existsInDomain) {
            this._restoreExistingWindow(world, windowId, metaWindow);
        } else {
            this._addNewWindow(world, windowId, metaWindow);
        }
    }

    /** Try to assign or resume a quake window. Returns true if handled as quake. */
    private _tryHandleQuakeWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): boolean {
        // Already assigned to a quake slot (restored from saved state) — just track it
        if (isQuakeWindow(world, windowId)) {
            this._deps.log(`[Kestrel] quake window resumed from saved state: ${windowId}`);
            this._deps.trackQuakeWindow(windowId, metaWindow);
            return true;
        }

        const quakeSlot = this._deps.matchQuakeSlot(metaWindow);
        if (quakeSlot === null) return false;
        // Slot already has a window assigned — let this window be tiled normally
        if (world.quakeState.slots[quakeSlot] !== null) return false;

        this._deps.log(`[Kestrel] quake window matched slot ${quakeSlot}: ${windowId}`);
        const update = assignQuakeWindow(world, quakeSlot, windowId);
        this._deps.trackQuakeWindow(windowId, metaWindow);
        this._deps.applyUpdate(update, { animate: false });
        return true;
    }

    private _restoreExistingWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): void {
        if (metaWindow.maximized_horizontally || metaWindow.maximized_vertically) {
            metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }
        const restoredWsId = findWorkspaceIdForWindow(world, windowId)!;
        this._trackInAdapters(windowId, metaWindow, restoredWsId);

        this._deps.applyUpdate(buildUpdate(world), { animate: false });
        this._deps.startSettlement();
    }

    private _addNewWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): void {
        const wsId = wsIdAt(world, world.viewport.workspaceIndex)!;
        this._trackInAdapters(windowId, metaWindow, wsId);

        const wasMaximized = metaWindow.maximized_horizontally || metaWindow.maximized_vertically;
        if (wasMaximized) metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);

        const oldScrollX = world.viewport.scrollX;
        let update = addWindow(world, windowId, { preferWide: wasMaximized });

        this._deps.setWorld(update.world);

        update = this._handleInitialFullscreen(update, windowId, metaWindow);
        this._applyNewWindowLayout(update, oldScrollX);
    }

    private _trackInAdapters(windowId: WindowId, metaWindow: Meta.Window, wsId: WorkspaceId): void {
        this._deps.getWindowAdapter()?.track(windowId, metaWindow);
        this._deps.getFocusAdapter()?.track(windowId, metaWindow);
        this._deps.getCloneAdapter()?.addClone(windowId, metaWindow, wsId);
    }

    private _handleInitialFullscreen(update: WorldUpdate, windowId: WindowId, metaWindow: Meta.Window): WorldUpdate {
        if (!metaWindow.fullscreen) return update;
        const fsUpdate = enterFullscreen(update.world, windowId);
        this._deps.setWorld(fsUpdate.world);
        this._deps.getCloneAdapter()?.setWindowFullscreen(windowId, true);
        this._deps.getWindowAdapter()?.setWindowFullscreen(windowId, true);
        return fsUpdate;
    }

    private _applyNewWindowLayout(update: WorldUpdate, oldScrollX: number): void {
        this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);
        this._deps.applyUpdate(update, { animate: false });
        this._animateScrollIfChanged(update, oldScrollX);
        this._deps.startSettlement();
    }

    private _animateScrollIfChanged(update: WorldUpdate, oldScrollX: number): void {
        const currentWsScroll = this._getCurrentScroll(update);
        if (currentWsScroll === oldScrollX) return;
        this._deps.getCloneAdapter()?.setScroll(oldScrollX);
        this._deps.getCloneAdapter()?.animateViewport(currentWsScroll);
    }

    private _getCurrentScroll(update: WorldUpdate): number {
        return update.scene.workspaceStrip.workspaces.find(
            ws => ws.scrollX !== 0,
        )?.scrollX ?? 0;
    }

    handleWindowDestroyed(windowId: WindowId): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._deps.checkGuard('windowDestroyed')) return;

            this._deps.log(`[Kestrel] window removed: ${windowId}`);
            if (this._tryReleaseQuakeWindow(world, windowId)) return;
            this._removeTiledWindow(world, windowId);
        } catch (e) {
            console.error('[Kestrel] Error handling window destroyed:', e);
        }
    }

    private _removeTiledWindow(world: World, windowId: WindowId): void {
        const oldScrollX = world.viewport.scrollX;
        const oldWsId = wsIdAt(world, world.viewport.workspaceIndex);
        const update = removeWindow(world, windowId);

        this._untrackFromAdapters(windowId);
        this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);

        const newWsId = wsIdAt(update.world, update.world.viewport.workspaceIndex);
        const scrollTransfer = (newWsId && newWsId !== oldWsId)
            ? { workspaceId: newWsId, oldScrollX }
            : undefined;

        this._deps.applyUpdate(update, { animate: true, scrollTransfer });
    }

    private _tryReleaseQuakeWindow(world: World, windowId: WindowId): boolean {
        if (!isQuakeWindow(world, windowId)) return false;

        this._deps.log(`[Kestrel] quake window destroyed: ${windowId}`);
        const update = releaseQuakeWindow(world, windowId);
        this._deps.untrackQuakeWindow(windowId);
        this._deps.applyUpdate(update, { animate: false });
        this._deps.unwatchWindow(windowId);
        return true;
    }

    private _untrackFromAdapters(windowId: WindowId): void {
        this._deps.getCloneAdapter()?.removeClone(windowId);
        this._deps.getWindowAdapter()?.untrack(windowId);
        this._deps.getFocusAdapter()?.untrack(windowId);
        this._deps.unwatchWindow(windowId);
    }

    handleFullscreenChanged(windowId: WindowId, isFullscreen: boolean): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard('fullscreenChanged')) return;

            this._deps.log(`[Kestrel] fullscreen changed: ${windowId} → ${isFullscreen}`);
            this._applyFullscreenChange(world, windowId, isFullscreen);
        } catch (e) {
            console.error('[Kestrel] Error handling fullscreen change:', e);
        }
    }

    private _applyFullscreenChange(world: World, windowId: WindowId, isFullscreen: boolean): void {
        const update = isFullscreen
            ? enterFullscreen(world, windowId)
            : exitFullscreen(world, windowId);
        this._deps.setWorld(update.world);

        this._deps.getCloneAdapter()?.setWindowFullscreen(windowId, isFullscreen);
        this._deps.getWindowAdapter()?.setWindowFullscreen(windowId, isFullscreen);

        this._deps.applyUpdate(update, { animate: true });
    }

    handleWindowMaximized(windowId: WindowId): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard('windowMaximized')) return;

            this._deps.log(`[Kestrel] window maximized: ${windowId} → widening to 2-slot`);
            this._unmaximizeMetaWindow(windowId);

            const update = widenWindow(world, windowId);
            this._deps.setWorld(update.world);

            this._deps.applyUpdate(update, { animate: true });
            this._deps.startSettlement();
        } catch (e) {
            console.error('[Kestrel] Error handling window maximized:', e);
        }
    }

    private _unmaximizeMetaWindow(windowId: WindowId): void {
        const metaWindow = this._deps.getFocusAdapter()?.getMetaWindow(windowId) as Meta.Window | undefined;
        if (metaWindow) {
            metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }
}
