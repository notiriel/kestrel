import { describe, it, expect } from 'vitest';
import type { WindowId } from '../../src/domain/types.js';
import {
    createOverviewInteractionState,
    enterOverviewInteraction,
    exitOverviewInteraction,
    cancelOverviewInteraction,
    appendFilter,
    backspaceFilter,
    clearFilter,
    navigateFiltered,
    startRename,
    finishRename,
    cancelRename,
    startColorPicking,
    finishColorPicking,
    cancelColorPicking,
    computeOverviewTransform,
    overviewHitTest,
} from '../../src/domain/overview-state.js';

function wid(n: number): WindowId { return n as unknown as WindowId; }

describe('OverviewInteractionState — state transitions', () => {
    it('enterOverviewInteraction saves state', () => {
        const state = createOverviewInteractionState();
        const entered = enterOverviewInteraction(state, wid(42), 2, 100);

        expect(entered.active).toBe(true);
        expect(entered.savedFocusedWindow).toBe(wid(42));
        expect(entered.savedWorkspaceIndex).toBe(2);
        expect(entered.savedScrollX).toBe(100);
        expect(entered.filterText).toBe('');
        expect(entered.renaming).toBe(false);
    });

    it('exitOverviewInteraction clears state', () => {
        const entered = enterOverviewInteraction(
            createOverviewInteractionState(), wid(1), 3, 200,
        );
        const exited = exitOverviewInteraction(entered);

        expect(exited.active).toBe(false);
        expect(exited.filterText).toBe('');
        expect(exited.filteredIndices).toEqual([]);
        expect(exited.renaming).toBe(false);
        expect(exited.savedFocusedWindow).toBeNull();
        expect(exited.savedWorkspaceIndex).toBe(0);
        expect(exited.savedScrollX).toBe(0);
    });

    it('cancelOverviewInteraction returns saved state', () => {
        const entered = enterOverviewInteraction(
            createOverviewInteractionState(), wid(7), 1, 50,
        );
        const result = cancelOverviewInteraction(entered);

        expect(result.savedFocusedWindow).toBe(wid(7));
        expect(result.savedWsIndex).toBe(1);
        expect(result.savedScrollX).toBe(50);
        expect(result.newState.active).toBe(false);
    });

    it('enter then cancel round-trips', () => {
        const initial = createOverviewInteractionState();
        const entered = enterOverviewInteraction(initial, wid(99), 4, 300);
        const cancelled = cancelOverviewInteraction(entered);

        expect(cancelled.savedFocusedWindow).toBe(wid(99));
        expect(cancelled.savedWsIndex).toBe(4);
        expect(cancelled.savedScrollX).toBe(300);
        expect(cancelled.newState.active).toBe(false);
        expect(cancelled.newState.filterText).toBe('');
    });
});

describe('OverviewInteractionState — filter', () => {
    it('appendFilter appends character', () => {
        let state = createOverviewInteractionState();
        state = appendFilter(state, 'a');
        expect(state.filterText).toBe('a');
        state = appendFilter(state, 'b');
        expect(state.filterText).toBe('ab');
    });

    it('backspaceFilter removes last character', () => {
        let state = createOverviewInteractionState();
        state = appendFilter(state, 'h');
        state = appendFilter(state, 'i');
        state = backspaceFilter(state);
        expect(state.filterText).toBe('h');
    });

    it('backspaceFilter on empty string stays empty', () => {
        const state = createOverviewInteractionState();
        const result = backspaceFilter(state);
        expect(result.filterText).toBe('');
        // Should return same reference when no-op
        expect(result).toBe(state);
    });

    it('clearFilter resets to empty', () => {
        let state = createOverviewInteractionState();
        state = appendFilter(state, 'x');
        state = appendFilter(state, 'y');
        state = { ...state, filteredIndices: [0, 2] };
        state = clearFilter(state);
        expect(state.filterText).toBe('');
        expect(state.filteredIndices).toEqual([]);
    });
});

describe('OverviewInteractionState — filtered navigation', () => {
    it('navigateFiltered moves forward in list', () => {
        const result = navigateFiltered([0, 2, 4], 0, 1);
        expect(result).toBe(2);
    });

    it('navigateFiltered wraps at end', () => {
        const result = navigateFiltered([0, 2, 4], 4, 1);
        expect(result).toBe(0);
    });

    it('navigateFiltered wraps at beginning', () => {
        const result = navigateFiltered([0, 2, 4], 0, -1);
        expect(result).toBe(4);
    });

    it('navigateFiltered returns null for empty list', () => {
        const result = navigateFiltered([], 0, 1);
        expect(result).toBeNull();
    });
});

describe('OverviewInteractionState — renaming guard', () => {
    it('appendFilter is no-op when renaming', () => {
        let state = createOverviewInteractionState();
        state = startRename(state);
        const result = appendFilter(state, 'x');
        expect(result).toBe(state);
        expect(result.filterText).toBe('');
    });

    it('backspaceFilter is no-op when renaming', () => {
        let state = createOverviewInteractionState();
        state = appendFilter(state, 'a');
        state = appendFilter(state, 'b');
        state = startRename(state);
        const result = backspaceFilter(state);
        expect(result).toBe(state);
        expect(result.filterText).toBe('ab');
    });
});

