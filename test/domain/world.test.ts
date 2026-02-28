import { describe, it, expect, beforeEach } from 'vitest';
import type { WindowId, WorkspaceId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow, removeWindow, setFocus, restoreWorld, workspaceNameForWindow, renameCurrentWorkspace, switchToWorkspace } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace, addWindow as wsAddWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import { createNotificationState, addNotification, registerSession } from '../../src/domain/notification.js';
import type { DomainNotification } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)' };
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

describe('World', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    it('starts with one empty workspace and no focus', () => {
        expect(world.workspaces).toHaveLength(1);
        expect(world.workspaces[0]!.windows).toHaveLength(0);
        expect(world.focusedWindow).toBeNull();
    });

    describe('addWindow', () => {
        it('adds a window to the current workspace', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.workspaces[0]!.windows).toHaveLength(1);
            expect(w.workspaces[0]!.windows[0]!.id).toBe(wid(1));
        });

        it('focuses the new window', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.focusedWindow).toBe(wid(1));
        });

        it('appends windows in order', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            const ids = w3.workspaces[0]!.windows.map(w => w.id);
            expect(ids).toEqual([wid(1), wid(2), wid(3)]);
        });

        it('always focuses the most recently added window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            expect(w2.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            addWindow(world, wid(1));
            expect(world.workspaces[0]!.windows).toHaveLength(0);
            expect(world.focusedWindow).toBeNull();
        });

        it('scrolls viewport to reveal third window when it is off-screen', () => {
            // Monitor: 1920px wide, slotWidth: 960px, gap: 8, edgeGap: 8, focusBorder: 3
            // Layout starts x at edgeGap (8), not effectiveEdge (11)
            // Win1: x=8, width=952 (right=960)
            // Win2: x=968, width=952 (right=1920)
            // Win3: x=1928, width=952 (right=2880) — off-screen at scrollX=0
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3, layout: l3 } = addWindow(w2, wid(3));

            // Focus should be on win-3
            expect(w3.focusedWindow).toBe(wid(3));

            // Viewport must have scrolled so win-3 is visible with edge gap
            // win-3 right edge is 2880, so scrollX = 2880 + 8 (edgeGap) - 1920 = 968
            expect(w3.viewport.scrollX).toBe(968);

            // Layout should reflect the scroll
            expect(l3.scrollX).toBe(968);

            // Win-3 should be visible in the layout
            const win3Layout = l3.windows.find(w => w.windowId === wid(3));
            expect(win3Layout).toBeDefined();
            expect(win3Layout!.visible).toBe(true);

            // Win-1 should now be off-screen (right=960, scrollX=968 → not visible)
            const win1Layout = l3.windows.find(w => w.windowId === wid(1));
            expect(win1Layout!.visible).toBe(false);

            // Win-2 should still be visible (x=968, right=1920, viewport=968..2888)
            const win2Layout = l3.windows.find(w => w.windowId === wid(2));
            expect(win2Layout!.visible).toBe(true);
        });

        it('does not scroll when new window fits in viewport alongside existing', () => {
            // <[A] > + add D → <A[D]> (both visible, no scroll)
            const { world: w1 } = addWindow(world, wid(1));
            expect(w1.viewport.scrollX).toBe(0);

            const { world: w2, layout: l2 } = addWindow(w1, wid(2));
            // Win-2 right edge (1920) fits in viewport (1920px) — no scroll needed
            expect(w2.viewport.scrollX).toBe(0);
            expect(w2.focusedWindow).toBe(wid(2));

            // Both windows should be visible
            const win1 = l2.windows.find(w => w.windowId === wid(1));
            const win2 = l2.windows.find(w => w.windowId === wid(2));
            expect(win1!.visible).toBe(true);
            expect(win2!.visible).toBe(true);
        });
    });

    describe('removeWindow', () => {
        it('removes a window from the workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.workspaces[0]!.windows).toHaveLength(1);
            expect(w3.workspaces[0]!.windows[0]!.id).toBe(wid(2));
        });

        it('focuses next window when focused window is removed', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            // Focus is on wid(3). Remove wid(2) — focus stays on wid(3)
            // But let's test removing the focused window
            // w3.focusedWindow === wid(3), which is last. Remove it → focus wid(2)
            const { world: w4 } = removeWindow(w3, wid(3));
            expect(w4.focusedWindow).toBe(wid(2));
        });

        it('focuses previous window when removing last window in list', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            // w2.focusedWindow === wid(2), remove it → focus wid(1)
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
            // Focus is on wid(2). Remove wid(1).
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            const { world: w1 } = addWindow(world, wid(1));
            removeWindow(w1, wid(1));
            expect(w1.workspaces[0]!.windows).toHaveLength(1);
        });
    });

    describe('dynamic workspaces', () => {
        it('addWindow creates a trailing empty workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            expect(w1.workspaces).toHaveLength(2);
            expect(w1.workspaces[0]!.windows).toHaveLength(1);
            expect(w1.workspaces[1]!.windows).toHaveLength(0);
        });

        it('trailing empty workspace is always present', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            // Still only 2 workspaces: one with windows, one trailing empty
            expect(w2.workspaces).toHaveLength(2);
            expect(w2.workspaces[1]!.windows).toHaveLength(0);
        });

        it('removeWindow prunes empty non-trailing workspaces', () => {
            // Add windows to workspace 0, then remove all of them.
            // Since ws0 becomes empty and is not trailing, it should be pruned.
            const { world: w1 } = addWindow(world, wid(1));
            // w1: [ws0(win-1), ws1(empty)]
            // Now simulate having two populated workspaces by building manually
            // For now, just test the simple case: remove only window
            const { world: w2 } = removeWindow(w1, wid(1));
            // Should have just one empty workspace (the trailing one)
            expect(w2.workspaces).toHaveLength(1);
            expect(w2.workspaces[0]!.windows).toHaveLength(0);
        });

        it('removeWindow finds window across workspaces', () => {
            // Build a world with windows on workspace 0, then manually
            // create a second workspace scenario
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            // Both on workspace 0. Remove wid(1) — should find it
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.workspaces[0]!.windows).toHaveLength(1);
            expect(w3.workspaces[0]!.windows[0]!.id).toBe(wid(2));
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
                    ws = wsAddWindow(ws, createTiledWindow(wid(id)));
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
            // WS0: [A], WS1(current): [B], WS2: [C, D], WS3: [] (trailing)
            const w = makeMultiWorld([[1], [2], [3, 4], []], 1, 2);
            const { world: result } = removeWindow(w, wid(2));

            // Should navigate to WS2 (below), which is now at index 1 after pruning
            expect(result.focusedWindow).toBe(wid(3)); // slot 1 → C
            // WS1 was pruned: [WS0, WS2, trailing]
            expect(result.workspaces.filter(ws => ws.windows.length > 0)).toHaveLength(2);
        });

        it('navigates to workspace above when nothing below', () => {
            // WS0: [A, B], WS1(current): [C], WS2: [] (trailing)
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = removeWindow(w, wid(3));

            // No populated workspace below → go to WS0 (above)
            expect(result.viewport.workspaceIndex).toBe(0);
            expect(result.focusedWindow).toBe(wid(1)); // slot 1 → A
        });

        it('uses slot-based targeting on the target workspace', () => {
            // WS0: [A], WS1(current): [B, C], WS2: [D, E], WS3: []
            // C is focused (slot 2), close C → B remains. Not the "last window" case.
            // Instead: focus B at slot 1, only B on WS1, close B
            // Wait — need WS1 to have one window at slot 2 to test targeting.
            // Let's do: WS0(current): [A, B], WS1: [C, D], WS2: []
            // B focused (slot 2), remove A, then remove B
            // Simpler: WS0(current) has only B at slot 1 (after A removed)...
            //
            // Best test: WS0(current) has [A(full-width, span=2)] at slots 1-2,
            // WS1 has [C, D], trailing.
            // Close A → navigate below → slot 1 targets C.
            // But let's test slot 2 targeting:
            // WS0: [A, B] current, B focused (slot 2). Close A → B still exists. Not last.
            //
            // Use: WS1(current) has one window B. WS2 has [D(full), E]. trailing.
            // B is at slot 1. Close B → navigate to WS2, slot 1 → D (full covers 1-2).
            const ws0 = wsAddWindow(createWorkspace(wsId(0)), createTiledWindow(wid(1)));
            const ws1 = wsAddWindow(createWorkspace(wsId(1)), createTiledWindow(wid(2)));
            const ws2 = wsAddWindow(
                wsAddWindow(createWorkspace(wsId(2)), createTiledWindow(wid(3), 2)),
                createTiledWindow(wid(4)),
            );
            const trailing = createWorkspace(wsId(3));
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
            // Slot 1 on WS2 → D (full-width, spans 1-2)
            expect(result.focusedWindow).toBe(wid(3));
        });

        it('prunes the emptied workspace', () => {
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = removeWindow(w, wid(3));
            // WS1 should be gone — only WS0 + trailing remain
            expect(result.workspaces).toHaveLength(2);
            expect(result.workspaces[0]!.windows.map(w => w.id)).toEqual([wid(1), wid(2)]);
            expect(result.workspaces[1]!.windows).toHaveLength(0); // trailing
        });

        it('setFocus switches workspace when target is on a different workspace', () => {
            // WS0: [A, B], WS1(current): [C], WS2: [] (trailing)
            // Focus is on C. setFocus(A) should switch viewport to WS0.
            const w = makeMultiWorld([[1, 2], [3], []], 1, 3);
            const { world: result } = setFocus(w, wid(1));

            expect(result.focusedWindow).toBe(wid(1));
            expect(result.viewport.workspaceIndex).toBe(0);
        });

        it('setFocus stays on same workspace when target is on current workspace', () => {
            // WS0(current): [A, B], WS1: [C], WS2: [] (trailing)
            // Focus is on A. setFocus(B) should stay on WS0.
            const w = makeMultiWorld([[1, 2], [3], []], 0, 1);
            const { world: result } = setFocus(w, wid(2));

            expect(result.focusedWindow).toBe(wid(2));
            expect(result.viewport.workspaceIndex).toBe(0);
        });

        it('stays on trailing empty when no populated workspaces exist', () => {
            // Only one workspace with one window + trailing
            const w = makeMultiWorld([[1], []], 0, 1);
            const { world: result } = removeWindow(w, wid(1));
            expect(result.focusedWindow).toBeNull();
            expect(result.workspaces).toHaveLength(1);
            expect(result.workspaces[0]!.windows).toHaveLength(0);
        });
    });

    describe('restoreWorld', () => {
        it('creates correct workspace structure', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))] },
                    { windows: [createTiledWindow(wid(3))] },
                ],
                0, 0, wid(1),
            );
            // 2 populated workspaces + 1 trailing empty
            expect(result.workspaces).toHaveLength(3);
            expect(result.workspaces[0]!.windows.map(w => w.id)).toEqual([wid(1), wid(2)]);
            expect(result.workspaces[1]!.windows.map(w => w.id)).toEqual([wid(3)]);
            expect(result.workspaces[2]!.windows).toHaveLength(0);
            expect(result.focusedWindow).toBe(wid(1));
        });

        it('gracefully handles missing focused window', () => {
            const result = restoreWorld(
                config, monitor,
                [{ windows: [createTiledWindow(wid(1))] }],
                0, 0, wid(99), // non-existent
            );
            expect(result.focusedWindow).toBeNull();
        });

        it('prunes empty workspaces from saved state', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { windows: [createTiledWindow(wid(1))] },
                    { windows: [] }, // empty — should be pruned
                    { windows: [createTiledWindow(wid(2))] },
                ],
                0, 0, wid(1),
            );
            // Empty middle workspace pruned: [ws0, ws2, trailing]
            expect(result.workspaces).toHaveLength(3);
            expect(result.workspaces[0]!.windows[0]!.id).toBe(wid(1));
            expect(result.workspaces[1]!.windows[0]!.id).toBe(wid(2));
        });

        it('restores viewport position', () => {
            const result = restoreWorld(
                config, monitor,
                [
                    { windows: [createTiledWindow(wid(1))] },
                    { windows: [createTiledWindow(wid(2))] },
                ],
                1, 500, wid(2),
            );
            expect(result.viewport.workspaceIndex).toBe(1);
            expect(result.viewport.scrollX).toBe(500);
        });

        it('clamps viewport index when out of range', () => {
            const result = restoreWorld(
                config, monitor,
                [{ windows: [createTiledWindow(wid(1))] }],
                99, 0, wid(1),
            );
            // Should be clamped to valid range
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
            // Add window to ws0, navigate to ws1, add another, rename ws1
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
            // Set up: window wid(1) with a session and a notification
            let w = addWindow(world, wid(1)).world;
            w = addWindow(w, wid(2)).world;
            // Register session for wid(1)
            let ns = registerSession(w.notificationState, 'sess-1', wid(1));
            // Add a notification for that session
            ns = addNotification(ns, makeDomainNotification({ id: 'n1', sessionId: 'sess-1' }));
            w = { ...w, notificationState: ns };

            // Focus is on wid(2). setFocus to wid(1) should dismiss the notification.
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
            // Register session for wid(1)
            let ns = registerSession(w.notificationState, 'sess-1', wid(1));
            ns = { ...ns, windowStatuses: new Map(ns.windowStatuses).set(wid(1), 'working') };
            w = { ...w, notificationState: ns };

            const { world: result } = removeWindow(w, wid(1));
            expect(result.notificationState.sessionWindows.has('sess-1')).toBe(false);
            expect(result.notificationState.windowStatuses.has(wid(1))).toBe(false);
        });
    });
});
