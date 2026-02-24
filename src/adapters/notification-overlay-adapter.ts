import type { NotificationPort, NotificationInitOptions } from '../ports/notification-port.js';
import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import type { QuestionState, NotificationCardDelegate } from './notification-adapter-types.js';
import { PermissionCard } from './permission-card.js';
import { NotificationCard } from './notification-card.js';
import { QuestionCard } from './question-card.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export type { QuestionState } from './notification-adapter-types.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const CARD_WIDTH = 400;
const QUESTION_CARD_WIDTH = 600;
const CARD_MARGIN = 12;
const CARD_RIGHT_OFFSET = QUESTION_CARD_WIDTH - CARD_WIDTH;
const COLLAPSED_H = 62;
const STACK_OFFSET_Y = 4;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.05;
const ANIMATION_DURATION = 300;

// Kestrel brand palette
const SURFACE_HOVER = '#0f1612';
const BORDER_HOVER = '#243138';
const ACCENT = '#62af85';

interface NotifEntry {
    notification: OverlayNotification;
    delegate: NotificationCardDelegate;
    cardExpanded: boolean;
    response: string | null;
}

export class NotificationOverlayAdapter implements NotificationPort {
    private _container: St.Widget | null = null;
    private _entries: Map<string, NotifEntry> = new Map();
    private _responses: Map<string, string> = new Map();
    private _stackExpanded: boolean = false;
    private _countBadge: St.Label | null = null;
    private _onVisitSession: ((sessionId: string) => void) | null = null;
    private _focusSignalId: number = 0;
    private _extensionPath: string = '';

    /** Callback invoked when entries are added, removed, or responded to. */
    onEntriesChanged: (() => void) | null = null;

    init(options?: NotificationInitOptions & { extensionPath?: string }): void {
        try {
            this._onVisitSession = options?.onVisitSession ?? null;
            this._extensionPath = options?.extensionPath ?? '';

            this._container = new St.Widget({
                style: 'padding: 0;',
                reactive: true,
                clip_to_allocation: false,
                layout_manager: new Clutter.FixedLayout(),
            });

            this._container.connect('enter-event', () => {
                if (this._entries.size <= 1) return;
                this._stackExpanded = true;
                const first = this._entries.values().next().value as NotifEntry | undefined;
                if (first) this._expandCard(first);
                this._relayout();
            });
            this._container.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
                const related = (event as Clutter.Event).get_related();
                if (related && this._container!.contains(related)) return;

                this._stackExpanded = false;
                for (const entry of this._entries.values()) {
                    this._collapseCard(entry);
                }
                this._relayout();
            });

            Main.layoutManager.addTopChrome(this._container, {
                affectsStruts: false,
                trackFullscreen: false,
            });

