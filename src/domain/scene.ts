import type { WindowId, WorkspaceId, LayoutState } from './types.js';
import type { World } from './world.js';

interface SceneMismatch {
    readonly entity: 'clone' | 'realWindow' | 'focusIndicator' | 'workspaceStrip';
    readonly windowId?: WindowId;
    readonly field: string;
    readonly expected: number | boolean | string;
    readonly actual: number | boolean | string;
}

export interface CloneScene {
    readonly windowId: WindowId;
    readonly workspaceId: WorkspaceId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
}

export interface RealWindowScene {
    readonly windowId: WindowId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly opacity: number;
    readonly minimized: boolean;
}

export interface FocusIndicatorScene {
    readonly visible: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface WorkspaceContainerScene {
    readonly workspaceId: WorkspaceId;
    readonly y: number;
    readonly scrollX: number;
}

export interface WorkspaceStripScene {
    readonly y: number;
    readonly workspaces: readonly WorkspaceContainerScene[];
}

export interface SceneModel {
    readonly clones: readonly CloneScene[];
    readonly realWindows: readonly RealWindowScene[];
    readonly focusIndicator: FocusIndicatorScene;
    readonly workspaceStrip: WorkspaceStripScene;
}

/**
 * Compute the complete physical scene from domain state.
 * Pure function — no GNOME imports, no side effects.
 *
 * @param world - Current world state
 * @param layouts - Layout for each workspace (layouts[i] corresponds to workspaces[i])
 */
export function computeScene(world: World, layouts: readonly LayoutState[]): SceneModel {
    const { monitor, config, viewport } = world;
    const currentWsIndex = viewport.workspaceIndex;
    const borderWidth = config.focusBorderWidth;

    const clones: CloneScene[] = [];
    const realWindows: RealWindowScene[] = [];

    for (let wsIndex = 0; wsIndex < layouts.length; wsIndex++) {
        const layout = layouts[wsIndex]!;
        const ws = world.workspaces[wsIndex];
        if (!ws) continue;
        const isCurrent = wsIndex === currentWsIndex;
        const scrollX = isCurrent ? layout.scrollX : 0;

        for (const wl of layout.windows) {
            clones.push({
                windowId: wl.windowId,
                workspaceId: ws.id,
                x: wl.x,
                y: wl.y,
                width: wl.width,
                height: wl.height,
                visible: wl.visible,
            });

            realWindows.push({
                windowId: wl.windowId,
                x: wl.x - scrollX,
                y: wl.y + monitor.workAreaY,
                width: wl.width,
                height: wl.height,
                opacity: wl.fullscreen ? 255 : 0,
                minimized: !isCurrent,
            });
        }
    }

    // Focus indicator
    const currentLayout = layouts[currentWsIndex];
    const focusedWl = currentLayout?.windows.find(
        w => w.windowId === world.focusedWindow,
    );
    let focusIndicator: FocusIndicatorScene;
    if (focusedWl) {
        const scrollX = currentLayout!.scrollX;
        focusIndicator = {
            visible: true,
            x: focusedWl.x - scrollX - borderWidth,
            y: focusedWl.y - borderWidth,
            width: focusedWl.width + borderWidth * 2,
            height: focusedWl.height + borderWidth * 2,
        };
    } else {
        focusIndicator = { visible: false, x: 0, y: 0, width: 0, height: 0 };
    }

    // Workspace strip
    const workspaceContainers: WorkspaceContainerScene[] = [];
    for (let i = 0; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        const layout = layouts[i];
        const isCurrent = i === currentWsIndex;
        workspaceContainers.push({
            workspaceId: ws.id,
            y: i * monitor.totalHeight,
            scrollX: isCurrent && layout ? layout.scrollX : 0,
        });
    }

    const workspaceStrip: WorkspaceStripScene = {
        y: -currentWsIndex * monitor.totalHeight,
        workspaces: workspaceContainers,
    };

    return { clones, realWindows, focusIndicator, workspaceStrip };
}

/**
 * Compare expected vs actual scene models and return mismatches.
 * Used for diagnostics: expected comes from domain computeScene(),
 * actual comes from reading adapter state.
 */
export function diffScene(expected: SceneModel, actual: SceneModel): SceneMismatch[] {
    const mismatches: SceneMismatch[] = [];

    // Compare clones by windowId
    const expectedClones = new Map(expected.clones.map(c => [c.windowId, c]));
    const actualClones = new Map(actual.clones.map(c => [c.windowId, c]));

    for (const [windowId, exp] of expectedClones) {
        const act = actualClones.get(windowId);
        if (!act) {
            mismatches.push({ entity: 'clone', windowId, field: 'missing', expected: 'present', actual: 'absent' });
            continue;
        }
        for (const field of ['x', 'y', 'width', 'height'] as const) {
            if (exp[field] !== act[field]) {
                mismatches.push({ entity: 'clone', windowId, field, expected: exp[field], actual: act[field] });
            }
        }
        if (exp.visible !== act.visible) {
            mismatches.push({ entity: 'clone', windowId, field: 'visible', expected: exp.visible, actual: act.visible });
        }
    }
    for (const windowId of actualClones.keys()) {
        if (!expectedClones.has(windowId)) {
            mismatches.push({ entity: 'clone', windowId, field: 'extra', expected: 'absent', actual: 'present' });
        }
    }

    // Compare real windows by windowId
    const expectedReal = new Map(expected.realWindows.map(r => [r.windowId, r]));
    const actualReal = new Map(actual.realWindows.map(r => [r.windowId, r]));

    for (const [windowId, exp] of expectedReal) {
        const act = actualReal.get(windowId);
        if (!act) {
            mismatches.push({ entity: 'realWindow', windowId, field: 'missing', expected: 'present', actual: 'absent' });
            continue;
        }
        for (const field of ['x', 'y', 'width', 'height'] as const) {
            if (exp[field] !== act[field]) {
                mismatches.push({ entity: 'realWindow', windowId, field, expected: exp[field], actual: act[field] });
            }
        }
        if (exp.opacity !== act.opacity) {
            mismatches.push({ entity: 'realWindow', windowId, field: 'opacity', expected: exp.opacity, actual: act.opacity });
        }
        if (exp.minimized !== act.minimized) {
            mismatches.push({ entity: 'realWindow', windowId, field: 'minimized', expected: exp.minimized, actual: act.minimized });
        }
    }
    for (const windowId of actualReal.keys()) {
        if (!expectedReal.has(windowId)) {
            mismatches.push({ entity: 'realWindow', windowId, field: 'extra', expected: 'absent', actual: 'present' });
        }
    }

    // Compare focus indicator
    const efi = expected.focusIndicator;
    const afi = actual.focusIndicator;
    for (const field of ['visible', 'x', 'y', 'width', 'height'] as const) {
        if (efi[field] !== afi[field]) {
            mismatches.push({ entity: 'focusIndicator', field, expected: efi[field], actual: afi[field] });
        }
    }

    // Compare workspace strip y
    if (expected.workspaceStrip.y !== actual.workspaceStrip.y) {
        mismatches.push({ entity: 'workspaceStrip', field: 'y', expected: expected.workspaceStrip.y, actual: actual.workspaceStrip.y });
    }

    return mismatches;
}
