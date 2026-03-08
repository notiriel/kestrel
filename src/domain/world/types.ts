/** Branded type for window identity — uses Meta.Window.get_stable_sequence() */
export type WindowId = string & { readonly __brand: 'WindowId' };

/** Branded type for workspace identity */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export interface QuakeSlotConfig {
    readonly appId: string;  // desktop app ID, empty = disabled
}

export interface KestrelConfig {
    readonly gapSize: number;
    readonly edgeGap: number;
    readonly focusBorderWidth: number;
    readonly focusBorderColor: string;
    readonly focusBorderRadius: number;
    readonly focusBgColor: string;
    readonly columnCount: number;
    readonly quakeSlots: readonly QuakeSlotConfig[];
    readonly quakeWidthPercent: number;
    readonly quakeHeightPercent: number;
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

export interface WorldUpdate {
    readonly world: World;
    readonly scene: SceneModel;
}


export type WorkspaceColorId = 'blue' | 'purple' | 'rose' | 'amber' | 'teal' | 'coral' | null;

interface WorkspaceColorEntry {
    readonly id: WorkspaceColorId;
    readonly label: string;
    readonly border: string;   // rgba for focus border
    readonly bg: string;       // rgba for focus background tint
    readonly solid: string;    // opaque hex for card left bar
}

export const WORKSPACE_COLORS: readonly WorkspaceColorEntry[] = [
    { id: null,     label: 'Default', border: '', bg: '', solid: '' },
    { id: 'blue',   label: 'Blue',    border: 'rgba(130,170,220,0.8)', bg: 'rgba(130,170,220,0.05)', solid: '#82aadccc' },
    { id: 'purple', label: 'Purple',  border: 'rgba(175,140,210,0.8)', bg: 'rgba(175,140,210,0.05)', solid: '#af8cd2cc' },
    { id: 'rose',   label: 'Rose',    border: 'rgba(210,140,160,0.8)', bg: 'rgba(210,140,160,0.05)', solid: '#d28ca0cc' },
    { id: 'amber',  label: 'Amber',   border: 'rgba(210,180,120,0.8)', bg: 'rgba(210,180,120,0.05)', solid: '#d2b478cc' },
    { id: 'teal',   label: 'Teal',    border: 'rgba(120,200,200,0.8)', bg: 'rgba(120,200,200,0.05)', solid: '#78c8c8cc' },
    { id: 'coral',  label: 'Coral',   border: 'rgba(210,150,130,0.8)', bg: 'rgba(210,150,130,0.05)', solid: '#d29682cc' },
];

/** Cycle to the next color in the palette: null → blue → … → coral → null */
export function nextWorkspaceColor(current: WorkspaceColorId): WorkspaceColorId {
    const idx = WORKSPACE_COLORS.findIndex(e => e.id === current);
    const next = (idx + 1) % WORKSPACE_COLORS.length;
    return WORKSPACE_COLORS[next]!.id;
}

export function resolveWorkspaceColor(colorId: WorkspaceColorId, config: KestrelConfig): { border: string; bg: string; solid: string } {
    if (colorId === null) return { border: config.focusBorderColor, bg: config.focusBgColor, solid: config.focusBorderColor };
    const entry = WORKSPACE_COLORS.find(e => e.id === colorId);
    return entry ? { border: entry.border, bg: entry.bg, solid: entry.solid } : { border: config.focusBorderColor, bg: config.focusBgColor, solid: config.focusBorderColor };
}

// Forward declaration to avoid circular import — imported as type only
import type { World } from './world.js';
import type { SceneModel } from '../scene/scene.js';
