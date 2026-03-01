/** Branded type for window identity — uses Meta.Window.get_stable_sequence() */
export type WindowId = string & { readonly __brand: 'WindowId' };

/** Branded type for workspace identity */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export interface KestrelConfig {
    readonly gapSize: number;
    readonly edgeGap: number;
    readonly focusBorderWidth: number;
    readonly focusBorderColor: string;
    readonly focusBorderRadius: number;
    readonly focusBgColor: string;
}

export interface MonitorInfo {
    readonly count: number;
    readonly totalWidth: number;
    readonly totalHeight: number;
    readonly slotWidth: number;
    /** Y offset of usable work area (below GNOME top panel) in stage coords */
    readonly workAreaY: number;
    /** X offset of leftmost monitor in stage coords (usually 0) */
    readonly stageOffsetX: number;
}

export interface WindowLayout {
    readonly windowId: WindowId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
    readonly fullscreen: boolean;
}

export interface LayoutState {
    readonly windows: readonly WindowLayout[];
    readonly scrollX: number;
    readonly workspaceIndex: number;
    readonly focusedWindowId: WindowId | null;
}

export interface WorldUpdate {
    readonly world: World;
    readonly scene: SceneModel;
}


// Forward declaration to avoid circular import — imported as type only
import type { World } from './world.js';
import type { SceneModel } from './scene.js';
