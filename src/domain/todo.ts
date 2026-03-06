import type { WorkspaceId, MonitorInfo } from './types.js';

export interface TodoItem {
    readonly uuid: string;
    readonly text: string;
    readonly completed: string | null;  // ISO timestamp or null
}

export type TodoMode = 'navigation' | 'editing' | 'confirm-delete';

export interface TodoOverlayState {
    readonly activeWorkspaceId: WorkspaceId | null;
    readonly items: readonly TodoItem[];
    readonly selectedIndex: number;
    readonly mode: TodoMode;
    readonly editText: string;
    readonly editingIndex: number;  // -1 = new item
}

export function createTodoState(): TodoOverlayState {
    return {
        activeWorkspaceId: null,
        items: [],
        selectedIndex: 0,
        mode: 'navigation',
        editText: '',
        editingIndex: -1,
    };
}

export function openTodoOverlay(state: TodoOverlayState, wsId: WorkspaceId, items: readonly TodoItem[]): TodoOverlayState {
    return { ...state, activeWorkspaceId: wsId, items, selectedIndex: 0, mode: 'navigation', editText: '', editingIndex: -1 };
}

export function toggleTodoOverlay(state: TodoOverlayState, wsId: WorkspaceId, loadItems: (wsId: WorkspaceId) => readonly TodoItem[]): TodoOverlayState {
    if (state.activeWorkspaceId === wsId) {
        return dismissTodoOverlay(state);
    }
    return openTodoOverlay(state, wsId, loadItems(wsId));
}

export function syncTodoWorkspace(state: TodoOverlayState, wsId: WorkspaceId, loadItems: (wsId: WorkspaceId) => readonly TodoItem[]): TodoOverlayState {
    if (state.activeWorkspaceId === null) return state;
    if (state.activeWorkspaceId === wsId) return state;
    return openTodoOverlay(state, wsId, loadItems(wsId));
}

export function dismissTodoOverlay(state: TodoOverlayState): TodoOverlayState {
    if (state.activeWorkspaceId === null) return state;
    return { ...state, activeWorkspaceId: null, items: [], selectedIndex: 0, mode: 'navigation', editText: '', editingIndex: -1 };
}

const FADE_MS = 10_000;

export function visibleItems(items: readonly TodoItem[], nowMs: number): readonly TodoItem[] {
    return items.filter(item => {
        if (item.completed === null) return true;
        const completedMs = new Date(item.completed).getTime();
        return (nowMs - completedMs) < FADE_MS;
    });
}

export function navigateUp(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    if (state.mode !== 'navigation') return state;
    const count = visibleItems(state.items, nowMs).length;
    if (count === 0) return state;
    return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
}

export function navigateDown(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    if (state.mode !== 'navigation') return state;
    const count = visibleItems(state.items, nowMs).length;
    if (count === 0) return state;
    return { ...state, selectedIndex: Math.min(count - 1, state.selectedIndex + 1) };
}

export function todoToggleComplete(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    const visible = visibleItems(state.items, nowMs);
    const item = visible[state.selectedIndex];
    if (!item) return state;
    const newCompleted = item.completed !== null ? null : new Date(nowMs).toISOString();
    const items = state.items.map(i => i.uuid === item.uuid ? { ...i, completed: newCompleted } : i);
    return { ...state, items };
}

export function startNewItem(state: TodoOverlayState): TodoOverlayState {
    return { ...state, mode: 'editing', editText: '', editingIndex: -1 };
}

export function startEditItem(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    const visible = visibleItems(state.items, nowMs);
    const item = visible[state.selectedIndex];
    if (!item) return state;
    return { ...state, mode: 'editing', editText: item.text, editingIndex: state.selectedIndex };
}

export function confirmEdit(state: TodoOverlayState, entryText: string, uuid: string, nowMs: number): TodoOverlayState {
    const text = entryText.trim();
    const base: TodoOverlayState = { ...state, mode: 'navigation', editText: '', editingIndex: -1 };
    if (!text) return base;
    if (state.editingIndex === -1) {
        const items = [...state.items, { uuid, text, completed: null }];
        const newVisible = visibleItems(items, nowMs);
        return { ...base, items, selectedIndex: newVisible.length - 1 };
    }
    const visible = visibleItems(state.items, nowMs);
    const item = visible[state.editingIndex];
    if (!item) return base;
    const items = state.items.map(i => i.uuid === item.uuid ? { ...i, text } : i);
    return { ...base, items };
}

export function cancelEdit(state: TodoOverlayState): TodoOverlayState {
    return { ...state, mode: 'navigation', editText: '', editingIndex: -1 };
}

export function requestDelete(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    const visible = visibleItems(state.items, nowMs);
    if (!visible[state.selectedIndex]) return state;
    return { ...state, mode: 'confirm-delete' };
}

export function confirmDelete(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    const visible = visibleItems(state.items, nowMs);
    const item = visible[state.selectedIndex];
    if (!item) return { ...state, mode: 'navigation' };
    const items = state.items.filter(i => i.uuid !== item.uuid);
    const newVisible = visibleItems(items, nowMs);
    const newIndex = Math.min(state.selectedIndex, Math.max(0, newVisible.length - 1));
    return { ...state, items, mode: 'navigation', selectedIndex: newIndex };
}

export function cancelDelete(state: TodoOverlayState): TodoOverlayState {
    return { ...state, mode: 'navigation' };
}

/** Remove completed items older than FADE_MS from state (called by timer). */
export function pruneCompleted(state: TodoOverlayState, nowMs: number): TodoOverlayState {
    const items = visibleItems(state.items, nowMs);
    if (items.length === state.items.length) return state;
    const newIndex = Math.min(state.selectedIndex, Math.max(0, items.length - 1));
    return { ...state, items, selectedIndex: newIndex };
}

export function todosFilePath(homeDir: string, wsId: WorkspaceId): string {
    return `${homeDir}/.kestrel/${wsId}/todos.json`;
}

export function todosDir(homeDir: string, wsId: WorkspaceId): string {
    return `${homeDir}/.kestrel/${wsId}`;
}

interface TodoGeometry {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export function computeTodoGeometry(monitor: MonitorInfo): TodoGeometry {
    const width = Math.round(monitor.totalWidth * 0.5);
    const height = Math.round(monitor.totalHeight * 0.6);
    const marginY = Math.round(monitor.totalHeight * 0.1);
    const x = Math.round((monitor.totalWidth - width) / 2) + monitor.stageOffsetX;
    const y = marginY + monitor.workAreaY;
    return { x, y, width, height };
}
