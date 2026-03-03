import { describe, it, expect, beforeEach } from 'vitest';
import type { WindowId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, restoreWorld } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import {
    createQuakeState,
    restoreQuakeState,
    assignQuakeWindow,
    toggleQuakeSlot,
    dismissQuake,
    releaseQuakeWindow,
    isQuakeWindow,
    computeQuakeGeometry,
    getUnoccupiedQuakeSlots,
} from '../../src/domain/quake.js';
import { computeScene } from '../../src/domain/scene.js';

const config: KestrelConfig = {
    gapSize: 8, edgeGap: 8, focusBorderWidth: 3,
    focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8,
    focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2,
    quakeSlots: [
        { appId: 'org.gnome.Terminal.desktop' },
        { appId: 'org.gnome.Nautilus.desktop' },
        { appId: '' },
        { appId: '' },
        { appId: '' },
    ],
    quakeWidthPercent: 80,
    quakeHeightPercent: 80,
};

const monitor: MonitorInfo = {
    count: 1, totalWidth: 1920, totalHeight: 1080,
    slotWidth: 960, workAreaY: 32, stageOffsetX: 0,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

describe('createQuakeState', () => {
    it('creates state with 5 empty slots and no active slot', () => {
        const state = createQuakeState();
        expect(state.slots).toHaveLength(5);
        expect(state.slots.every(s => s === null)).toBe(true);
        expect(state.activeSlot).toBeNull();
    });
});

describe('assignQuakeWindow', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    it('puts window in slot', () => {
        const { world: w } = assignQuakeWindow(world, 0, wid(1));
        expect(w.quakeState.slots[0]).toBe(wid(1));
    });

    it('does not add window to any workspace', () => {
        const { world: w } = assignQuakeWindow(world, 0, wid(1));
        const allWins = w.workspaces.flatMap(ws =>
            ws.columns.flatMap(c => c.windows.map(win => win.id)),
        );
        expect(allWins).not.toContain(wid(1));
    });

    it('is no-op when slot is already occupied', () => {
        const { world: w1 } = assignQuakeWindow(world, 0, wid(1));
        const { world: w2 } = assignQuakeWindow(w1, 0, wid(2));
        expect(w2.quakeState.slots[0]).toBe(wid(1)); // unchanged
    });

    it('does not change other slots', () => {
        const { world: w1 } = assignQuakeWindow(world, 0, wid(1));
        const { world: w2 } = assignQuakeWindow(w1, 2, wid(2));
        expect(w2.quakeState.slots[0]).toBe(wid(1));
        expect(w2.quakeState.slots[1]).toBeNull();
        expect(w2.quakeState.slots[2]).toBe(wid(2));
    });
});

describe('toggleQuakeSlot', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
        world = assignQuakeWindow(world, 0, wid(1)).world;
    });

    it('activates slot when hidden', () => {
        const { world: w } = toggleQuakeSlot(world, 0);
        expect(w.quakeState.activeSlot).toBe(0);
    });

    it('deactivates slot when already active', () => {
        const w1 = toggleQuakeSlot(world, 0).world;
        const { world: w2 } = toggleQuakeSlot(w1, 0);
        expect(w2.quakeState.activeSlot).toBeNull();
    });

    it('switches to different slot when another is active', () => {
        world = assignQuakeWindow(world, 1, wid(2)).world;
        const w1 = toggleQuakeSlot(world, 0).world;
        expect(w1.quakeState.activeSlot).toBe(0);
        const { world: w2 } = toggleQuakeSlot(w1, 1);
        expect(w2.quakeState.activeSlot).toBe(1);
    });

    it('no-ops when slot has no window', () => {
        const { world: w } = toggleQuakeSlot(world, 3);
        expect(w.quakeState.activeSlot).toBeNull();
    });
});

describe('dismissQuake', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
        world = assignQuakeWindow(world, 0, wid(1)).world;
        world = toggleQuakeSlot(world, 0).world;
    });

    it('clears activeSlot', () => {
        const { world: w } = dismissQuake(world);
        expect(w.quakeState.activeSlot).toBeNull();
    });

    it('no-ops when no active slot', () => {
        const w1 = dismissQuake(world).world;
        const { world: w2 } = dismissQuake(w1);
        expect(w2.quakeState.activeSlot).toBeNull();
    });
});

describe('releaseQuakeWindow', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
        world = assignQuakeWindow(world, 0, wid(1)).world;
    });

    it('clears slot when window is released', () => {
        const { world: w } = releaseQuakeWindow(world, wid(1));
        expect(w.quakeState.slots[0]).toBeNull();
    });

    it('clears activeSlot if released window was active', () => {
        world = toggleQuakeSlot(world, 0).world;
        const { world: w } = releaseQuakeWindow(world, wid(1));
        expect(w.quakeState.activeSlot).toBeNull();
    });

    it('preserves activeSlot if released window was not active', () => {
        world = assignQuakeWindow(world, 1, wid(2)).world;
        world = toggleQuakeSlot(world, 1).world;
        const { world: w } = releaseQuakeWindow(world, wid(1));
        expect(w.quakeState.activeSlot).toBe(1);
        expect(w.quakeState.slots[0]).toBeNull();
    });

    it('no-ops for unknown window', () => {
        const { world: w } = releaseQuakeWindow(world, wid(99));
        expect(w.quakeState.slots[0]).toBe(wid(1));
    });
});

