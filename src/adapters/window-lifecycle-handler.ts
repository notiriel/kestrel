import type { WindowId, WorkspaceId, WorldUpdate } from '../domain/types.js';
import type { SceneModel } from '../domain/scene.js';
import type { World } from '../domain/world.js';
import { addWindow, removeWindow, enterFullscreen, exitFullscreen, widenWindow, findWorkspaceIdForWindow, wsIdAt, buildUpdate } from '../domain/world.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { FocusPort } from '../ports/focus-port.js';
import Meta from 'gi://Meta';
import { safeWindow } from './safe-window.js';

export interface WindowLifecycleDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    checkGuard(label: string): boolean;
    applyScene(scene: SceneModel, animate: boolean): void;
    applyUpdateWithScroll(update: WorldUpdate, animate: boolean,
                          oldScrollX: number, oldWsId: WorkspaceId | null): void;
    focusWindow(windowId: WindowId | null): void;
    log(msg: string): void;
    getCloneAdapter(): (CloneLifecyclePort & CloneRenderPort) | null;
    getWindowAdapter(): WindowPort | null;
    getFocusAdapter(): FocusPort | null;
    startSettlement(): void;
    watchWindow(windowId: WindowId, metaWindow: unknown): void;
    unwatchWindow(windowId: WindowId): void;
}

export class WindowLifecycleHandler {
    private _deps: WindowLifecycleDeps;

    constructor(deps: WindowLifecycleDeps) {
        this._deps = deps;
    }

    handleWindowReady(windowId: WindowId, rawMetaWindow: Meta.Window): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard('windowReady')) return;

            this._deps.log(`[Kestrel] window added: ${windowId} title="${rawMetaWindow.get_title()}" wmclass="${rawMetaWindow.get_wm_class()}"`);
            this._deps.watchWindow(windowId, rawMetaWindow);

            const metaWindow = safeWindow(rawMetaWindow);
            const existsInDomain = world.workspaces.some(ws => ws.windows.some(w => w.id === windowId));

            if (existsInDomain) {
                this._restoreExistingWindow(world, windowId, metaWindow);
            } else {
                this._addNewWindow(world, windowId, metaWindow);
            }
        } catch (e) {
            console.error('[Kestrel] Error handling window ready:', e);
        }
    }

    private _restoreExistingWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): void {
        if (metaWindow.maximized_horizontally || metaWindow.maximized_vertically) {
            metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }
        const restoredWsId = findWorkspaceIdForWindow(world, windowId)!;
        this._trackInAdapters(windowId, metaWindow, restoredWsId);

        const scene = buildUpdate(world).scene;
        this._deps.applyScene(scene, false);
        this._deps.focusWindow(world.focusedWindow);
        this._deps.startSettlement();
    }

    private _addNewWindow(world: World, windowId: WindowId, metaWindow: Meta.Window): void {
        const wsId = wsIdAt(world, world.viewport.workspaceIndex)!;
        this._trackInAdapters(windowId, metaWindow, wsId);

        const wasMaximized = metaWindow.maximized_horizontally || metaWindow.maximized_vertically;
        if (wasMaximized) metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);

        const oldScrollX = world.viewport.scrollX;
        let update = addWindow(world, windowId, wasMaximized ? 2 : 1);
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
        this._deps.applyScene(update.scene, false);
        this._animateScrollIfChanged(update, oldScrollX);
        this._deps.focusWindow(update.world.focusedWindow);
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
            if (!world) return;
            if (!this._deps.checkGuard('windowDestroyed')) return;

            this._deps.log(`[Kestrel] window removed: ${windowId}`);

            const oldScrollX = world.viewport.scrollX;
            const oldWsId = wsIdAt(world, world.viewport.workspaceIndex);
            const update = removeWindow(world, windowId);

            this._untrackFromAdapters(windowId);
            this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);
            this._deps.applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
        } catch (e) {
            console.error('[Kestrel] Error handling window destroyed:', e);
        }
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

        this._deps.applyScene(update.scene, true);
        this._deps.focusWindow(update.world.focusedWindow);
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

            this._deps.applyScene(update.scene, true);
            this._deps.focusWindow(update.world.focusedWindow);
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
