import type { WindowId } from './types.js';
import type { World } from './world.js';
import type { Workspace } from './workspace.js';

interface WindowPosition {
    readonly windowId: WindowId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
    readonly fullscreen: boolean;
}

/**
 * Compute pixel positions for all windows in a workspace.
 * When viewport is provided, computes visibility against it.
 * When viewport is null, marks all windows visible (for non-current workspaces).
 */
export function computeWindowPositions(
    ws: Workspace,
    config: World['config'],
    monitor: World['monitor'],
    viewport: { scrollX: number; widthPx: number } | null,
): WindowPosition[] {
    const { gapSize, edgeGap, focusBorderWidth } = config;
    const { slotWidth, totalHeight, totalWidth } = monitor;
    const effectiveEdge = edgeGap + focusBorderWidth;
    const windowHeight = totalHeight - effectiveEdge * 2;
    const windowY = effectiveEdge;

    const windows: WindowPosition[] = [];
    let x = edgeGap;

    for (const win of ws.windows) {
        if (win.fullscreen) {
            windows.push({
                windowId: win.id,
                x: 0,
                y: 0,
                width: totalWidth,
                height: totalHeight,
                visible: true,
                fullscreen: true,
            });
            continue;
        }

        const windowWidth = win.slotSpan * slotWidth - gapSize;

        let visible: boolean;
        if (viewport) {
            const rightEdge = x + windowWidth;
            visible = rightEdge > viewport.scrollX &&
                x < viewport.scrollX + viewport.widthPx;
        } else {
            visible = true;
        }

        windows.push({
            windowId: win.id,
            x,
            y: windowY,
            width: windowWidth,
            height: windowHeight,
            visible,
            fullscreen: false,
        });
        x += windowWidth + gapSize;
    }

    return windows;
}

/**
 * Compute the position of the focused window in the current workspace.
 * Returns { x, width } or null if no focused window found.
 */
export function computeFocusedWindowPosition(world: World): { x: number; width: number } | null {
    if (!world.focusedWindow) return null;

    const ws = world.workspaces[world.viewport.workspaceIndex];
    if (!ws) return null;

    const positions = computeWindowPositions(ws, world.config, world.monitor, world.viewport);
    const focused = positions.find(w => w.windowId === world.focusedWindow);
    if (!focused) return null;

    return { x: focused.x, width: focused.width };
}
