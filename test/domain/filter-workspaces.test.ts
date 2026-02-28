import { describe, it, expect } from 'vitest';
import { filterWorkspaces } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace } from '../../src/domain/workspace.js';
import type { KestrelConfig, MonitorInfo, WorkspaceId } from '../../src/domain/types.js';
import { createNotificationState } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)' };
const monitor: MonitorInfo = { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 };

function worldWithNames(...names: (string | null)[]): World {
    return {
        workspaces: names.map((name, i) => createWorkspace(`ws-${i}` as WorkspaceId, name)),
        viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
        focusedWindow: null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
    };
}

describe('filterWorkspaces', () => {
    it('returns empty array for empty query', () => {
        const world = worldWithNames('Docs', 'Code');
        expect(filterWorkspaces(world, '')).toEqual([]);
    });

    it('returns empty array when no workspaces match', () => {
        const world = worldWithNames('Docs', 'Code');
        expect(filterWorkspaces(world, 'xyz')).toEqual([]);
    });

    it('matches a single workspace by name', () => {
        const world = worldWithNames('Docs', 'Code', 'Music');
        const results = filterWorkspaces(world, 'doc');
        expect(results).toHaveLength(1);
        expect(results[0]!.wsIndex).toBe(0);
    });

    it('matches multiple workspaces and sorts by score descending', () => {
        const world = worldWithNames('Dev', 'Design', 'Docs');
        const results = filterWorkspaces(world, 'd');
        expect(results.length).toBe(3);
        // All match 'd' at first char — shorter names get less length penalty,
        // then positional bonus breaks remaining ties
        expect(results[0]!.wsIndex).toBe(0); // Dev (shortest + highest positional)
        expect(results[1]!.wsIndex).toBe(2); // Docs (shorter than Design)
        expect(results[2]!.wsIndex).toBe(1); // Design (longest)
    });

    it('ranks better fuzzy match above positional bonus', () => {
        // 'code' is exact prefix match for 'Code' but only subsequence for 'Config'
        const world = worldWithNames('Config', 'Code');
        const results = filterWorkspaces(world, 'code');
        expect(results.length).toBe(1); // only 'Code' matches 'code' as subsequence
        expect(results[0]!.wsIndex).toBe(1);
    });

    it('skips workspaces with null names', () => {
        const world = worldWithNames(null, 'Docs', null, 'Code');
        const results = filterWorkspaces(world, 'doc');
        expect(results).toHaveLength(1);
        expect(results[0]!.wsIndex).toBe(1);
    });

    it('uses positional tiebreaker for equal-score matches', () => {
        // Same-length names starting with same char get different positional bonuses
        const world = worldWithNames('Aaa', 'Abb', 'Acc');
        const results = filterWorkspaces(world, 'a');
        expect(results.length).toBe(3);
        // All match 'a' at first char with same base score — positional bonus breaks tie
        expect(results[0]!.wsIndex).toBe(0);
        expect(results[1]!.wsIndex).toBe(1);
        expect(results[2]!.wsIndex).toBe(2);
    });

    it('returns scores as positive numbers', () => {
        const world = worldWithNames('Docs', 'Code');
        const results = filterWorkspaces(world, 'doc');
        expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('fuzzy matches subsequences across word boundaries', () => {
        const world = worldWithNames('my_project', 'other');
        const results = filterWorkspaces(world, 'mp');
        expect(results).toHaveLength(1);
        expect(results[0]!.wsIndex).toBe(0);
    });

    it('handles single workspace', () => {
        const world = worldWithNames('Solo');
        const results = filterWorkspaces(world, 'sol');
        expect(results).toHaveLength(1);
        expect(results[0]!.wsIndex).toBe(0);
    });

    it('handles all null-named workspaces', () => {
        const world = worldWithNames(null, null, null);
        expect(filterWorkspaces(world, 'a')).toEqual([]);
    });

    it('matches my expectations', ()=> {
        const world = worldWithNames('DevOps', 'Docs', "Foo");
        const results = filterWorkspaces(world, 'do');
        expect(results).toHaveLength(2);
        expect(results[0]!.wsIndex).toBe(1);
        expect(results[1]!.wsIndex).toBe(0);
    })
});