describe('OverviewInteractionState — rename', () => {
    it('startRename sets renaming true', () => {
        const state = createOverviewInteractionState();
        const result = startRename(state);
        expect(result.renaming).toBe(true);
    });

    it('finishRename sets renaming false', () => {
        const state = startRename(createOverviewInteractionState());
        const result = finishRename(state);
        expect(result.renaming).toBe(false);
    });

    it('cancelRename sets renaming false', () => {
        const state = startRename(createOverviewInteractionState());
        const result = cancelRename(state);
        expect(result.renaming).toBe(false);
    });
});

describe('OverviewInteractionState — transform computation', () => {
    it('scales down for many workspaces', () => {
        // 5 workspaces on a 1920x1080 monitor — total height = 5400
        // scaleY = 1080/5400 = 0.2
        const transform = computeOverviewTransform(1920, 1080, 5, 1920);
        expect(transform.scale).toBeLessThan(1);
        expect(transform.scale).toBeCloseTo(0.2, 1);
    });

    it('clamps scale to 1.0 for single workspace', () => {
        // 1 workspace, content narrower than monitor
        const transform = computeOverviewTransform(1920, 1080, 1, 800);
        expect(transform.scale).toBe(1);
    });

    it('centers content', () => {
        // With scale < 1, offsets should center the content
        const transform = computeOverviewTransform(1920, 1080, 5, 1920);
        const LABEL_WIDTH = 56;
        const totalWidth = 1920 + LABEL_WIDTH;
        const scaledWidth = totalWidth * transform.scale;
        const expectedOffsetX = Math.round((1920 - scaledWidth) / 2);
        expect(transform.offsetX).toBe(expectedOffsetX);

        const stripHeight = 5 * 1080;
        const scaledHeight = stripHeight * transform.scale;
        const expectedOffsetY = Math.round((1080 - scaledHeight) / 2);
        expect(transform.offsetY).toBe(expectedOffsetY);
    });
});

describe('OverviewInteractionState — hit testing', () => {
    it('finds correct window', () => {
        const transform = { scale: 0.5, offsetX: 100, offsetY: 50 };
        const LABEL_WIDTH = 56;
        const MONITOR_HEIGHT = 1080;

        // Window at (200, 100) with size 400x300 on workspace 0
        const positions = [
            { windowId: wid(1), x: 200, y: 100, width: 400, height: 300, wsIndex: 0 },
            { windowId: wid(2), x: 700, y: 100, width: 400, height: 300, wsIndex: 0 },
        ];

        // Click in the center of window 1:
        // overview-space x = 200 + 200 = 400 (center of window)
        // with label: 400 + 56 = 456
        // scaled: 456 * 0.5 = 228
        // with offset: 228 + 100 = 328
        const clickX = (200 + 200 + LABEL_WIDTH) * 0.5 + 100;
        // overview-space y = 100 + 150 = 250 (center of window)
        // scaled: 250 * 0.5 = 125
        // with offset: 125 + 50 = 175
        const clickY = (100 + 150) * 0.5 + 50;

        const result = overviewHitTest(
            positions, clickX, clickY, transform,
            null, MONITOR_HEIGHT, LABEL_WIDTH,
        );
        expect(result).toBe(wid(1));
    });

    it('returns null outside bounds', () => {
        const transform = { scale: 0.5, offsetX: 100, offsetY: 50 };
        const LABEL_WIDTH = 56;
        const MONITOR_HEIGHT = 1080;

        const positions = [
            { windowId: wid(1), x: 200, y: 100, width: 400, height: 300, wsIndex: 0 },
        ];

        // Click far outside any window
        const result = overviewHitTest(
            positions, 5000, 5000, transform,
            null, MONITOR_HEIGHT, LABEL_WIDTH,
        );
        expect(result).toBeNull();
    });
});

describe('colorPicking state', () => {
    it('defaults to false', () => {
        const state = createOverviewInteractionState();
        expect(state.colorPicking).toBe(false);
    });

    it('startColorPicking sets colorPicking to true', () => {
        const state = startColorPicking(createOverviewInteractionState());
        expect(state.colorPicking).toBe(true);
    });

    it('finishColorPicking resets colorPicking to false', () => {
        let state = startColorPicking(createOverviewInteractionState());
        state = finishColorPicking(state);
        expect(state.colorPicking).toBe(false);
    });

    it('cancelColorPicking resets colorPicking to false', () => {
        let state = startColorPicking(createOverviewInteractionState());
        state = cancelColorPicking(state);
        expect(state.colorPicking).toBe(false);
    });

    it('enterOverviewInteraction resets colorPicking', () => {
        let state = startColorPicking(createOverviewInteractionState());
        state = enterOverviewInteraction(state, null, 0, 0);
        expect(state.colorPicking).toBe(false);
    });

    it('exitOverviewInteraction resets colorPicking', () => {
        let state = startColorPicking(createOverviewInteractionState());
        state = exitOverviewInteraction(state);
        expect(state.colorPicking).toBe(false);
    });
});
