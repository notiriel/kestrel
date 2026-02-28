import type { WindowId } from './types.js';

export interface OverviewTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export interface OverviewInteractionState {
    active: boolean;
    filterText: string;
    filteredIndices: number[];
    renaming: boolean;
    savedFocusedWindow: WindowId | null;
    savedWorkspaceIndex: number;
    savedScrollX: number;
}

export function createOverviewInteractionState(): OverviewInteractionState {
    return {
        active: false,
        filterText: '',
        filteredIndices: [],
        renaming: false,
        savedFocusedWindow: null,
        savedWorkspaceIndex: 0,
        savedScrollX: 0,
    };
}

// --- State transitions ---

export function enterOverviewInteraction(
    state: OverviewInteractionState,
    focusedWindow: WindowId | null,
    wsIndex: number,
    scrollX: number,
): OverviewInteractionState {
    return {
        ...state,
        active: true,
        filterText: '',
        filteredIndices: [],
        renaming: false,
        savedFocusedWindow: focusedWindow,
        savedWorkspaceIndex: wsIndex,
        savedScrollX: scrollX,
    };
}

export function exitOverviewInteraction(state: OverviewInteractionState): OverviewInteractionState {
    return {
        ...state,
        active: false,
        filterText: '',
        filteredIndices: [],
        renaming: false,
        savedFocusedWindow: null,
        savedWorkspaceIndex: 0,
        savedScrollX: 0,
    };
}

export function cancelOverviewInteraction(state: OverviewInteractionState): {
    newState: OverviewInteractionState;
    savedFocusedWindow: WindowId | null;
    savedWsIndex: number;
    savedScrollX: number;
} {
    return {
        newState: exitOverviewInteraction(state),
        savedFocusedWindow: state.savedFocusedWindow,
        savedWsIndex: state.savedWorkspaceIndex,
        savedScrollX: state.savedScrollX,
    };
}

// --- Filter ---

export function appendFilter(state: OverviewInteractionState, char: string): OverviewInteractionState {
    return { ...state, filterText: state.filterText + char };
}

export function backspaceFilter(state: OverviewInteractionState): OverviewInteractionState {
    if (state.filterText.length === 0) return state;
    return { ...state, filterText: state.filterText.slice(0, -1) };
}

export function clearFilter(state: OverviewInteractionState): OverviewInteractionState {
    return { ...state, filterText: '', filteredIndices: [] };
}

// --- Filtered navigation ---

/**
 * Navigate within a filtered list of workspace indices.
 * Returns the new workspace index to switch to, or null if the list is empty.
 * Wraps around at both ends.
 */
export function navigateFiltered(
    filteredIndices: number[],
    currentWsIndex: number,
    direction: -1 | 1,
): number | null {
    if (filteredIndices.length === 0) return null;

    const currentPos = filteredIndices.indexOf(currentWsIndex);
    let targetPos: number;

    if (currentPos === -1) {
        // Current workspace not in filtered list — go to first
        targetPos = 0;
    } else {
        targetPos = currentPos + direction;
        if (targetPos < 0) targetPos = filteredIndices.length - 1;
        if (targetPos >= filteredIndices.length) targetPos = 0;
    }

    return filteredIndices[targetPos]!;
}

// --- Rename ---

export function startRename(state: OverviewInteractionState): OverviewInteractionState {
    return { ...state, renaming: true };
}

export function finishRename(state: OverviewInteractionState): OverviewInteractionState {
    return { ...state, renaming: false };
}

export function cancelRename(state: OverviewInteractionState): OverviewInteractionState {
    return { ...state, renaming: false };
}

// --- Transform computation ---

/**
 * Compute the scale and offset to fit all workspaces vertically on screen.
 * This is pure coordinate math with no GNOME dependencies.
 *
 * @param monitorWidth - Total monitor width in pixels
 * @param monitorHeight - Total monitor height in pixels
 * @param numWorkspaces - Number of workspaces to display
 * @param maxWorkspaceWidth - Width of the widest workspace content in pixels
 */
export function computeOverviewTransform(
    monitorWidth: number,
    monitorHeight: number,
    numWorkspaces: number,
    maxWorkspaceWidth: number,
): OverviewTransform {
    const OVERVIEW_LABEL_WIDTH = 56;

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

// --- Hit testing ---

interface OverviewWindowPosition {
    windowId: WindowId;
    x: number;
    y: number;
    width: number;
    height: number;
    wsIndex: number;
}

/**
 * Pure coordinate hit test for overview mode.
 * Reverse-maps screen coordinates back to window positions accounting for
 * transform scale/offset, workspace stacking, filtered positions, and label width.
 *
 * @param positions - Window positions from layout computation (per-workspace)
 * @param clickX - Screen X coordinate of click
 * @param clickY - Screen Y coordinate of click
 * @param transform - Current overview transform (scale, offsetX, offsetY)
 * @param filteredIndices - If filtering is active, the visible workspace indices in display order; null means all visible
 * @param monitorHeight - Monitor height in pixels (each workspace occupies one monitorHeight slot)
 * @param labelWidth - Width of the workspace label area on the left
 * @returns WindowId under the click, or null
 */
export function overviewHitTest(
    positions: OverviewWindowPosition[],
    clickX: number,
    clickY: number,
    transform: OverviewTransform,
    filteredIndices: number[] | null,
    monitorHeight: number,
    labelWidth: number,
): WindowId | null {
    const { scale, offsetX, offsetY } = transform;

    // Reverse the transform to get coordinates in overview-space
    const reverseX = (clickX - offsetX) / scale - labelWidth;
    const reverseY = (clickY - offsetY) / scale;

    // Determine which visual slot the click falls in
    const visualSlot = Math.floor(reverseY / monitorHeight);

    // Map visual slot to real workspace index
    let realWsIndex: number;
    if (filteredIndices !== null && filteredIndices.length > 0) {
        if (visualSlot < 0 || visualSlot >= filteredIndices.length) return null;
        realWsIndex = filteredIndices[visualSlot]!;
    } else if (filteredIndices !== null && filteredIndices.length === 0) {
        // Filtering active but no matches
        return null;
    } else {
        // No filtering — visual slot is the workspace index directly
        // (caller should have already filtered to non-empty workspaces)
        if (visualSlot < 0) return null;
        realWsIndex = visualSlot;
    }

    // Local Y within the workspace slot
    const localY = reverseY - visualSlot * monitorHeight;

    // Find windows in the target workspace and test
    for (const pos of positions) {
        if (pos.wsIndex !== realWsIndex) continue;
        if (reverseX >= pos.x && reverseX <= pos.x + pos.width &&
            localY >= pos.y && localY <= pos.y + pos.height) {
            return pos.windowId;
        }
    }

    return null;
}
