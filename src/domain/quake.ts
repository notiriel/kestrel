import type { WindowId, MonitorInfo, KestrelConfig, QuakeState, WorldUpdate } from './types.js';
import type { World } from './world.js';
import { buildUpdate } from './world.js';

const SLOT_COUNT = 5;

export function createQuakeState(): QuakeState {
    return {
        slots: Array.from({ length: SLOT_COUNT }, () => null),
        activeSlot: null,
    };
}

/** Restore quake state from saved slot assignments, padding/truncating to SLOT_COUNT. */
export function restoreQuakeState(savedSlots?: readonly (WindowId | null)[]): QuakeState {
    if (!savedSlots || savedSlots.length === 0) return createQuakeState();
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => savedSlots[i] ?? null);
    return { slots, activeSlot: null };
}

export function assignQuakeWindow(world: World, slotIndex: number, windowId: WindowId): WorldUpdate {
    if (world.quakeState.slots[slotIndex] !== null) return buildUpdate(world);
    const slots = world.quakeState.slots.map((s, i) => i === slotIndex ? windowId : s);
    const newWorld: World = {
        ...world,
        quakeState: { ...world.quakeState, slots },
    };
    return buildUpdate(newWorld);
}

export function toggleQuakeSlot(world: World, slotIndex: number): WorldUpdate {
    const { quakeState } = world;
    const windowId = quakeState.slots[slotIndex];
    if (!windowId) return buildUpdate(world);

    const newActiveSlot = quakeState.activeSlot === slotIndex ? null : slotIndex;
    const newWorld: World = {
        ...world,
        quakeState: { ...quakeState, activeSlot: newActiveSlot },
    };
    return buildUpdate(newWorld);
}

export function dismissQuake(world: World): WorldUpdate {
    if (world.quakeState.activeSlot === null) return buildUpdate(world);
    const newWorld: World = {
        ...world,
        quakeState: { ...world.quakeState, activeSlot: null },
    };
    return buildUpdate(newWorld);
}

export function releaseQuakeWindow(world: World, windowId: WindowId): WorldUpdate {
    const slotIndex = world.quakeState.slots.indexOf(windowId);
    if (slotIndex === -1) return buildUpdate(world);

    const slots = world.quakeState.slots.map((s, i) => i === slotIndex ? null : s);
    const activeSlot = world.quakeState.activeSlot === slotIndex ? null : world.quakeState.activeSlot;
    const newWorld: World = {
        ...world,
        quakeState: { slots, activeSlot },
    };
    return buildUpdate(newWorld);
}

/** Get quake slots that are configured but have no window assigned. */
export function getUnoccupiedQuakeSlots(world: World): Array<{ slotIndex: number; appId: string }> {
    const { quakeSlots } = world.config;
    const { slots } = world.quakeState;
    const result: Array<{ slotIndex: number; appId: string }> = [];
    for (let i = 0; i < quakeSlots.length; i++) {
        const appId = quakeSlots[i]?.appId;
        if (appId && slots[i] === null) {
            result.push({ slotIndex: i, appId });
        }
    }
    return result;
}

export function isQuakeWindow(world: World, windowId: WindowId): boolean {
    return world.quakeState.slots.includes(windowId);
}

interface QuakeGeometry {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export function computeQuakeGeometry(monitor: MonitorInfo, config: KestrelConfig): QuakeGeometry {
    const widthFraction = config.quakeWidthPercent / 100;
    const heightFraction = config.quakeHeightPercent / 100;
    const width = Math.round(monitor.totalWidth * widthFraction);
    const height = Math.round(monitor.totalHeight * heightFraction);
    const x = monitor.stageOffsetX + Math.round((monitor.totalWidth - width) / 2);
    const y = monitor.workAreaY;
    return { x, y, width, height };
}
