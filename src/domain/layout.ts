import type { PaperFlowConfig, MonitorInfo, WindowLayout, LayoutState } from './types.js';
import type { Workspace } from './workspace.js';

/**
 * Computes pixel positions for all windows in a workspace.
 * Windows tile horizontally: each occupies slotSpan * slotWidth pixels,
 * with gaps between them and at edges.
 */
export function computeLayout(
    workspace: Workspace,
    config: PaperFlowConfig,
    monitor: MonitorInfo,
): LayoutState {
    const { gapSize, edgeGap } = config;
    const { slotWidth, totalHeight } = monitor;
    const windowHeight = totalHeight - edgeGap * 2;
    const windowY = edgeGap;

    const windows: WindowLayout[] = [];
    let x = edgeGap;

    for (const win of workspace.windows) {
        const windowWidth = win.slotSpan * slotWidth - gapSize - edgeGap;
        windows.push({
            windowId: win.id,
            x,
            y: windowY,
            width: windowWidth,
            height: windowHeight,
            visible: true,
        });
        x += win.slotSpan * slotWidth;
    }

    return { windows };
}