            this._container.width = QUESTION_CARD_WIDTH + CARD_MARGIN * 2;
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                this._container.set_position(
                    monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
                    monitor.y + Main.panel.height + CARD_MARGIN,
                );
            }

            this._countBadge = new St.Label({
                text: '0',
                style: `background-color: ${ACCENT}; color: #fff; font-family: monospace; font-size: 11px; font-weight: bold; border-radius: 100px; padding: 2px 7px; min-width: 22px; text-align: center;`,
                visible: false,
                reactive: false,
            });
            this._container.add_child(this._countBadge);

            this._focusSignalId = global.display.connect('notify::focus-window', () => {
                try {
                    const focusedWindow = global.display.focus_window;
                    if (!focusedWindow) return;
                    const monitorIndex = focusedWindow.get_monitor();
                    const monitor = global.display.get_monitor_geometry(monitorIndex);
                    if (monitor) {
                        this._repositionToMonitor(monitor);
                    }
                } catch (e) {
                    console.error('[Kestrel] Error repositioning notification overlay:', e);
                }
            });
        } catch (e) {
            console.error('[Kestrel] Error creating notification overlay:', e);
        }
    }

    showPermission(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));
            const notification = this._buildNotification(id, payload, 'permission');

            const delegate = new PermissionCard(notification, {
                extensionPath: this._extensionPath,
                onRespond: (nid, action) => this._respond(nid, action),
            });

            this._addEntry(id, notification, delegate);
        } catch (e) {
            console.error('[Kestrel] Error showing permission notification:', e);
        }
    }

    showNotification(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));
            const notification = this._buildNotification(id, payload, 'notification');

            const delegate = new NotificationCard(notification, {
                extensionPath: this._extensionPath,
                onRespond: (nid, action) => this._respond(nid, action),
                onVisitSession: this._onVisitSession ?? undefined,
            });

            this._addEntry(id, notification, delegate);
        } catch (e) {
            console.error('[Kestrel] Error showing notification:', e);
        }
    }

    showQuestion(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));

            const rawQuestions = payload.questions as readonly QuestionDefinition[] | undefined;
            if (!rawQuestions || rawQuestions.length === 0) {
                this.showPermission(id, payload);
                return;
            }

            const notification: OverlayNotification = {
                id,
                sessionId: String(payload.session_id ?? ''),
                workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
                type: 'question',
                title: String(payload.title ?? 'Question'),
                message: String(payload.message ?? ''),
                questions: rawQuestions,
                timestamp: Date.now(),
            };

            const delegate = new QuestionCard(notification, {
                extensionPath: this._extensionPath,
                onRespond: (nid, action) => this._respond(nid, action),
                onVisitSession: this._onVisitSession ?? undefined,
            });

            this._addEntry(id, notification, delegate);
        } catch (e) {
            console.error('[Kestrel] Error showing question notification:', e);
        }
    }

    getResponse(id: string): string | null {
        const entry = this._entries.get(id);
        if (entry?.response) return entry.response;
        return this._responses.get(id) ?? null;
    }

    /** Get question state for an entry (for focus mode). */
    getQuestionState(id: string): QuestionState | null {
        const entry = this._entries.get(id);
        if (!entry || !(entry.delegate instanceof QuestionCard)) return null;
        return entry.delegate.questionState;
    }

    /** Get question card delegate for an entry (for focus mode). */
    getQuestionCard(id: string): QuestionCard | null {
        const entry = this._entries.get(id);
        if (!entry || !(entry.delegate instanceof QuestionCard)) return null;
        return entry.delegate;
    }

    /** Navigate question pages. */
    questionNavigate(id: string, delta: number): void {
        this.getQuestionCard(id)?.navigate(delta);
    }

    /** Toggle option selection on a question page. */
    questionSelectOption(id: string, questionIndex: number, optionIndex: number): void {
        this.getQuestionCard(id)?.selectOption(questionIndex, optionIndex);
    }

    /** Format answers and respond with allow: prefix + answers JSON. */
    questionSend(id: string): void {
        this.getQuestionCard(id)?.send();
    }

    /** Dismiss question (fall through to terminal UI). */
    questionDismiss(id: string): void {
        this.getQuestionCard(id)?.dismiss();
    }

    /** Visit session + dismiss (fall through to terminal UI). */
    questionVisit(id: string): void {
        this.getQuestionCard(id)?.visit();
    }

    /** Returns pending (unresponded) entries sorted by timestamp. */
    getPendingEntries(): Array<{ id: string; notification: OverlayNotification }> {
        const result: Array<{ id: string; notification: OverlayNotification }> = [];
        for (const [id, entry] of this._entries) {
            if (entry.response === null) {
                result.push({ id, notification: entry.notification });
            }
        }
        result.sort((a, b) => a.notification.timestamp - b.notification.timestamp);
        return result;
    }

    /** Respond to an entry (public wrapper for focus mode). */
    respond(id: string, action: string): void {
        this._respond(id, action);
    }

    destroy(): void {
        try {
            if (this._focusSignalId) {
                global.display.disconnect(this._focusSignalId);
                this._focusSignalId = 0;
            }

            for (const entry of this._entries.values()) {
                entry.delegate.destroy();
                entry.delegate.actor.destroy();
            }
            this._entries.clear();

            if (this._countBadge) {
                this._countBadge.destroy();
                this._countBadge = null;
            }

            if (this._container) {
                Main.layoutManager.removeChrome(this._container);
                this._container.destroy();
                this._container = null;
            }
        } catch (e) {
            console.error('[Kestrel] Error destroying notification overlay:', e);
        }
    }

    // --- Private helpers ---

    private _buildNotification(id: string, payload: Record<string, unknown>, type: 'permission' | 'notification'): OverlayNotification {
        return {
            id,
            sessionId: String(payload.session_id ?? ''),
            workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
            type,
            title: String(payload.title ?? (type === 'permission' ? 'Permission Request' : 'Notification')),
            message: String(payload.message ?? ''),
            command: payload.command ? String(payload.command) : undefined,
            toolName: payload.tool_name ? String(payload.tool_name) : undefined,
            timestamp: Date.now(),
        };
    }

    private _addEntry(id: string, notification: OverlayNotification, delegate: NotificationCardDelegate): void {
        const card = delegate.actor;

        // Set initial slide-in position
        card.translation_x = CARD_RIGHT_OFFSET + 60;

        // Wire card hover events
        card.connect('enter-event', () => {
            if (this._entries.size > 1 && !this._stackExpanded) return;
            const entry = this._findEntryByCard(card);
            if (!entry) return;
            this._expandCard(entry);
            if (this._container) {
                this._container.set_child_above_sibling(card, null);
                if (this._countBadge) {
                    this._container.set_child_above_sibling(this._countBadge, null);
                }
            }
            this._relayout();
        });
        card.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const related = event.get_related();
            if (related && card.contains(related)) return;

            const entry = this._findEntryByCard(card);
            if (!entry) return;
            this._collapseCard(entry);
            this._relayout();
        });

        const entry: NotifEntry = {
            notification,
            delegate,
            cardExpanded: false,
            response: null,
        };
        this._entries.set(id, entry);
        this._container?.insert_child_below(card, this._countBadge);
        this._updateCountBadge();
        this._relayout();
        this.onEntriesChanged?.();
    }

    private _expandCard(entry: NotifEntry): void {
        if (entry.cardExpanded) return;
        entry.cardExpanded = true;

        const card = entry.delegate.actor;
        card.style = this._cardStyle(true, entry.notification.type);

        // Unwrap message
        entry.delegate.msgLabel.clutter_text.line_wrap = true;
        entry.delegate.msgLabel.clutter_text.ellipsize = 0; // NONE

        // Question cards expand wider
        if (entry.notification.type === 'question') {
            (card as unknown as Easeable).ease({
                width: QUESTION_CARD_WIDTH,
                translation_x: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        // Animate expand wrapper height to natural height
        const inner = entry.delegate.expandWrapper.get_first_child();
        if (inner) {
            const [, natHeight] = inner.get_preferred_height(-1);
            (entry.delegate.expandWrapper as unknown as Easeable).ease({
                height: natHeight,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    private _collapseCard(entry: NotifEntry): void {
        if (!entry.cardExpanded) return;
        entry.cardExpanded = false;

        const card = entry.delegate.actor;
        card.style = this._cardStyle(false, entry.notification.type);

        entry.delegate.msgLabel.clutter_text.line_wrap = false;
        entry.delegate.msgLabel.clutter_text.ellipsize = 3; // END

        if (entry.notification.type === 'question') {
            (card as unknown as Easeable).ease({
                width: CARD_WIDTH,
                translation_x: CARD_RIGHT_OFFSET,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        (entry.delegate.expandWrapper as unknown as Easeable).ease({
            height: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _findEntryByCard(card: St.BoxLayout): NotifEntry | undefined {
        for (const entry of this._entries.values()) {
            if (entry.delegate.actor === card) return entry;
        }
        return undefined;
    }

    private _respond(id: string, action: string): void {
        const entry = this._entries.get(id);
        if (!entry) return;

        entry.response = action;
        this._responses.set(id, action);
        this._dismissCard(id);
        this.onEntriesChanged?.();
    }

    private _dismissPreviousForSession(sessionId: string): void {
        if (!sessionId) return;
        const toDismiss: string[] = [];
        for (const [id, entry] of this._entries) {
            if (entry.notification.sessionId === sessionId) {
                if ((entry.notification.type === 'permission' || entry.notification.type === 'question') && entry.response === null) continue;
                toDismiss.push(id);
            }
        }
        for (const id of toDismiss) {
            const entry = this._entries.get(id)!;
            entry.delegate.destroy();
            this._entries.delete(id);

            (entry.delegate.actor as unknown as Easeable).ease({
                translation_x: CARD_RIGHT_OFFSET + 60,
                opacity: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try {
                        entry.delegate.actor.destroy();
                    } catch (e) {
                        console.error('[Kestrel] Error cleaning up dismissed card:', e);
                    }
                },
            });
        }
        if (toDismiss.length > 0) {
            this._updateCountBadge();
            this._relayout();
        }
    }

    private _dismissCard(id: string): void {
        const entry = this._entries.get(id);
        if (!entry) return;

        entry.delegate.destroy();
        this._entries.delete(id);
        this._updateCountBadge();

        const next = this._entries.values().next().value as NotifEntry | undefined;
        if (next) this._expandCard(next);

        this._relayout();

        (entry.delegate.actor as unknown as Easeable).ease({
            translation_x: 60,
            scale_x: 0.96,
            scale_y: 0.96,
            opacity: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    entry.delegate.actor.destroy();
                } catch (e) {
                    console.error('[Kestrel] Error cleaning up dismissed card:', e);
                }
            },
        });
    }

    private _updateCountBadge(): void {
        if (!this._countBadge) return;
        const count = this._entries.size;
        this._countBadge.text = String(count);
        this._countBadge.visible = count > 1;
    }

    private _relayout(): void {
        if (!this._container) return;

        const entries = Array.from(this._entries.values());
        const count = entries.length;

        if (this._stackExpanded) {
            let y = 0;
            for (let i = 0; i < count; i++) {
                const entry = entries[i]!;
                entry.delegate.actor.reactive = true;
                let cardHeight = COLLAPSED_H;
                if (entry.cardExpanded) {
                    const inner = entry.delegate.expandWrapper.get_first_child();
                    const expandH = inner ? inner.get_preferred_height(-1)[1] : 0;
                    cardHeight = COLLAPSED_H + expandH;
                }

                const isExpandedQuestion = entry.cardExpanded && entry.notification.type === 'question';
                const tx = isExpandedQuestion ? 0 : CARD_RIGHT_OFFSET;

                (entry.delegate.actor as unknown as Easeable).ease({
                    translation_y: y,
                    translation_x: tx,
                    scale_x: 1,
                    scale_y: 1,
                    opacity: 255,
                    duration: ANIMATION_DURATION,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                y += cardHeight + STACK_OFFSET_Y;
            }

            this._container.height = y > 0 ? y : -1;
        } else {
            for (let i = count - 1; i >= 0; i--) {
                const entry = entries[i]!;
                entry.delegate.actor.reactive = (i === 0);

                const scale = Math.max(0, 1 - i * STACK_SCALE_STEP);
                const opacity = i > 4 ? 0 : Math.round(255 * Math.max(0, 1 - i * STACK_OPACITY_STEP));

                const scaledHeight = COLLAPSED_H * scale;
                const ty = (COLLAPSED_H - scaledHeight) + i * STACK_OFFSET_Y;

                const isExpandedQuestion = entry.cardExpanded && entry.notification.type === 'question';
                const tx = isExpandedQuestion ? 0 : CARD_RIGHT_OFFSET;

                entry.delegate.actor.pivot_point = new Graphene.Point({ x: 0.5, y: 0 });

                (entry.delegate.actor as unknown as Easeable).ease({
                    translation_y: ty,
                    translation_x: tx,
                    scale_x: scale,
                    scale_y: scale,
                    opacity: Math.max(opacity, 0),
                    duration: ANIMATION_DURATION,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                if (this._container) {
                    this._container.set_child_above_sibling(entry.delegate.actor, null);
                }
            }
            if (this._countBadge && this._container) {
                this._container.set_child_above_sibling(this._countBadge, null);
            }

            const stackHeight = count > 0
                ? COLLAPSED_H + Math.min(count - 1, 4) * STACK_OFFSET_Y
                : 0;
            this._container.height = stackHeight > 0 ? stackHeight : -1;
        }

        if (this._countBadge && this._countBadge.visible) {
            this._countBadge.set_position(CARD_RIGHT_OFFSET + CARD_WIDTH - 30, -10);
        }

        this._container.visible = count > 0;
    }

    private _repositionToMonitor(monitor: { x: number; y: number; width: number; height: number }): void {
        if (!this._container) return;
        this._container.set_position(
            monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
            monitor.y + Main.panel.height + CARD_MARGIN,
        );
    }

    private _cardStyle(hovered: boolean, type: string): string {
        if (type === 'question') {
            // Question cards have their own internal styling (timeout bar at top, etc.)
            if (hovered) {
                return `background-color: ${SURFACE_HOVER}; border: 1px solid ${BORDER_HOVER}; border-radius: 12px; padding: 0; box-shadow: 0 6px 28px rgba(0,0,0,0.35);`;
            }
            return `background-color: #0a0f0c; border: 1px solid #1c2b2c; border-radius: 12px; padding: 0;`;
        }
        if (hovered) {
            return `background-color: ${SURFACE_HOVER}; border: 1px solid ${BORDER_HOVER}; border-radius: 12px; padding: 14px 16px; box-shadow: 0 6px 28px rgba(0,0,0,0.35);`;
        }
        return `background-color: #0a0f0c; border: 1px solid #1c2b2c; border-radius: 12px; padding: 14px 16px;`;
    }
}
