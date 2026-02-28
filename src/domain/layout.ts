import type { WindowLayout, LayoutState } from './types.js';
import type { World } from './world.js';
import type { Workspace } from './workspace.js';

/**
 * Shared layout computation for a workspace.
 * When viewport is provided, computes visibility against it.
 * When viewport is null, marks all windows visible (for non-current workspaces).
 */
function computeWindowPositions(
    ws: Workspace,
    config: World['config'],
    monitor: World['monitor'],
    viewport: { scrollX: number; widthPx: number } | null,
): WindowLayout[] {
    const { gapSize, edgeGap, focusBorderWidth } = config;
    const { slotWidth, totalHeight, totalWidth } = monitor;
    const effectiveEdge = edgeGap + focusBorderWidth;
    const windowHeight = totalHeight - effectiveEdge * 2;
    const windowY = effectiveEdge;

    const windows: WindowLayout[] = [];
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
 * Computes pixel positions for all windows in the current workspace.
 */
export function computeLayout(world: World): LayoutState {
    const { viewport, focusedWindow } = world;
    const ws = world.workspaces[viewport.workspaceIndex]!;
    const windows = computeWindowPositions(ws, world.config, world.monitor, viewport);

    return {
        windows,
        scrollX: viewport.scrollX,
        workspaceIndex: viewport.workspaceIndex,
        focusedWindowId: focusedWindow,
    };
}

/**
 * Compute layout for a specific workspace (not necessarily the current one).
 * Used to reposition windows on non-current workspaces after cross-workspace moves.
 */
export function computeLayoutForWorkspace(world: World, wsIndex: number): LayoutState {
    const { viewport, focusedWindow } = world;
    const ws = world.workspaces[wsIndex];
    if (!ws) return { windows: [], scrollX: viewport.scrollX, workspaceIndex: wsIndex, focusedWindowId: null };

    const windows = computeWindowPositions(ws, world.config, world.monitor, null);
    const hasFocus = focusedWindow && ws.windows.some(w => w.id === focusedWindow);

    return {
        windows,
        scrollX: viewport.scrollX,
        workspaceIndex: wsIndex,
        focusedWindowId: hasFocus ? focusedWindow : null,
    };
}
