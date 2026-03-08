import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type { World } from '../../domain/world/world.js';
import type { WorkspaceId } from '../../domain/world/types.js';
import { visibleItems } from '../../domain/world/todo.js';
import type { TodoMode } from '../../domain/world/todo.js';
import { computeTodoGeometry } from '../../domain/scene/scene.js';
import { buildTodoBackdrop, buildTodoCard, animateTodoIn, animateTodoOut } from '../../ui-components/todo-overlay-builders.js';
import type { TodoOverlayConfig, TodoDisplayItem } from '../../ui-components/todo-overlay-builders.js';

export type TodoKeyAction =
    | { type: 'dismiss' }
    | { type: 'navigate-up' }
    | { type: 'navigate-down' }
    | { type: 'toggle-complete' }
    | { type: 'new-item' }
    | { type: 'start-edit' }
    | { type: 'request-delete' }
    | { type: 'confirm-edit'; entryText: string }
    | { type: 'cancel-edit' }
    | { type: 'confirm-delete' }
    | { type: 'cancel-delete' }
    | { type: 'prune' };

interface TodoAdapterCallbacks {
    onKeyAction(action: TodoKeyAction): void;
    onWorkspaceSwitched(world: World): void;
}

export class TodoOverlayAdapter {
    private _backdrop: St.Widget | null = null;
    private _card: St.BoxLayout | null = null;
    private _entry: St.Entry | null = null;
    private _callbacks: TodoAdapterCallbacks | null = null;
    private _prevActiveWsId: WorkspaceId | null = null;
    private _completionTimers = new Map<string, number>();
    private _grab: { ungrab: () => void } | null = null;
    private _stageKeyPressId: number = 0;
    private _stageButtonPressId: number = 0;
    private _currentMode: TodoMode = 'navigation';

    setCallbacks(callbacks: TodoAdapterCallbacks): void {
        this._callbacks = callbacks;
    }

    onWorldChanged(world: World): void {
        if (needsTodoWorkspaceSync(world)) {
            this._callbacks?.onWorkspaceSwitched(world);
            return;
        }
        this._applyTodoTransition(world);
    }

    private _applyTodoTransition(world: World): void {
        const prev = this._prevActiveWsId;
        const next = world.todoState.activeWorkspaceId;
        this._prevActiveWsId = next;
        this._currentMode = world.todoState.mode;
        const transition = todoTransition(prev, next);
        if (transition === 'open') this._show(world);
        else if (transition === 'close') this._hide(world);
        else if (transition === 'update' && this._backdrop) this._rebuild(world);
    }

    destroy(): void {
        try { this._clearTimers(); this._popModal(); this._removeChrome(); }
        catch (e) { console.error('[Kestrel] Error destroying todo overlay:', e); }
    }

    // --- Show / Hide ---

    private _show(world: World): void {
        this._build(world);
        this._pushModal();
        if (this._backdrop) animateTodoIn(this._backdrop);
    }

    private _hide(_world: World): void {
        if (!this._backdrop) return;
        this._popModal();
        animateTodoOut(this._backdrop, () => {
            try { this._clearTimers(); this._removeChrome(); }
            catch (e) { console.error('[Kestrel] Error hiding todo overlay:', e); }
        });
    }

