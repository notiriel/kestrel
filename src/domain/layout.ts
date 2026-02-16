import type { WindowLayout, LayoutState } from './types.js';
import type { World } from './world.js';

/**
 * Computes pixel positions for all windows in the current workspace.
 * Windows tile horizontally: each occupies slotSpan * slotWidth pixels,
 * with gaps between them and at edges.
 *
 * Viewport visibility: windows whose x-range falls entirely outside
 * the visible viewport (scrollX .. scrollX + viewportWidth) are marked invisible.
 */
export function computeLayout(world: World): LayoutState {
    const { config, monitor, viewport, focusedWindow } = world;
    const { gapSize, edgeGap, focusBorderWidth } = config;
    const { slotWidth, totalHeight } = monitor;
    const effectiveEdge = edgeGap + focusBorderWidth;
    const windowHeight = totalHeight - effectiveEdge * 2;
    const windowY = effectiveEdge;

    const ws = world.workspaces[viewport.workspaceIndex]!;
    const windows: WindowLayout[] = [];
    let x = edgeGap;

    for (const win of ws.windows) {
        // Fullscreen windows get a full-monitor layout entry, not a strip position
        if (win.fullscreen) {
            windows.push({
                windowId: win.id,
                x: 0,
                y: 0,
                width: monitor.totalWidth,
                height: monitor.totalHeight,
                visible: true,
            });
            continue;
        }

        const windowWidth = win.slotSpan * slotWidth - gapSize;
        const rightEdge = x + windowWidth;
        const leftEdge = x;
        // Window is visible if it overlaps with the viewport
        const visible =
            rightEdge > viewport.scrollX &&
            leftEdge < viewport.scrollX + viewport.widthPx;

        windows.push({
            windowId: win.id,
            x,
            y: windowY,
            width: windowWidth,
            height: windowHeight,
            visible,
        });
        x += windowWidth + gapSize;
    }

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
    const { config, monitor, viewport, focusedWindow } = world;
    const { gapSize, edgeGap, focusBorderWidth } = config;
    const { slotWidth, totalHeight } = monitor;
    const effectiveEdge = edgeGap + focusBorderWidth;
    const windowHeight = totalHeight - effectiveEdge * 2;
    const windowY = effectiveEdge;

    const ws = world.workspaces[wsIndex];
    if (!ws) return { windows: [], scrollX: viewport.scrollX, workspaceIndex: wsIndex, focusedWindowId: null };

    const windows: WindowLayout[] = [];
    let x = edgeGap;

    for (const win of ws.windows) {
        if (win.fullscreen) {
            windows.push({
                windowId: win.id,
                x: 0,
                y: 0,
                width: monitor.totalWidth,
                height: monitor.totalHeight,
                visible: true,
            });
            continue;
        }

        const windowWidth = win.slotSpan * slotWidth - gapSize;
        windows.push({
            windowId: win.id,
            x,
            y: windowY,
            width: windowWidth,
            height: windowHeight,
            visible: true, // Non-current workspaces: mark all visible for positioning
        });
        x += windowWidth + gapSize;
    }

    // Only report focus if the focused window lives on this workspace
    const hasFocus = focusedWindow && ws.windows.some(w => w.id === focusedWindow);

    return {
        windows,
        scrollX: viewport.scrollX,
        workspaceIndex: wsIndex,
        focusedWindowId: hasFocus ? focusedWindow : null,
    };
}
