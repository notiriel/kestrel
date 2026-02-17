/** Branded type for window identity — uses Meta.Window.get_stable_sequence() */
export type WindowId = string & { readonly __brand: 'WindowId' };

/** Branded type for workspace identity */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export interface PaperFlowConfig {
    readonly gapSize: number;
    readonly edgeGap: number;
    readonly focusBorderWidth: number;
}

export interface MonitorInfo {
    readonly count: number;
    readonly totalWidth: number;
    readonly totalHeight: number;
    readonly slotWidth: number;
    /** Y offset of usable work area (below GNOME top panel) in stage coords */
    readonly workAreaY: number;
}

export interface WindowLayout {
    readonly windowId: WindowId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
}

export interface LayoutState {
    readonly windows: readonly WindowLayout[];
    readonly scrollX: number;
    readonly workspaceIndex: number;
    readonly focusedWindowId: WindowId | null;
}

export interface WorldUpdate {
    readonly world: World;
    readonly layout: LayoutState;
}

/** Delta for horizontal window neighbor lookup: -1 (left/prev) or +1 (right/next) */
export type HorizontalDelta = -1 | 1;

// Forward declaration to avoid circular import — imported as type only
import type { World } from './world.js';
