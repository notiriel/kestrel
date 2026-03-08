import type { WindowId } from './types.js';

export const OVERVIEW_LABEL_WIDTH = 56;

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
    if (state.renaming) return state;
    return { ...state, filterText: state.filterText + char };
}

export function backspaceFilter(state: OverviewInteractionState): OverviewInteractionState {
    if (state.renaming) return state;
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

// --- Filtered indices ---

export function updateFilteredIndices(state: OverviewInteractionState, indices: number[]): OverviewInteractionState {
    return { ...state, filteredIndices: indices };
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