describe('isQuakeWindow', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
        world = assignQuakeWindow(world, 0, wid(1)).world;
    });

    it('returns true for assigned quake window', () => {
        expect(isQuakeWindow(world, wid(1))).toBe(true);
    });

    it('returns false for non-quake window', () => {
        expect(isQuakeWindow(world, wid(99))).toBe(false);
    });
});

describe('computeQuakeGeometry', () => {
    it('produces correct x/y/width/height for 80% config', () => {
        const geo = computeQuakeGeometry(monitor, config);
        expect(geo.width).toBe(Math.round(1920 * 0.8));
        expect(geo.height).toBe(Math.round(1080 * 0.8));
        expect(geo.x).toBe(Math.round((1920 - geo.width) / 2));
        expect(geo.y).toBe(32); // workAreaY
    });

    it('produces correct geometry for 100% width', () => {
        const fullConfig = { ...config, quakeWidthPercent: 100, quakeHeightPercent: 50 };
        const geo = computeQuakeGeometry(monitor, fullConfig);
        expect(geo.width).toBe(1920);
        expect(geo.height).toBe(540);
        expect(geo.x).toBe(0);
    });
});

describe('getUnoccupiedQuakeSlots', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    it('returns configured slots with no window assigned', () => {
        const result = getUnoccupiedQuakeSlots(world);
        expect(result).toEqual([
            { slotIndex: 0, appId: 'org.gnome.Terminal.desktop' },
            { slotIndex: 1, appId: 'org.gnome.Nautilus.desktop' },
        ]);
    });

    it('excludes slots that have a window assigned', () => {
        world = assignQuakeWindow(world, 0, wid(1)).world;
        const result = getUnoccupiedQuakeSlots(world);
        expect(result).toEqual([
            { slotIndex: 1, appId: 'org.gnome.Nautilus.desktop' },
        ]);
    });

    it('returns empty when all configured slots are occupied', () => {
        world = assignQuakeWindow(world, 0, wid(1)).world;
        world = assignQuakeWindow(world, 1, wid(2)).world;
        const result = getUnoccupiedQuakeSlots(world);
        expect(result).toEqual([]);
    });
});

describe('computeScene with quake window', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
        world = assignQuakeWindow(world, 0, wid(1)).world;
    });

    it('returns null quakeWindow when no active slot', () => {
        const scene = computeScene(world);
        expect(scene.quakeWindow).toBeNull();
    });

    it('includes QuakeWindowScene when active', () => {
        world = toggleQuakeSlot(world, 0).world;
        const scene = computeScene(world);
        expect(scene.quakeWindow).not.toBeNull();
        expect(scene.quakeWindow!.windowId).toBe(wid(1));
        expect(scene.quakeWindow!.visible).toBe(true);
        expect(scene.quakeWindow!.width).toBe(Math.round(1920 * 0.8));
        expect(scene.quakeWindow!.height).toBe(Math.round(1080 * 0.8));
        expect(scene.quakeWindow!.y).toBe(32);
    });

    it('returns null quakeWindow when slot has no window', () => {
        world = releaseQuakeWindow(world, wid(1)).world;
        // Even if we somehow had activeSlot set (shouldn't happen normally)
        const scene = computeScene(world);
        expect(scene.quakeWindow).toBeNull();
    });
});

describe('restoreQuakeState', () => {
    it('returns empty state when no saved slots', () => {
        const state = restoreQuakeState(undefined);
        expect(state.slots).toHaveLength(5);
        expect(state.slots.every(s => s === null)).toBe(true);
        expect(state.activeSlot).toBeNull();
    });

    it('returns empty state for empty array', () => {
        const state = restoreQuakeState([]);
        expect(state.slots.every(s => s === null)).toBe(true);
    });

    it('restores saved slot assignments', () => {
        const state = restoreQuakeState([wid(10), null, wid(20), null, null]);
        expect(state.slots[0]).toBe(wid(10));
        expect(state.slots[1]).toBeNull();
        expect(state.slots[2]).toBe(wid(20));
        expect(state.activeSlot).toBeNull();
    });

    it('pads short arrays to 5 slots', () => {
        const state = restoreQuakeState([wid(1), wid(2)]);
        expect(state.slots).toHaveLength(5);
        expect(state.slots[0]).toBe(wid(1));
        expect(state.slots[1]).toBe(wid(2));
        expect(state.slots[2]).toBeNull();
    });
});

describe('restoreWorld with quake slots', () => {
    it('preserves quake slot assignments across restore', () => {
        const restored = restoreWorld(config, monitor, [], 0, 0, null,
            [wid(10), null, wid(20), null, null]);
        expect(restored.quakeState.slots[0]).toBe(wid(10));
        expect(restored.quakeState.slots[1]).toBeNull();
        expect(restored.quakeState.slots[2]).toBe(wid(20));
    });

    it('creates empty quake state when no slots provided', () => {
        const restored = restoreWorld(config, monitor, [], 0, 0, null);
        expect(restored.quakeState.slots.every(s => s === null)).toBe(true);
    });
});