    private _pushModal(): void {
        if (this._grab) return;
        this._grab = Main.pushModal(global.stage, { actionMode: Shell.ActionMode.ALL });
        this._stageKeyPressId = global.stage.connect('key-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            try { return this._dispatchKey(event.get_key_symbol(), this._currentMode); }
            catch (e) { console.error('[Kestrel] Error in todo key handler:', e); return Clutter.EVENT_PROPAGATE; }
        });
        this._stageButtonPressId = global.stage.connect('button-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            try {
                if (this._isClickInsideCard(event)) return Clutter.EVENT_STOP;
                this._callbacks?.onKeyAction({ type: 'dismiss' });
                return Clutter.EVENT_STOP;
            } catch (e) { console.error('[Kestrel] Error in todo click handler:', e); return Clutter.EVENT_PROPAGATE; }
        });
    }

    private _popModal(): void {
        this._disconnectStageSignals();
        if (!this._grab) return;
        try { Main.popModal(this._grab); } catch (e) { console.error('[Kestrel] Error popping todo modal:', e); }
        this._grab = null;
    }

    private _disconnectStageSignals(): void {
        if (this._stageKeyPressId) { global.stage.disconnect(this._stageKeyPressId); this._stageKeyPressId = 0; }
        if (this._stageButtonPressId) { global.stage.disconnect(this._stageButtonPressId); this._stageButtonPressId = 0; }
    }

    // --- Build / Rebuild ---

    private _build(world: World): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._backdrop = buildTodoBackdrop(monitor.width, monitor.height, monitor.x, monitor.y);
        this._placeCard(world, monitor);
        Main.layoutManager.addTopChrome(this._backdrop, { affectsStruts: false, trackFullscreen: false });
        this._focusEntryIfNeeded(world);
    }

    private _rebuild(world: World): void {
        if (!this._backdrop) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._destroyCard();
        this._placeCard(world, monitor);
        this._focusEntryIfNeeded(world);
        this._manageCompletionTimers(world);
    }

    private _placeCard(world: World, monitor: { x: number }): void {
        const result = buildTodoCard(this._buildConfig(world));
        this._card = result.card;
        this._entry = result.entry;
        const geo = computeTodoGeometry(world.monitor);
        this._card.set_position(geo.x - monitor.x, geo.y);
        this._backdrop!.add_child(this._card);
    }

    private _destroyCard(): void {
        if (!this._card || !this._backdrop) return;
        this._entry = null;
        this._backdrop.remove_child(this._card);
        this._card.destroy();
        this._card = null;
    }

    private _buildConfig(world: World): TodoOverlayConfig {
        const nowMs = Date.now();
        const visible = visibleItems(world.todoState.items, nowMs);
        const wsId = world.todoState.activeWorkspaceId;
        const ws = wsId ? world.workspaces.find(w => w.id === wsId) : null;
        const geo = computeTodoGeometry(world.monitor);
        const items: TodoDisplayItem[] = visible.map((item, i) => ({
            uuid: item.uuid, text: item.text,
            completed: item.completed !== null,
            fadingOut: item.completed !== null,
            number: i + 1,
        }));
        const s = world.todoState;
        return { ...geo, workspaceName: ws?.name ?? null, items, selectedIndex: s.selectedIndex, mode: s.mode, editText: s.editText, editingIndex: s.editingIndex };
    }

    // --- Input handling (translates keys → callbacks) ---

    private _isClickInsideCard(event: Clutter.Event): boolean {
        if (!this._card) return false;
        const [cx, cy] = event.get_coords();
        const [cardX, cardY] = this._card.get_transformed_position();
        return cx >= cardX && cx <= cardX + this._card.width && cy >= cardY && cy <= cardY + this._card.height;
    }

    private _dispatchKey(sym: number, mode: TodoMode): boolean {
        if (mode === 'editing') return this._dispatchEditKey(sym);
        if (mode === 'confirm-delete') return this._dispatchDeleteKey(sym);
        return this._dispatchNavKey(sym);
    }

    private _dispatchNavKey(sym: number): boolean {
        const action = NAV_KEY_MAP.get(sym);
        if (!action) return Clutter.EVENT_PROPAGATE;
        this._callbacks?.onKeyAction(action);
        return Clutter.EVENT_STOP;
    }

    private _dispatchEditKey(sym: number): boolean {
        const action = this._editKeyAction(sym);
        if (!action) return Clutter.EVENT_PROPAGATE;
        this._callbacks?.onKeyAction(action);
        return Clutter.EVENT_STOP;
    }

    private _editKeyAction(sym: number): TodoKeyAction | null {
        if (sym === Clutter.KEY_Escape) return { type: 'cancel-edit' };
        if (ENTER_KEYS.has(sym)) return { type: 'confirm-edit', entryText: this._entry?.get_text() ?? '' };
        return null;
    }

    private _dispatchDeleteKey(sym: number): boolean {
        const action = CONFIRM_DELETE_KEY_MAP.get(sym);
        if (action) this._callbacks?.onKeyAction(action);
        return Clutter.EVENT_STOP;
    }

    // --- Entry focus ---

    private _focusEntryIfNeeded(world: World): void {
        if (world.todoState.mode !== 'editing' || !this._entry) return;
        const entry = this._entry;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                entry.grab_key_focus();
                // St.Entry's clutter_text consumes Enter via 'activate' signal,
                // so the stage key handler never sees it. Connect here instead.
                entry.clutter_text.connect('activate', () => {
                    try {
                        this._callbacks?.onKeyAction({ type: 'confirm-edit', entryText: entry.get_text() ?? '' });
                    } catch (e) { console.error('[Kestrel] Error in todo entry activate:', e); }
                });
            } catch (e) { console.error('[Kestrel] Error focusing todo entry:', e); }
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- Completion timers (fire callback to prune via domain) ---

    private _manageCompletionTimers(world: World): void {
        for (const item of world.todoState.items) {
            if (item.completed === null) { this._clearTimerForItem(item.uuid); continue; }
            if (this._completionTimers.has(item.uuid)) continue;
            this._startCompletionTimer(item.uuid);
        }
    }

    private _startCompletionTimer(uuid: string): void {
        this._clearTimerForItem(uuid);
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10_000, () => {
            try {
                this._completionTimers.delete(uuid);
                this._callbacks?.onKeyAction({ type: 'prune' });
            } catch (e) { console.error('[Kestrel] Error in completion timer:', e); }
            return GLib.SOURCE_REMOVE;
        });
        this._completionTimers.set(uuid, timerId);
    }

    private _clearTimerForItem(uuid: string): void {
        const timerId = this._completionTimers.get(uuid);
        if (timerId !== undefined) { GLib.source_remove(timerId); this._completionTimers.delete(uuid); }
    }

    private _clearTimers(): void {
        for (const [, timerId] of this._completionTimers) GLib.source_remove(timerId);
        this._completionTimers.clear();
    }

    // --- Chrome management ---

    private _removeChrome(): void {
        if (!this._backdrop) return;
        Main.layoutManager.removeChrome(this._backdrop);
        this._backdrop.destroy();
        this._backdrop = null;
        this._card = null;
    }

}


