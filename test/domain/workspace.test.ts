import { describe, it, expect } from 'vitest';
import type { WindowId, WorkspaceId } from '../../src/domain/types.js';
import { createWorkspace, addWindow, slotIndexOf, windowAtSlot } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

describe('slotIndexOf', () => {
    it('returns 1-based index for single-slot windows', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));

        expect(slotIndexOf(ws, wid(1))).toBe(1);
        expect(slotIndexOf(ws, wid(2))).toBe(2);
        expect(slotIndexOf(ws, wid(3))).toBe(3);
    });

    it('accounts for double-slot windows', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1), 2)); // slots 1-2
        ws = addWindow(ws, createTiledWindow(wid(2)));     // slot 3
        ws = addWindow(ws, createTiledWindow(wid(3)));     // slot 4

        expect(slotIndexOf(ws, wid(1))).toBe(1);
        expect(slotIndexOf(ws, wid(2))).toBe(3);
        expect(slotIndexOf(ws, wid(3))).toBe(4);
    });

    it('returns -1 for unknown window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        expect(slotIndexOf(ws, wid(99))).toBe(-1);
    });

    it('returns -1 for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        expect(slotIndexOf(ws, wid(1))).toBe(-1);
    });
});

describe('windowAtSlot', () => {
    it('finds window at exact slot', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));

        expect(windowAtSlot(ws, 1)?.id).toBe(wid(1));
        expect(windowAtSlot(ws, 2)?.id).toBe(wid(2));
        expect(windowAtSlot(ws, 3)?.id).toBe(wid(3));
    });

    it('finds double-width window when slot falls within its span', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1), 2)); // slots 1-2
        ws = addWindow(ws, createTiledWindow(wid(2)));     // slot 3

        expect(windowAtSlot(ws, 1)?.id).toBe(wid(1));
        expect(windowAtSlot(ws, 2)?.id).toBe(wid(1)); // still within double-width
        expect(windowAtSlot(ws, 3)?.id).toBe(wid(2));
    });

    it('returns undefined for slot beyond range', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        expect(windowAtSlot(ws, 5)).toBeUndefined();
    });

    it('returns undefined for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        expect(windowAtSlot(ws, 1)).toBeUndefined();
    });
});
