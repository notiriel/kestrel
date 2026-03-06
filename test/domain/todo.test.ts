import { describe, it, expect } from 'vitest';
import type { WorkspaceId, MonitorInfo } from '../../src/domain/types.js';
import {
    createTodoState,
    openTodoOverlay,
    toggleTodoOverlay,
    dismissTodoOverlay,
    syncTodoWorkspace,
    visibleItems,
    navigateUp,
    navigateDown,
    todoToggleComplete,
    startNewItem,
    startEditItem,
    confirmEdit,
    cancelEdit,
    requestDelete,
    confirmDelete,
    cancelDelete,
    pruneCompleted,
    todosFilePath,
    todosDir,
    computeTodoGeometry,
} from '../../src/domain/todo.js';
import type { TodoItem, TodoOverlayState } from '../../src/domain/todo.js';

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1080,
    slotWidth: 960,
    workAreaY: 32,
    stageOffsetX: 0,
};

const items: readonly TodoItem[] = [
    { uuid: 'a', text: 'First', completed: null },
    { uuid: 'b', text: 'Second', completed: null },
];

function open(overrideItems?: readonly TodoItem[]): TodoOverlayState {
    return openTodoOverlay(createTodoState(), wsId(0), overrideItems ?? items);
}

describe('Todo domain', () => {
    // ── createTodoState ────────────────────────────────────────────

    describe('createTodoState', () => {
        it('creates empty state with all defaults', () => {
            const state = createTodoState();
            expect(state.activeWorkspaceId).toBeNull();
            expect(state.items).toEqual([]);
            expect(state.selectedIndex).toBe(0);
            expect(state.mode).toBe('navigation');
            expect(state.editText).toBe('');
            expect(state.editingIndex).toBe(-1);
        });
    });

    // ── openTodoOverlay ────────────────────────────────────────────

    describe('openTodoOverlay', () => {
        it('opens with given items and workspace', () => {
            const state = open();
            expect(state.activeWorkspaceId).toBe(wsId(0));
            expect(state.items).toBe(items);
            expect(state.mode).toBe('navigation');
            expect(state.selectedIndex).toBe(0);
        });

        it('resets prior editing state', () => {
            const editing: TodoOverlayState = { ...open(), mode: 'editing', editText: 'partial', editingIndex: 1, selectedIndex: 1 };
            const result = openTodoOverlay(editing, wsId(1), items);
            expect(result.mode).toBe('navigation');
            expect(result.editText).toBe('');
            expect(result.editingIndex).toBe(-1);
            expect(result.selectedIndex).toBe(0);
        });
    });

    // ── toggleTodoOverlay ──────────────────────────────────────────

    describe('toggleTodoOverlay', () => {
        const load = () => items;

        it('opens overlay for workspace', () => {
            const result = toggleTodoOverlay(createTodoState(), wsId(0), load);
            expect(result.activeWorkspaceId).toBe(wsId(0));
            expect(result.items).toBe(items);
        });

        it('closes overlay when toggling same workspace', () => {
            const state = open();
            const result = toggleTodoOverlay(state, wsId(0), load);
            expect(result.activeWorkspaceId).toBeNull();
            expect(result.items).toEqual([]);
        });

        it('switches to different workspace and loads new items', () => {
            const otherItems: TodoItem[] = [{ uuid: 'x', text: 'Other', completed: null }];
            const state = open();
            const result = toggleTodoOverlay(state, wsId(1), () => otherItems);
            expect(result.activeWorkspaceId).toBe(wsId(1));
            expect(result.items).toBe(otherItems);
        });

        it('calls loadItems with the correct wsId', () => {
            const calls: WorkspaceId[] = [];
            toggleTodoOverlay(createTodoState(), wsId(3), (id) => { calls.push(id); return []; });
            expect(calls).toEqual([wsId(3)]);
        });
    });

    // ── dismissTodoOverlay ─────────────────────────────────────────

    describe('dismissTodoOverlay', () => {
        it('dismisses active overlay and clears items', () => {
            const result = dismissTodoOverlay(open());
            expect(result.activeWorkspaceId).toBeNull();
            expect(result.items).toEqual([]);
        });

        it('returns same reference when already dismissed', () => {
            const state = createTodoState();
            expect(dismissTodoOverlay(state)).toBe(state);
        });

        it('resets mode and editing state', () => {
            const editing: TodoOverlayState = { ...open(), mode: 'editing', editText: 'x', editingIndex: 0 };
            const result = dismissTodoOverlay(editing);
            expect(result.mode).toBe('navigation');
            expect(result.editText).toBe('');
            expect(result.editingIndex).toBe(-1);
        });
    });

    // ── syncTodoWorkspace ─────────────────────────────────────────

    describe('syncTodoWorkspace', () => {
        const ws1Items: readonly TodoItem[] = [{ uuid: 'x', text: 'WS1 task', completed: null }];
        const loader = (id: WorkspaceId) => id === wsId(1) ? ws1Items : [];

        it('reloads items when workspace changes while overlay is open', () => {
            const state = open(); // open on ws-0
            const result = syncTodoWorkspace(state, wsId(1), loader);
            expect(result.activeWorkspaceId).toBe(wsId(1));
            expect(result.items).toEqual(ws1Items);
            expect(result.selectedIndex).toBe(0);
            expect(result.mode).toBe('navigation');
        });

        it('returns same reference when workspace has not changed', () => {
            const state = open(); // open on ws-0
            const result = syncTodoWorkspace(state, wsId(0), loader);
            expect(result).toBe(state);
        });

        it('returns same reference when overlay is closed', () => {
            const state = createTodoState();
            const result = syncTodoWorkspace(state, wsId(1), loader);
            expect(result).toBe(state);
        });

        it('resets editing state when switching workspaces', () => {
            const editing: TodoOverlayState = { ...open(), mode: 'editing', editText: 'x', editingIndex: 0 };
            const result = syncTodoWorkspace(editing, wsId(1), loader);
            expect(result.mode).toBe('navigation');
            expect(result.editText).toBe('');
            expect(result.editingIndex).toBe(-1);
        });
    });

    // ── visibleItems ───────────────────────────────────────────────

    describe('visibleItems', () => {
        it('shows all uncompleted items', () => {
            expect(visibleItems(items, Date.now())).toHaveLength(2);
        });

        it('shows recently completed items (under 10s)', () => {
            const now = Date.now();
            const recent: TodoItem[] = [{ uuid: '1', text: 'Done', completed: new Date(now - 5000).toISOString() }];
            expect(visibleItems(recent, now)).toHaveLength(1);
        });

        it('hides items completed over 10s ago', () => {
            const now = Date.now();
            const old: TodoItem[] = [{ uuid: '1', text: 'Old', completed: new Date(now - 11000).toISOString() }];
            expect(visibleItems(old, now)).toHaveLength(0);
        });

        it('returns empty for empty input', () => {
            expect(visibleItems([], Date.now())).toHaveLength(0);
        });

        it('mixes completed and uncompleted', () => {
            const now = Date.now();
            const mixed: TodoItem[] = [
                { uuid: 'a', text: 'Active', completed: null },
                { uuid: 'b', text: 'Recent', completed: new Date(now - 3000).toISOString() },
                { uuid: 'c', text: 'Old', completed: new Date(now - 15000).toISOString() },
            ];
            const visible = visibleItems(mixed, now);
            expect(visible).toHaveLength(2);
            expect(visible.map(i => i.uuid)).toEqual(['a', 'b']);
        });

        it('item exactly at 10s boundary is hidden', () => {
            const now = Date.now();
            const boundary: TodoItem[] = [{ uuid: '1', text: 'Edge', completed: new Date(now - 10000).toISOString() }];
            expect(visibleItems(boundary, now)).toHaveLength(0);
        });
    });

    // ── navigateUp / navigateDown ──────────────────────────────────

    describe('navigateUp', () => {
        it('decreases selectedIndex', () => {
            const state = { ...open(), selectedIndex: 1 };
            expect(navigateUp(state, Date.now()).selectedIndex).toBe(0);
        });

        it('clamps at 0', () => {
            expect(navigateUp(open(), Date.now()).selectedIndex).toBe(0);
        });

        it('no-op in editing mode', () => {
            const state = { ...open(), selectedIndex: 1, mode: 'editing' as const };
            expect(navigateUp(state, Date.now()).selectedIndex).toBe(1);
        });

        it('no-op in confirm-delete mode', () => {
            const state = { ...open(), selectedIndex: 1, mode: 'confirm-delete' as const };
            expect(navigateUp(state, Date.now()).selectedIndex).toBe(1);
        });

        it('no-op with empty items', () => {
            const state = open([]);
            expect(navigateUp(state, Date.now()).selectedIndex).toBe(0);
        });

        it('uses visible count, not total items count', () => {
            const now = Date.now();
            const mixed: TodoItem[] = [
                { uuid: 'a', text: 'Old', completed: new Date(now - 20000).toISOString() },
                { uuid: 'b', text: 'Active', completed: null },
            ];
            const state = { ...open(mixed), selectedIndex: 0 };
            // Only 1 visible item, so navigateUp at 0 stays at 0
            expect(navigateUp(state, now).selectedIndex).toBe(0);
        });
    });

    describe('navigateDown', () => {
        it('increases selectedIndex', () => {
            expect(navigateDown(open(), Date.now()).selectedIndex).toBe(1);
        });

        it('clamps at last visible index', () => {
            const state = { ...open(), selectedIndex: 1 };
            expect(navigateDown(state, Date.now()).selectedIndex).toBe(1);
        });

        it('no-op in editing mode', () => {
            const state = { ...open(), mode: 'editing' as const };
            expect(navigateDown(state, Date.now()).selectedIndex).toBe(0);
        });

        it('no-op with empty items', () => {
            expect(navigateDown(open([]), Date.now()).selectedIndex).toBe(0);
        });

        it('clamps to visible count not total count', () => {
            const now = Date.now();
            const withOld: TodoItem[] = [
                { uuid: 'a', text: 'Active', completed: null },
                { uuid: 'b', text: 'Old', completed: new Date(now - 20000).toISOString() },
            ];
            // 1 visible item, navigateDown from 0 stays at 0
            expect(navigateDown(open(withOld), now).selectedIndex).toBe(0);
        });
    });

    // ── todoToggleComplete ─────────────────────────────────────────

    describe('todoToggleComplete', () => {
        it('marks selected item as completed', () => {
            const result = todoToggleComplete(open(), Date.now());
            expect(result.items[0]!.completed).not.toBeNull();
            expect(result.items[1]!.completed).toBeNull();
        });

        it('uncompletes a completed item', () => {
            const now = Date.now();
            const step1 = todoToggleComplete(open(), now);
            const step2 = todoToggleComplete(step1, now);
            expect(step2.items[0]!.completed).toBeNull();
        });

        it('toggles the item at selectedIndex, not always index 0', () => {
            const state = { ...open(), selectedIndex: 1 };
            const result = todoToggleComplete(state, Date.now());
            expect(result.items[0]!.completed).toBeNull();
            expect(result.items[1]!.completed).not.toBeNull();
        });

        it('returns same state when no visible items', () => {
            const state = open([]);
            expect(todoToggleComplete(state, Date.now())).toBe(state);
        });

        it('returns same state when selectedIndex is out of visible range', () => {
            const state = { ...open(), selectedIndex: 99 };
            expect(todoToggleComplete(state, Date.now())).toBe(state);
        });

        it('does not mutate items not at selectedIndex', () => {
            const threeItems: TodoItem[] = [
                { uuid: 'a', text: 'A', completed: null },
                { uuid: 'b', text: 'B', completed: null },
                { uuid: 'c', text: 'C', completed: null },
            ];
            const state = { ...open(threeItems), selectedIndex: 1 };
            const result = todoToggleComplete(state, Date.now());
            expect(result.items[0]).toBe(threeItems[0]);
            expect(result.items[2]).toBe(threeItems[2]);
            expect(result.items[1]!.completed).not.toBeNull();
        });

        it('operates on visible items when completed items are mixed in', () => {
            const now = Date.now();
            const mixed: TodoItem[] = [
                { uuid: 'old', text: 'Old done', completed: new Date(now - 20000).toISOString() },
                { uuid: 'a', text: 'Active A', completed: null },
                { uuid: 'b', text: 'Active B', completed: null },
            ];
            // visible = [Active A, Active B]. selectedIndex=1 → Active B
            const state = { ...open(mixed), selectedIndex: 1 };
            const result = todoToggleComplete(state, now);
            expect(result.items.find(i => i.uuid === 'b')!.completed).not.toBeNull();
            expect(result.items.find(i => i.uuid === 'a')!.completed).toBeNull();
        });
    });

    // ── startNewItem ───────────────────────────────────────────────

    describe('startNewItem', () => {
        it('enters editing mode for new item', () => {
            const result = startNewItem(open());
            expect(result.mode).toBe('editing');
            expect(result.editingIndex).toBe(-1);
            expect(result.editText).toBe('');
        });

        it('preserves items and selectedIndex', () => {
            const state = { ...open(), selectedIndex: 1 };
            const result = startNewItem(state);
            expect(result.items).toBe(state.items);
            expect(result.selectedIndex).toBe(1);
        });
    });

    // ── startEditItem ──────────────────────────────────────────────

    describe('startEditItem', () => {
        it('enters editing mode with current text of selected item', () => {
            const state = { ...open(), selectedIndex: 1 };
            const result = startEditItem(state, Date.now());
            expect(result.mode).toBe('editing');
            expect(result.editText).toBe('Second');
            expect(result.editingIndex).toBe(1);
        });

        it('uses first item when selectedIndex is 0', () => {
            const result = startEditItem(open(), Date.now());
            expect(result.editText).toBe('First');
            expect(result.editingIndex).toBe(0);
        });

        it('returns same state when no visible item at index', () => {
            const state = open([]);
            expect(startEditItem(state, Date.now())).toBe(state);
        });

        it('returns same state when selectedIndex exceeds visible count', () => {
            const state = { ...open(), selectedIndex: 99 };
            expect(startEditItem(state, Date.now())).toBe(state);
        });
    });

    // ── confirmEdit ────────────────────────────────────────────────

    describe('confirmEdit', () => {
        it('adds new item and moves selection to it', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, 'New task', 'c', Date.now());
            expect(result.mode).toBe('navigation');
            expect(result.items).toHaveLength(3);
            expect(result.items[2]!.text).toBe('New task');
            expect(result.items[2]!.uuid).toBe('c');
            expect(result.items[2]!.completed).toBeNull();
            expect(result.selectedIndex).toBe(2);
        });

        it('preserves existing items when adding new', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, 'Third', 'c', Date.now());
            expect(result.items[0]!.text).toBe('First');
            expect(result.items[1]!.text).toBe('Second');
        });

        it('edits existing item text without changing uuid or completed', () => {
            const state = startEditItem(open(), Date.now());
            const result = confirmEdit(state, 'Updated', 'ignored-uuid', Date.now());
            expect(result.items[0]!.text).toBe('Updated');
            expect(result.items[0]!.uuid).toBe('a');
            expect(result.items[0]!.completed).toBeNull();
        });

        it('does not modify other items when editing', () => {
            const state = startEditItem({ ...open(), selectedIndex: 1 }, Date.now());
            const result = confirmEdit(state, 'Changed', 'x', Date.now());
            expect(result.items[0]).toBe(items[0]);
            expect(result.items[1]!.text).toBe('Changed');
        });

        it('trims whitespace from entry text', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, '  trimmed  ', 'c', Date.now());
            expect(result.items[2]!.text).toBe('trimmed');
        });

        it('does not add item when text is only whitespace', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, '   ', 'c', Date.now());
            expect(result.items).toHaveLength(2);
            expect(result.mode).toBe('navigation');
        });

        it('does not add item when text is empty', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, '', 'c', Date.now());
            expect(result.items).toHaveLength(2);
        });

        it('resets editText and editingIndex', () => {
            const state = startNewItem(open());
            const result = confirmEdit(state, 'Task', 'c', Date.now());
            expect(result.editText).toBe('');
            expect(result.editingIndex).toBe(-1);
        });

        it('handles edit of item in filtered visible list', () => {
            const now = Date.now();
            const mixed: TodoItem[] = [
                { uuid: 'old', text: 'Old', completed: new Date(now - 20000).toISOString() },
                { uuid: 'a', text: 'Active', completed: null },
            ];
            // visible = [Active] at index 0, editingIndex = 0
            const state: TodoOverlayState = { ...open(mixed), selectedIndex: 0, mode: 'editing', editText: 'Active', editingIndex: 0 };
            const result = confirmEdit(state, 'Renamed', 'x', now);
            expect(result.items.find(i => i.uuid === 'a')!.text).toBe('Renamed');
            // Old item untouched
            expect(result.items.find(i => i.uuid === 'old')!.text).toBe('Old');
        });

        it('returns base state when editingIndex points to nonexistent visible item', () => {
            const state: TodoOverlayState = { ...open(), mode: 'editing', editText: 'x', editingIndex: 99 };
            const result = confirmEdit(state, 'x', 'c', Date.now());
            expect(result.mode).toBe('navigation');
            expect(result.items).toHaveLength(2); // unchanged
        });
    });

    // ── cancelEdit ─────────────────────────────────────────────────

    describe('cancelEdit', () => {
        it('returns to navigation and clears edit state', () => {
            const state = startNewItem(open());
            const result = cancelEdit(state);
            expect(result.mode).toBe('navigation');
            expect(result.editText).toBe('');
            expect(result.editingIndex).toBe(-1);
        });

        it('preserves items and selectedIndex', () => {
            const state = startEditItem({ ...open(), selectedIndex: 1 }, Date.now());
            const result = cancelEdit(state);
            expect(result.items).toBe(items);
            expect(result.selectedIndex).toBe(1);
        });
    });

    // ── requestDelete ──────────────────────────────────────────────

    describe('requestDelete', () => {
        it('enters confirm-delete mode', () => {
            const result = requestDelete(open(), Date.now());
            expect(result.mode).toBe('confirm-delete');
        });

        it('returns same state when no item at index (empty list)', () => {
            const state = open([]);
            expect(requestDelete(state, Date.now())).toBe(state);
        });

        it('returns same state when selectedIndex out of visible range', () => {
            const state = { ...open(), selectedIndex: 99 };
            expect(requestDelete(state, Date.now())).toBe(state);
        });
    });

    // ── confirmDelete ──────────────────────────────────────────────

    describe('confirmDelete', () => {
        it('removes item at selectedIndex', () => {
            const state = { ...open(), mode: 'confirm-delete' as const, selectedIndex: 0 };
            const result = confirmDelete(state, Date.now());
            expect(result.items).toHaveLength(1);
            expect(result.items[0]!.uuid).toBe('b');
            expect(result.mode).toBe('navigation');
        });

        it('removes last item and clamps selectedIndex to 0', () => {
            const single: TodoItem[] = [{ uuid: 'x', text: 'Only', completed: null }];
            const state = { ...open(single), mode: 'confirm-delete' as const, selectedIndex: 0 };
            const result = confirmDelete(state, Date.now());
            expect(result.items).toHaveLength(0);
            expect(result.selectedIndex).toBe(0);
        });

        it('clamps selectedIndex when deleting item at end', () => {
            const three: TodoItem[] = [
                { uuid: 'a', text: 'A', completed: null },
                { uuid: 'b', text: 'B', completed: null },
                { uuid: 'c', text: 'C', completed: null },
            ];
            const state = { ...open(three), mode: 'confirm-delete' as const, selectedIndex: 2 };
            const result = confirmDelete(state, Date.now());
            expect(result.items).toHaveLength(2);
            expect(result.selectedIndex).toBe(1);
        });

        it('keeps selectedIndex when deleting item in middle', () => {
            const three: TodoItem[] = [
                { uuid: 'a', text: 'A', completed: null },
                { uuid: 'b', text: 'B', completed: null },
                { uuid: 'c', text: 'C', completed: null },
            ];
            const state = { ...open(three), mode: 'confirm-delete' as const, selectedIndex: 1 };
            const result = confirmDelete(state, Date.now());
            expect(result.items).toHaveLength(2);
            expect(result.items.map(i => i.uuid)).toEqual(['a', 'c']);
            expect(result.selectedIndex).toBe(1); // now points to 'c'
        });

        it('returns to navigation when no item at index', () => {
            const state = { ...open([]), mode: 'confirm-delete' as const, selectedIndex: 0 };
            const result = confirmDelete(state, Date.now());
            expect(result.mode).toBe('navigation');
            expect(result.items).toEqual([]);
        });

        it('deletes correct item from visible list when completed items are mixed in', () => {
            const now = Date.now();
            const mixed: TodoItem[] = [
                { uuid: 'old', text: 'Old', completed: new Date(now - 20000).toISOString() },
                { uuid: 'a', text: 'Active A', completed: null },
                { uuid: 'b', text: 'Active B', completed: null },
            ];
            // visible = [Active A, Active B], delete index 0 = Active A
            const state = { ...open(mixed), mode: 'confirm-delete' as const, selectedIndex: 0 };
            const result = confirmDelete(state, now);
            expect(result.items.map(i => i.uuid)).toEqual(['old', 'b']);
        });
    });

    // ── cancelDelete ───────────────────────────────────────────────

    describe('cancelDelete', () => {
        it('returns to navigation', () => {
            const state = { ...open(), mode: 'confirm-delete' as const };
            expect(cancelDelete(state).mode).toBe('navigation');
        });

        it('preserves items and selectedIndex', () => {
            const state = { ...open(), mode: 'confirm-delete' as const, selectedIndex: 1 };
            const result = cancelDelete(state);
            expect(result.items).toBe(items);
            expect(result.selectedIndex).toBe(1);
        });
    });

    // ── pruneCompleted ─────────────────────────────────────────────

    describe('pruneCompleted', () => {
        it('removes items completed over 10s ago', () => {
            const now = Date.now();
            const withOld: TodoItem[] = [
                { uuid: 'a', text: 'Done', completed: new Date(now - 20000).toISOString() },
                { uuid: 'b', text: 'Active', completed: null },
            ];
            const result = pruneCompleted(open(withOld), now);
            expect(result.items).toHaveLength(1);
            expect(result.items[0]!.uuid).toBe('b');
        });

        it('keeps recently completed items', () => {
            const now = Date.now();
            const recent: TodoItem[] = [
                { uuid: 'a', text: 'Recent', completed: new Date(now - 3000).toISOString() },
                { uuid: 'b', text: 'Active', completed: null },
            ];
            const result = pruneCompleted(open(recent), now);
            expect(result.items).toHaveLength(2);
        });

        it('returns same reference when nothing to prune', () => {
            const state = open();
            expect(pruneCompleted(state, Date.now())).toBe(state);
        });

        it('adjusts selectedIndex when items are removed', () => {
            const now = Date.now();
            const withOld: TodoItem[] = [
                { uuid: 'a', text: 'Old', completed: new Date(now - 20000).toISOString() },
            ];
            const state = { ...open(withOld), selectedIndex: 0 };
            const result = pruneCompleted(state, now);
            expect(result.items).toHaveLength(0);
            expect(result.selectedIndex).toBe(0);
        });

        it('clamps selectedIndex when it exceeds new length', () => {
            const now = Date.now();
            const items: TodoItem[] = [
                { uuid: 'a', text: 'Active', completed: null },
                { uuid: 'b', text: 'Old', completed: new Date(now - 20000).toISOString() },
                { uuid: 'c', text: 'Old2', completed: new Date(now - 20000).toISOString() },
            ];
            const state = { ...open(items), selectedIndex: 2 };
            const result = pruneCompleted(state, now);
            expect(result.items).toHaveLength(1);
            expect(result.selectedIndex).toBe(0);
        });
    });

    // ── End-to-end flows ───────────────────────────────────────────

    describe('end-to-end flows', () => {
        it('add → complete → still visible → prune removes after fade', () => {
            const now = Date.now();
            let state = open([]);

            // Add a task
            state = startNewItem(state);
            state = confirmEdit(state, 'My task', 'uuid-1', now);
            expect(state.items).toHaveLength(1);

            // Complete it
            state = todoToggleComplete(state, now);
            expect(state.items[0]!.completed).not.toBeNull();

            // Still visible right after completion
            expect(visibleItems(state.items, now)).toHaveLength(1);

            // Gone after 10s
            const pruned = pruneCompleted(state, now + 11000);
            expect(pruned.items).toHaveLength(0);
        });

        it('add multiple → navigate → delete middle → selection adjusts', () => {
            const now = Date.now();
            let state = open([]);

            // Add 3 items
            state = startNewItem(state);
            state = confirmEdit(state, 'A', 'u1', now);
            state = startNewItem(state);
            state = confirmEdit(state, 'B', 'u2', now);
            state = startNewItem(state);
            state = confirmEdit(state, 'C', 'u3', now);
            expect(state.items).toHaveLength(3);
            expect(state.selectedIndex).toBe(2); // last added

            // Navigate up to B
            state = navigateUp(state, now);
            expect(state.selectedIndex).toBe(1);

            // Delete B
            state = requestDelete(state, now);
            state = confirmDelete(state, now);
            expect(state.items).toHaveLength(2);
            expect(state.items.map(i => i.text)).toEqual(['A', 'C']);
            expect(state.selectedIndex).toBe(1); // now points to C
        });

        it('edit → cancel → item unchanged', () => {
            let state = open();

            state = startEditItem(state, Date.now());
            expect(state.editText).toBe('First');

            state = cancelEdit(state);
            expect(state.items[0]!.text).toBe('First');
            expect(state.mode).toBe('navigation');
        });

        it('complete → uncomplete before fade → item stays', () => {
            const now = Date.now();
            let state = open();

            state = todoToggleComplete(state, now);
            expect(state.items[0]!.completed).not.toBeNull();

            state = todoToggleComplete(state, now + 5000);
            expect(state.items[0]!.completed).toBeNull();

            const pruned = pruneCompleted(state, now + 15000);
            expect(pruned.items).toHaveLength(2); // nothing pruned
        });

        it('dismiss clears all state including items', () => {
            let state = open();
            state = { ...state, selectedIndex: 1, mode: 'editing', editText: 'x', editingIndex: 0 };
            state = dismissTodoOverlay(state);

            expect(state.activeWorkspaceId).toBeNull();
            expect(state.items).toEqual([]);
            expect(state.selectedIndex).toBe(0);
            expect(state.mode).toBe('navigation');
            expect(state.editText).toBe('');
            expect(state.editingIndex).toBe(-1);
        });
    });

    // ── File paths ─────────────────────────────────────────────────

    describe('file paths', () => {
        it('todosFilePath', () => {
            expect(todosFilePath('/home/user', wsId(0))).toBe('/home/user/.kestrel/ws-0/todos.json');
        });

        it('todosDir', () => {
            expect(todosDir('/home/user', wsId(0))).toBe('/home/user/.kestrel/ws-0');
        });
    });

    // ── computeTodoGeometry ────────────────────────────────────────

    describe('computeTodoGeometry', () => {
        it('returns 50% width, 60% height, centered horizontally', () => {
            const geo = computeTodoGeometry(monitor);
            expect(geo.width).toBe(960);
            expect(geo.height).toBe(648);
            expect(geo.x).toBe(Math.round((1920 - 960) / 2));
            expect(geo.y).toBe(108 + 32);
        });

        it('accounts for stageOffsetX', () => {
            const shifted = { ...monitor, stageOffsetX: 100 };
            expect(computeTodoGeometry(shifted).x).toBe(Math.round((1920 - 960) / 2) + 100);
        });
    });
});
