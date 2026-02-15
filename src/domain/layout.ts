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
        focusedWindowId: focusedWindow,
    };
}
