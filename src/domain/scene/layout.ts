import type { WindowId } from '../world/types.js';
import type { World } from '../world/world.js';
import type { Workspace } from '../world/workspace.js';
import { OVERVIEW_LABEL_WIDTH, type OverviewTransform } from '../world/overview-state.js';

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

    for (const col of ws.columns) {
        const columnWidth = col.slotSpan * slotWidth - gapSize;
        const stackCount = col.windows.length;
        let hasFullscreen = false;

        for (let i = 0; i < stackCount; i++) {
            const win = col.windows[i]!;

            if (win.fullscreen) {
                hasFullscreen = true;
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

            // Use integer heights to avoid fractional pixels.
            // Distribute the remainder to the last window.
            const totalStackSpace = windowHeight - (stackCount - 1) * gapSize;
            const baseHeight = Math.floor(totalStackSpace / stackCount);
            const isLast = i === stackCount - 1;
            const stackHeight = isLast
                ? totalStackSpace - baseHeight * (stackCount - 1)
                : baseHeight;
            const winY = windowY + i * (baseHeight + gapSize);

            let visible: boolean;
            if (viewport) {
                const rightEdge = x + columnWidth;
                visible = rightEdge > viewport.scrollX &&
                    x < viewport.scrollX + viewport.widthPx;
            } else {
                visible = true;
            }

            windows.push({
                windowId: win.id,
                x,
                y: winY,
                width: columnWidth,
                height: stackHeight,
                visible,
                fullscreen: false,
            });
        }

        // Don't advance x for fullscreen columns — they're taken out of the strip
        if (!hasFullscreen) {
            x += columnWidth + gapSize;
        }
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

// --- Overview layout ---

/** Compute the total pixel width of a workspace from its columns and config. */
function computeWorkspaceWidth(
    columns: readonly { slotSpan: number }[],
    slotWidth: number,
    gapSize: number,
    edgeGap: number,
): number {
    let width = edgeGap;
    for (const col of columns) {
        width += col.slotSpan * slotWidth - gapSize + gapSize;
    }
    return width + edgeGap - gapSize;
}

/** Compute the width of the widest workspace in pixels. */
export function computeMaxWorkspaceWidth(world: World): number {
    const { slotWidth } = world.monitor;
    const { gapSize, edgeGap } = world.config;
    let maxWsWidth = world.monitor.totalWidth;
    for (const ws of world.workspaces) {
        if (ws.columns.length === 0) continue;
        const w = computeWorkspaceWidth(ws.columns, slotWidth, gapSize, edgeGap);
        if (w > maxWsWidth) maxWsWidth = w;
    }
    return maxWsWidth;
}

/**
 * Compute the scale and offset to fit all workspaces vertically on screen.
 * Pure coordinate math with no GNOME dependencies.
 */
export function computeOverviewTransform(
    monitorWidth: number,
    monitorHeight: number,
    numWorkspaces: number,
    maxWorkspaceWidth: number,
): OverviewTransform {
    const stripHeight = numWorkspaces * monitorHeight;
    const totalWidth = maxWorkspaceWidth + OVERVIEW_LABEL_WIDTH;

    const scaleX = monitorWidth / totalWidth;
    const scaleY = monitorHeight / stripHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    const scaledWidth = totalWidth * scale;
    const scaledHeight = stripHeight * scale;
    const offsetX = Math.round((monitorWidth - scaledWidth) / 2);
    const offsetY = Math.round((monitorHeight - scaledHeight) / 2);

    return { scale, offsetX, offsetY };
}