const ENTER_KEYS = new Set([Clutter.KEY_Return, Clutter.KEY_KP_Enter]);

const CONFIRM_DELETE_KEY_MAP: ReadonlyMap<number, TodoKeyAction> = new Map([
    [Clutter.KEY_Return, { type: 'confirm-delete' }],
    [Clutter.KEY_KP_Enter, { type: 'confirm-delete' }],
    [Clutter.KEY_Escape, { type: 'cancel-delete' }],
]);

const NAV_KEY_MAP: ReadonlyMap<number, TodoKeyAction> = new Map([
    [Clutter.KEY_Escape, { type: 'dismiss' }],
    [Clutter.KEY_Up, { type: 'navigate-up' }],
    [Clutter.KEY_k, { type: 'navigate-up' }],
    [Clutter.KEY_Down, { type: 'navigate-down' }],
    [Clutter.KEY_j, { type: 'navigate-down' }],
    [Clutter.KEY_space, { type: 'toggle-complete' }],
    [Clutter.KEY_n, { type: 'new-item' }],
    [Clutter.KEY_F2, { type: 'start-edit' }],
    [Clutter.KEY_Delete, { type: 'request-delete' }],
    [Clutter.KEY_d, { type: 'request-delete' }],
]);

type TodoTransition = 'open' | 'close' | 'update' | 'none';

const TRANSITION_TABLE: Record<string, TodoTransition> = {
    'closed_open': 'open',
    'open_closed': 'close',
    'open_open': 'update',
    'closed_closed': 'none',
};

function todoTransition(prev: WorkspaceId | null, next: WorkspaceId | null): TodoTransition {
    const key = `${prev ? 'open' : 'closed'}_${next ? 'open' : 'closed'}`;
    return TRANSITION_TABLE[key] ?? 'none';
}

function needsTodoWorkspaceSync(world: World): boolean {
    const activeWsId = world.todoState.activeWorkspaceId;
    if (activeWsId === null) return false;
    const currentWsId = world.workspaces[world.viewport.workspaceIndex]?.id ?? null;
    return currentWsId !== null && currentWsId !== activeWsId;
}
