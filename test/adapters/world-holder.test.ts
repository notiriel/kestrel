import { describe, it, expect, vi } from 'vitest';
import { WorldHolder } from '../../src/adapters/world-holder.js';
import type { SceneSubscriber, WorldSubscriber, SceneApplyOptions } from '../../src/adapters/world-holder.js';
import { createWorld, addWindow, buildUpdate } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import type { WorldUpdate } from '../../src/domain/types.js';

const CONFIG = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 };
const MONITOR = { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 };

function makeWorld(): World {
    return createWorld(CONFIG, MONITOR);
}

function makeUpdate(world: World): WorldUpdate {
    return buildUpdate(world);
}

describe('WorldHolder', () => {
    describe('setWorld', () => {
        it('stores world and fires world subscribers', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const onWorldChanged = vi.fn();
            holder.subscribeWorld({ onWorldChanged });

            holder.setWorld(world);

            expect(holder.world).toBe(world);
            expect(onWorldChanged).toHaveBeenCalledWith(world);
        });

        it('does not fire scene subscribers', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const onSceneChanged = vi.fn();
            holder.subscribeScene({ onSceneChanged });

            holder.setWorld(world);

            expect(onSceneChanged).not.toHaveBeenCalled();
        });
    });

    describe('applyUpdate', () => {
        it('stores world and fires both world and scene subscribers', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = makeUpdate(world);
            const onWorldChanged = vi.fn();
            const onSceneChanged = vi.fn();
            holder.subscribeWorld({ onWorldChanged });
            holder.subscribeScene({ onSceneChanged });

            const options: SceneApplyOptions = { animate: true };
            holder.applyUpdate(update, options);

            expect(holder.world).toBe(update.world);
            expect(onWorldChanged).toHaveBeenCalledWith(update.world);
            expect(onSceneChanged).toHaveBeenCalledWith(update.scene, options);
        });

        it('fires world subscribers before scene subscribers', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = makeUpdate(world);
            const order: string[] = [];

            holder.subscribeWorld({ onWorldChanged: () => order.push('world') });
            holder.subscribeScene({ onSceneChanged: () => order.push('scene') });

            holder.applyUpdate(update, { animate: false });

            expect(order).toEqual(['world', 'scene']);
        });

        it('fires multiple scene subscribers in registration order', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = makeUpdate(world);
            const order: number[] = [];

            holder.subscribeScene({ onSceneChanged: () => order.push(1) });
            holder.subscribeScene({ onSceneChanged: () => order.push(2) });
            holder.subscribeScene({ onSceneChanged: () => order.push(3) });

            holder.applyUpdate(update, { animate: false });

            expect(order).toEqual([1, 2, 3]);
        });

        it('passes options through to scene subscribers', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = makeUpdate(world);
            const onSceneChanged = vi.fn();
            holder.subscribeScene({ onSceneChanged });

            const options: SceneApplyOptions = {
                animate: true,
                nudgeUnsettled: true,
                scrollTransfer: { workspaceId: 'ws-1' as any, oldScrollX: 100 },
            };
            holder.applyUpdate(update, options);

            expect(onSceneChanged).toHaveBeenCalledWith(update.scene, options);
        });
    });

    describe('unsubscribe', () => {
        it('removes scene subscriber', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = makeUpdate(world);
            const onSceneChanged = vi.fn();
            const sub: SceneSubscriber = { onSceneChanged };

            holder.subscribeScene(sub);
            holder.unsubscribeScene(sub);
            holder.applyUpdate(update, { animate: false });

            expect(onSceneChanged).not.toHaveBeenCalled();
        });

        it('removes world subscriber', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const onWorldChanged = vi.fn();
            const sub: WorldSubscriber = { onWorldChanged };

            holder.subscribeWorld(sub);
            holder.unsubscribeWorld(sub);
            holder.setWorld(world);

            expect(onWorldChanged).not.toHaveBeenCalled();
        });

        it('no-ops when unsubscribing non-existent subscriber', () => {
            const holder = new WorldHolder();
            const sub: SceneSubscriber = { onSceneChanged: vi.fn() };

            // Should not throw
            holder.unsubscribeScene(sub);
            holder.unsubscribeWorld({ onWorldChanged: vi.fn() });
        });
    });

    describe('world getter', () => {
        it('returns null before any world is set', () => {
            const holder = new WorldHolder();
            expect(holder.world).toBeNull();
        });

        it('returns latest world after setWorld', () => {
            const holder = new WorldHolder();
            const world1 = makeWorld();
            const world2 = addWindow(world1, 'w-1' as any).world;

            holder.setWorld(world1);
            holder.setWorld(world2);

            expect(holder.world).toBe(world2);
        });

        it('returns latest world after applyUpdate', () => {
            const holder = new WorldHolder();
            const world = makeWorld();
            const update = addWindow(world, 'w-1' as any);

            holder.applyUpdate(update, { animate: false });

            expect(holder.world).toBe(update.world);
        });
    });
});
