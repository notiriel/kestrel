import { describe, it, expect, beforeEach } from 'vitest';
import type { WindowId, WorkspaceId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow, removeWindow, setFocus, restoreWorld, workspaceNameForWindow, renameCurrentWorkspace, switchToWorkspace } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import { createNotificationState, addNotification, registerSession } from '../../src/domain/notification.js';
import type { DomainNotification } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2 };
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

/** Helper: extract all window IDs from a workspace's columns */
function windowIds(ws: { columns: readonly { windows: readonly { id: WindowId }[] }[] }): WindowId[] {
    return ws.columns.flatMap(c => c.windows.map(w => w.id));
}

describe('World', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    it('starts with one empty workspace and no focus', () => {
        expect(world.workspaces).toHaveLength(1);
        expect(world.workspaces[0]!.columns).toHaveLength(0);
        expect(world.focusedWindow).toBeNull();
    });

    describe('addWindow', () => {
        it('adds a window to the current workspace as a new column', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.workspaces[0]!.columns).toHaveLength(1);
            expect(w.workspaces[0]!.columns[0]!.windows[0]!.id).toBe(wid(1));
        });

        it('focuses the new window', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.focusedWindow).toBe(wid(1));
        });

        it('appends windows in order', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            const ids = windowIds(w3.workspaces[0]!);
            expect(ids).toEqual([wid(1), wid(2), wid(3)]);
        });

        it('always focuses the most recently added window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            expect(w2.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            addWindow(world, wid(1));
            expect(world.workspaces[0]!.columns).toHaveLength(0);
            expect(world.focusedWindow).toBeNull();
        });

        it('scrolls viewport to reveal third window when it is off-screen', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3, scene: s3 } = addWindow(w2, wid(3));

            expect(w3.focusedWindow).toBe(wid(3));
            expect(w3.viewport.scrollX).toBe(968);

            const currentWs = s3.workspaceStrip.workspaces.find(ws => ws.scrollX !== 0);
            expect(currentWs?.scrollX).toBe(968);

            const win3Clone = s3.clones.find(c => c.windowId === wid(3));
            expect(win3Clone).toBeDefined();
            expect(win3Clone!.visible).toBe(true);

            const win1Clone = s3.clones.find(c => c.windowId === wid(1));
            expect(win1Clone!.visible).toBe(false);

            const win2Clone = s3.clones.find(c => c.windowId === wid(2));
            expect(win2Clone!.visible).toBe(true);
        });

        it('does not scroll when new window fits in viewport alongside existing', () => {
            const { world: w1 } = addWindow(world, wid(1));
            expect(w1.viewport.scrollX).toBe(0);

            const { world: w2, scene: s2 } = addWindow(w1, wid(2));
            expect(w2.viewport.scrollX).toBe(0);
            expect(w2.focusedWindow).toBe(wid(2));

            const win1 = s2.clones.find(c => c.windowId === wid(1));
            const win2 = s2.clones.find(c => c.windowId === wid(2));
            expect(win1!.visible).toBe(true);
            expect(win2!.visible).toBe(true);
        });
    });

    describe('removeWindow', () => {
        it('removes a window from the workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(windowIds(w3.workspaces[0]!)).toEqual([wid(2)]);
        });

        it('focuses next window when focused window is removed', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            const { world: w4 } = removeWindow(w3, wid(3));
            expect(w4.focusedWindow).toBe(wid(2));
        });

        it('focuses previous window when removing last window in list', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(2));
            expect(w3.focusedWindow).toBe(wid(1));
        });

        it('sets focus to null when removing the only window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = removeWindow(w1, wid(1));
            expect(w2.focusedWindow).toBeNull();
        });

        it('keeps focus unchanged when removing a non-focused window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            const { world: w1 } = addWindow(world, wid(1));
            removeWindow(w1, wid(1));
            expect(w1.workspaces[0]!.columns).toHaveLength(1);
        });
    });

    describe('dynamic workspaces', () => {
        it('addWindow creates a trailing empty workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            expect(w1.workspaces).toHaveLength(2);
            expect(w1.workspaces[0]!.columns).toHaveLength(1);
            expect(w1.workspaces[1]!.columns).toHaveLength(0);
        });

        it('trailing empty workspace is always present', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            expect(w2.workspaces).toHaveLength(2);
            expect(w2.workspaces[1]!.columns).toHaveLength(0);
        });

        it('removeWindow prunes empty non-trailing workspaces', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = removeWindow(w1, wid(1));
            expect(w2.workspaces).toHaveLength(1);
            expect(w2.workspaces[0]!.columns).toHaveLength(0);
        });

        it('removeWindow finds window across workspaces', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(windowIds(w3.workspaces[0]!)).toEqual([wid(2)]);
        });
    });

    describe('removeWindow: last window on workspace', () => {
        function wsId(n: number): WorkspaceId {
            return `ws-${n}` as WorkspaceId;
        }

        function makeMultiWorld(
            workspaceWindows: number[][],
            viewportWsIndex: number,
            focusedWindowId: number,
        ): World {
            const workspaces = workspaceWindows.map((ids, i) => {
                let ws = createWorkspace(wsId(i));
                for (const id of ids) {
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
            } as World;
        }

        it('navigates to workspace below when current empties', () => {
            const w = makeMultiWorld([[1], [2], [3, 4], []], 1, 2);
            const { world: result } = removeWindow(w, wid(2));
            expect(result.focusedWindow).toBe(wid(3));
            expect(result.workspaces.filter(ws => ws.columns.length > 0)).toHaveLength(2);
        });

        it('navigates to workspace above when nothing below', () => {
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = removeWindow(w, wid(3));
            expect(result.viewport.workspaceIndex).toBe(0);
            expect(result.focusedWindow).toBe(wid(1));
        });

        it('uses slot-based targeting on the target workspace', () => {
            let ws0 = createWorkspace('ws-0' as WorkspaceId);
            ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
            let ws1 = createWorkspace('ws-1' as WorkspaceId);
            ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));
            let ws2 = createWorkspace('ws-2' as WorkspaceId);
            ws2 = addColumn(ws2, createColumn(createTiledWindow(wid(3)), 2));
            ws2 = addColumn(ws2, createColumn(createTiledWindow(wid(4))));
            const trailing = createWorkspace('ws-3' as WorkspaceId);
            const w: World = {
                workspaces: [ws0, ws1, ws2, trailing],
                viewport: { workspaceIndex: 1, scrollX: 0, widthPx: monitor.totalWidth },
                focusedWindow: wid(2),
                config,
                monitor,
                overviewActive: false,
                overviewInteractionState: createOverviewInteractionState(),
                notificationState: createNotificationState(),
            } as World;
            const { world: result } = removeWindow(w, wid(2));
            expect(result.focusedWindow).toBe(wid(3));
        });

        it('prunes the emptied workspace', () => {
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = removeWindow(w, wid(3));
            expect(result.workspaces).toHaveLength(2);
            expect(windowIds(result.workspaces[0]!)).toEqual([wid(1), wid(2)]);
            expect(result.workspaces[1]!.columns).toHaveLength(0);
        });

        it('setFocus switches workspace when target is on a different workspace', () => {
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = setFocus(w, wid(1));
            expect(result.focusedWindow).toBe(wid(1));
            expect(result.viewport.workspaceIndex).toBe(0);
        });

        it('setFocus stays on same workspace when target is on current workspace', () => {
            const w = makeMultiWorld([[1, 2], [3], []], 0, 1);
            const { world: result } = setFocus(w, wid(2));
            expect(result.focusedWindow).toBe(wid(2));
            expect(result.viewport.workspaceIndex).toBe(0);
        });

        it('stays on trailing empty when no populated workspaces exist', () => {
            const w = makeMultiWorld([[1], []], 0, 1);
            const { world: result } = removeWindow(w, wid(1));
            expect(result.focusedWindow).toBeNull();
            expect(result.workspaces).toHaveLength(1);
            expect(result.workspaces[0]!.columns).toHaveLength(0);
        });
    });

    describe('restoreWorld', () => {
        it('creates correct workspace structure', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { columns: [{ windows: [createTiledWindow(wid(1))], slotSpan: 1 }, { windows: [createTiledWindow(wid(2))], slotSpan: 1 }], name: null },
                    { columns: [{ windows: [createTiledWindow(wid(3))], slotSpan: 1 }], name: null },
                ],
                0, 0, wid(1),
            );
            expect(result.workspaces).toHaveLength(3);
            expect(windowIds(result.workspaces[0]!)).toEqual([wid(1), wid(2)]);
            expect(windowIds(result.workspaces[1]!)).toEqual([wid(3)]);
            expect(result.workspaces[2]!.columns).toHaveLength(0);
            expect(result.focusedWindow).toBe(wid(1));
        });

        it('gracefully handles missing focused window', () => {
            const result = restoreWorld(
                config, monitor,
                [{ columns: [{ windows: [createTiledWindow(wid(1))], slotSpan: 1 }], name: null }],
                0, 0, wid(99),
            );
            expect(result.focusedWindow).toBeNull();
        });

        it('prunes empty workspaces from saved state', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { columns: [{ windows: [createTiledWindow(wid(1))], slotSpan: 1 }], name: null },
                    { columns: [], name: null },
                    { columns: [{ windows: [createTiledWindow(wid(2))], slotSpan: 1 }], name: null },
                ],
                0, 0, wid(1),
            );
            expect(result.workspaces).toHaveLength(3);
            expect(windowIds(result.workspaces[0]!)[0]).toBe(wid(1));
            expect(windowIds(result.workspaces[1]!)[0]).toBe(wid(2));
        });

        it('restores viewport position', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { columns: [{ windows: [createTiledWindow(wid(1))], slotSpan: 1 }], name: null },
                    { columns: [{ windows: [createTiledWindow(wid(2))], slotSpan: 1 }], name: null },
                ],
                1, 500, wid(2),
            );
            expect(result.viewport.workspaceIndex).toBe(1);
            expect(result.viewport.scrollX).toBe(500);
        });

        it('clamps viewport index when out of range', () => {
            const result = restoreWorld(
                config, monitor,
                [{ columns: [{ windows: [createTiledWindow(wid(1))], slotSpan: 1 }], name: null }],
                99, 0, wid(1),
            );
            expect(result.viewport.workspaceIndex).toBeLessThan(result.workspaces.length);
        });
    });

    describe('workspaceNameForWindow', () => {
        it('returns workspace name for a window', () => {
            let w = addWindow(world, wid(1)).world;
            w = renameCurrentWorkspace(w, 'Dev');
            expect(workspaceNameForWindow(w, wid(1))).toBe('Dev');
        });

        it('returns default workspace name when not renamed', () => {
            const w = addWindow(world, wid(1)).world;
            expect(workspaceNameForWindow(w, wid(1))).toBe('Workspace 1');
        });

        it('returns null for unknown window', () => {
            expect(workspaceNameForWindow(world, wid(99))).toBeNull();
        });

        it('returns correct name when window is on a non-current workspace', () => {
            let w = addWindow(world, wid(1)).world;
            w = switchToWorkspace(w, 1).world;
            w = addWindow(w, wid(2)).world;
            w = renameCurrentWorkspace(w, 'Other');
            expect(workspaceNameForWindow(w, wid(1))).toBe('Workspace 1');
            expect(workspaceNameForWindow(w, wid(2))).toBe('Other');
        });
    });

    describe('notification domain integration', () => {
        function makeDomainNotification(overrides: Partial<DomainNotification> = {}): DomainNotification {
            return {
                id: 'notif-1',
                sessionId: 'session-1',
                type: 'notification',
                title: 'Agent done',
                message: 'Task complete',
                questions: [],
                status: 'pending',
                response: null,
                timestamp: 1000,
                questionState: {
                    currentPage: 0,
                    answers: new Map(),
                    otherTexts: new Map(),
                    otherActive: new Map(),
                },
                ...overrides,
            };
        }

        it('setFocus auto-dismisses notification-type entries for focused window', () => {
            let w = addWindow(world, wid(1)).world;
            w = addWindow(w, wid(2)).world;
            let ns = registerSession(w.notificationState, 'sess-1', wid(1));
            ns = addNotification(ns, makeDomainNotification({ id: 'n1', sessionId: 'sess-1' }));
            w = { ...w, notificationState: ns };

            const { world: result } = setFocus(w, wid(1));
            expect(result.notificationState.notifications.size).toBe(0);
        });

        it('setFocus does NOT dismiss pending permission entries', () => {
            let w = addWindow(world, wid(1)).world;
            w = addWindow(w, wid(2)).world;
            let ns = registerSession(w.notificationState, 'sess-1', wid(1));
            ns = addNotification(ns, makeDomainNotification({
                id: 'p1', sessionId: 'sess-1', type: 'permission', status: 'pending',
            }));
            w = { ...w, notificationState: ns };

            const { world: result } = setFocus(w, wid(1));
            expect(result.notificationState.notifications.size).toBe(1);
            expect(result.notificationState.notifications.has('p1')).toBe(true);
        });

        it('removeWindow cleans up session/status for destroyed window', () => {
            let w = addWindow(world, wid(1)).world;
            w = addWindow(w, wid(2)).world;
            let ns = registerSession(w.notificationState, 'sess-1', wid(1));
            ns = { ...ns, windowStatuses: new Map(ns.windowStatuses).set(wid(1), 'working') };
            w = { ...w, notificationState: ns };

            const { world: result } = removeWindow(w, wid(1));
            expect(result.notificationState.sessionWindows.has('sess-1')).toBe(false);
            expect(result.notificationState.windowStatuses.has(wid(1))).toBe(false);
        });
    });
});
