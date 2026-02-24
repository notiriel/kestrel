import type { WindowId, WorkspaceId, LayoutState, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { addWindow, removeWindow, enterFullscreen, exitFullscreen, widenWindow, findWorkspaceIdForWindow, wsIdAt } from '../domain/world.js';
import { computeLayout } from '../domain/layout.js';
import type { CloneLifecyclePort, CloneRenderPort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { FocusPort } from '../ports/focus-port.js';
import Meta from 'gi://Meta';
import { safeWindow } from './safe-window.js';

export interface WindowLifecycleDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    checkGuard(label: string): boolean;
    applyLayout(layout: LayoutState, animate: boolean): void;
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

            // Check if the window already exists in the domain (restored from saved state)
            const existsInDomain = world.workspaces.some(
                ws => ws.windows.some(w => w.id === windowId),
            );

            if (existsInDomain) {
                if (metaWindow.maximized_horizontally || metaWindow.maximized_vertically) {
                    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                }
                const restoredWsId = findWorkspaceIdForWindow(world, windowId)!;
                this._deps.getWindowAdapter()?.track(windowId, metaWindow);
                this._deps.getFocusAdapter()?.track(windowId, metaWindow);
                this._deps.getCloneAdapter()?.addClone(windowId, metaWindow, restoredWsId);

                const layout = computeLayout(world);
                this._deps.applyLayout(layout, false);
                this._deps.focusWindow(world.focusedWindow);
                this._deps.startSettlement();
                return;
            }

            // Track in adapters
            const wsId = wsIdAt(world, world.viewport.workspaceIndex)!;
            this._deps.getWindowAdapter()?.track(windowId, metaWindow);
            this._deps.getFocusAdapter()?.track(windowId, metaWindow);
            this._deps.getCloneAdapter()?.addClone(windowId, metaWindow, wsId);

            const wasMaximized = metaWindow.maximized_horizontally || metaWindow.maximized_vertically;
            if (wasMaximized) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            const oldScrollX = world.viewport.scrollX;

            let update = addWindow(world, windowId, wasMaximized ? 2 : 1);
            this._deps.setWorld(update.world);

            if (metaWindow.fullscreen) {
                update = enterFullscreen(update.world, windowId);
                this._deps.setWorld(update.world);
                this._deps.getCloneAdapter()?.setWindowFullscreen(windowId, true);
                this._deps.getWindowAdapter()?.setWindowFullscreen(windowId, true);
            }

            this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);
            this._deps.applyLayout(update.layout, false);

            if (update.layout.scrollX !== oldScrollX) {
                this._deps.getCloneAdapter()?.setScroll(oldScrollX);
                this._deps.getCloneAdapter()?.animateViewport(update.layout.scrollX);
            }

            this._deps.focusWindow(update.world.focusedWindow);
            this._deps.startSettlement();
        } catch (e) {
            console.error('[Kestrel] Error handling window ready:', e);
        }
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

            this._deps.getCloneAdapter()?.removeClone(windowId);
            this._deps.getWindowAdapter()?.untrack(windowId);
            this._deps.getFocusAdapter()?.untrack(windowId);
            this._deps.unwatchWindow(windowId);
            this._deps.getCloneAdapter()?.syncWorkspaces(update.world.workspaces);

            this._deps.applyUpdateWithScroll(update, true, oldScrollX, oldWsId);
        } catch (e) {
            console.error('[Kestrel] Error handling window destroyed:', e);
        }
    }

    handleFullscreenChanged(windowId: WindowId, isFullscreen: boolean): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard('fullscreenChanged')) return;

            this._deps.log(`[Kestrel] fullscreen changed: ${windowId} → ${isFullscreen}`);

            const update = isFullscreen
                ? enterFullscreen(world, windowId)
                : exitFullscreen(world, windowId);
            this._deps.setWorld(update.world);

            this._deps.getCloneAdapter()?.setWindowFullscreen(windowId, isFullscreen);
            this._deps.getWindowAdapter()?.setWindowFullscreen(windowId, isFullscreen);

            this._deps.applyLayout(update.layout, true);
            this._deps.focusWindow(update.world.focusedWindow);
        } catch (e) {
            console.error('[Kestrel] Error handling fullscreen change:', e);
        }
    }

    handleWindowMaximized(windowId: WindowId): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            if (!this._deps.checkGuard('windowMaximized')) return;

            this._deps.log(`[Kestrel] window maximized: ${windowId} → widening to 2-slot`);

            const metaWindow = this._deps.getFocusAdapter()?.getMetaWindow(windowId) as Meta.Window | undefined;
            if (metaWindow) {
                metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            const update = widenWindow(world, windowId);
            this._deps.setWorld(update.world);

            this._deps.applyLayout(update.layout, true);
            this._deps.focusWindow(update.world.focusedWindow);
            this._deps.startSettlement();
        } catch (e) {
            console.error('[Kestrel] Error handling window maximized:', e);
        }
    }
}
