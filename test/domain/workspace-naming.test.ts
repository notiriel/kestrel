import { describe, it, expect, beforeEach } from 'vitest';
import { createTodoState } from '../../src/domain/todo.js';
import type { WindowId, WorkspaceId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import {
    createWorld,
    addWindow,
    removeWindow,
    renameCurrentWorkspace,
    findWorkspaceByName,
    switchToWorkspace,
    restoreWorld,
} from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import { createNotificationState } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1080,
    slotWidth: 960,
    workAreaY: 0,
    stageOffsetX: 0,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

function makeMultiWorld(
    workspaceWindows: { ids: number[]; name?: string | null }[],
    viewportWsIndex: number,
    focusedWindowId: number,
): World {
    const workspaces = workspaceWindows.map((wsData, i) => {
        let ws = createWorkspace(wsId(i), wsData.name ?? null);
        for (const id of wsData.ids) {
            ws = addColumn(ws, createColumn(createTiledWindow(wid(id))));
        }
        return ws;
    });
    return {
        workspaces,
        viewport: { workspaceIndex: viewportWsIndex, scrollX: 0, widthPx: monitor.totalWidth },
        focusedWindow: wid(focusedWindowId),
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
    };
}

describe('Workspace Naming', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    describe('renameCurrentWorkspace', () => {
        it('sets name on current workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const w2 = renameCurrentWorkspace(w1, 'Frontend');
            expect(w2.workspaces[0]!.name).toBe('Frontend');
        });

        it('clears name with null', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const w2 = renameCurrentWorkspace(w1, 'Frontend');
            const w3 = renameCurrentWorkspace(w2, null);
            expect(w3.workspaces[0]!.name).toBeNull();
        });

        it('does not affect other workspaces', () => {
            const w = makeMultiWorld(
                [{ ids: [1], name: 'Backend' }, { ids: [2] }, { ids: [] }],
                1, 2,
            );
            const w2 = renameCurrentWorkspace(w, 'Frontend');
            expect(w2.workspaces[0]!.name).toBe('Backend');
            expect(w2.workspaces[1]!.name).toBe('Frontend');
        });
    });

    describe('findWorkspaceByName', () => {
        it('returns correct index for exact match', () => {
            const w = makeMultiWorld(
                [{ ids: [1], name: 'Frontend' }, { ids: [2], name: 'Backend' }, { ids: [] }],
                0, 1,
            );
            expect(findWorkspaceByName(w, 'Backend')).toBe(1);
        });

        it('returns correct index for case-insensitive substring', () => {
            const w = makeMultiWorld(
                [{ ids: [1], name: 'Frontend App' }, { ids: [2] }, { ids: [] }],
                0, 1,
            );
            expect(findWorkspaceByName(w, 'front')).toBe(0);
        });

        it('returns -1 for no match', () => {
            const w = makeMultiWorld(
                [{ ids: [1], name: 'Frontend' }, { ids: [] }],
                0, 1,
            );
            expect(findWorkspaceByName(w, 'Infra')).toBe(-1);
        });

        it('returns -1 when no workspaces have names', () => {
            const w = makeMultiWorld(
                [{ ids: [1] }, { ids: [] }],
                0, 1,
            );
            expect(findWorkspaceByName(w, 'anything')).toBe(-1);
        });
    });

    describe('switchToWorkspace', () => {
        it('changes viewport to target workspace and focuses first window', () => {
            const w = makeMultiWorld(
                [{ ids: [1, 2] }, { ids: [3, 4] }, { ids: [] }],
                0, 1,
            );
            const { world: result } = switchToWorkspace(w, 1);
            expect(result.viewport.workspaceIndex).toBe(1);
            expect(result.focusedWindow).toBe(wid(3));
            expect(result.viewport.scrollX).toBe(0);
        });

        it('is no-op for out-of-bounds index (negative)', () => {
            const w = makeMultiWorld(
                [{ ids: [1] }, { ids: [] }],
                0, 1,
            );
            const { world: result } = switchToWorkspace(w, -1);
            expect(result.viewport.workspaceIndex).toBe(0);
            expect(result.focusedWindow).toBe(wid(1));
        });

        it('is no-op for out-of-bounds index (too high)', () => {
            const w = makeMultiWorld(
                [{ ids: [1] }, { ids: [] }],
                0, 1,
            );
            const { world: result } = switchToWorkspace(w, 99);
            expect(result.viewport.workspaceIndex).toBe(0);
            expect(result.focusedWindow).toBe(wid(1));
        });

        it('sets focus to null for empty workspace', () => {
            const w = makeMultiWorld(
                [{ ids: [1] }, { ids: [] }],
                0, 1,
            );
            const { world: result } = switchToWorkspace(w, 1);
            expect(result.viewport.workspaceIndex).toBe(1);
            expect(result.focusedWindow).toBeNull();
        });
    });

    describe('names survive pruneEmptyWorkspaces', () => {
        it('preserves names after removing a window causes pruning', () => {
            // WS0: "Frontend" [A], WS1: "Backend" [B], WS2: [] (trailing)
            // Remove B → WS1 pruned. WS0 "Frontend" remains.
            const w = makeMultiWorld(
                [{ ids: [1], name: 'Frontend' }, { ids: [2], name: 'Backend' }, { ids: [] }],
                1, 2,
            );
            const { world: result } = removeWindow(w, wid(2));
            expect(result.workspaces[0]!.name).toBe('Frontend');
        });
    });

    describe('restoreWorld with names', () => {
        it('restores workspace names', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { columns: [createColumn(createTiledWindow(wid(1)))], name: 'Frontend' },
                    { columns: [createColumn(createTiledWindow(wid(2)))], name: 'Backend' },
                ],
                0, 0, wid(1),
            );
            expect(result.workspaces[0]!.name).toBe('Frontend');
            expect(result.workspaces[1]!.name).toBe('Backend');
        });

        it('handles null names from old saved state', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { columns: [createColumn(createTiledWindow(wid(1)))], name: null },
                ],
                0, 0, wid(1),
            );
            expect(result.workspaces[0]!.name).toBeNull();
        });
    });
});
