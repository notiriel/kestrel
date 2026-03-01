import type { NotificationPort, NotificationInitOptions } from '../ports/notification-port.js';
import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import type { QuestionState, NotificationCardDelegate } from '../ui-components/notification-adapter-types.js';
import { PermissionCard } from '../ui-components/permission-card.js';
import { NotificationCard } from '../ui-components/notification-card.js';
import { QuestionCard } from '../ui-components/question-card.js';
import { getCardBehavior } from '../ui-components/card-behavior.js';
import {
    buildNotificationContainer, buildCountBadge, buildCardStyle,
    CARD_WIDTH, QUESTION_CARD_WIDTH, CARD_RIGHT_OFFSET,
} from '../ui-components/notification-overlay-builders.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const CARD_MARGIN = 12;
const COLLAPSED_H = 62;
const STACK_OFFSET_Y = 4;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.05;
const ANIMATION_DURATION = 300;

function _optStr(value: unknown): string | undefined {
    return value ? String(value) : undefined;
}

interface NotifEntry {
    notification: OverlayNotification;
    delegate: NotificationCardDelegate;
    cardExpanded: boolean;
    response: string | null;
}

export class NotificationOverlayAdapter implements NotificationPort {
    private _container: St.Widget | null = null;
    private _entries: Map<string, NotifEntry> = new Map();
    private _stackExpanded: boolean = false;
    private _countBadge: St.Label | null = null;
    private _onVisitSession: ((sessionId: string) => void) | null = null;
    private _focusSignalId: number = 0;
    private _extensionPath: string = '';

    /** Callback invoked when entries are added, removed, or responded to. */
    onEntriesChanged: (() => void) | null = null;
    /** Callback invoked when a response is given, so coordinator can sync to domain. */
    onRespond: ((id: string, action: string) => void) | null = null;

    init(options?: NotificationInitOptions & { extensionPath?: string }): void {
        this._applyInitOptions(options);
        try {
            this._createContainer();
            this._createCountBadge();
            this._connectFocusTracking();
        } catch (e) {
            console.error('[Kestrel] Error creating notification overlay:', e);
        }
    }

    private _applyInitOptions(options?: NotificationInitOptions & { extensionPath?: string }): void {
        this._onVisitSession = options?.onVisitSession ?? null;
        this._extensionPath = options?.extensionPath ?? '';
    }

    private _createContainer(): void {
        this._container = buildNotificationContainer();

        this._connectContainerHover();

        Main.layoutManager.addTopChrome(this._container, { affectsStruts: false, trackFullscreen: false });

        this._container.width = QUESTION_CARD_WIDTH + CARD_MARGIN * 2;
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            this._container.set_position(
                monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
                monitor.y + Main.panel.height + CARD_MARGIN,
            );
        }
    }

    private _connectContainerHover(): void {
        this._container!.connect('enter-event', () => {
            if (this._entries.size <= 1) return;
            this._stackExpanded = true;
            const first = this._entries.values().next().value as NotifEntry | undefined;
            if (first) this._expandCard(first);
            this._relayout();
        });
        this._container!.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const related = (event as Clutter.Event).get_related();
            if (related && this._container!.contains(related)) return;
            this._stackExpanded = false;
            for (const entry of this._entries.values()) this._collapseCard(entry);
            this._relayout();
        });
    }

    private _createCountBadge(): void {
        this._countBadge = buildCountBadge();
        this._container!.add_child(this._countBadge);
    }

    private _connectFocusTracking(): void {
        this._focusSignalId = global.display.connect('notify::focus-window', () => {
            try {
                const focusedWindow = global.display.focus_window;
                if (!focusedWindow) return;
                const monitorIndex = focusedWindow.get_monitor();
                const mon = global.display.get_monitor_geometry(monitorIndex);
                if (mon) this._repositionToMonitor(mon);
            } catch (e) {
                console.error('[Kestrel] Error repositioning notification overlay:', e);
            }
        });
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

            const notification = this._buildQuestionNotification(id, payload, rawQuestions);
            const delegate = this._createQuestionDelegate(notification);
            this._addEntry(id, notification, delegate);
        } catch (e) {
            console.error('[Kestrel] Error showing question notification:', e);
        }
    }

    private _buildQuestionNotification(
        id: string,
        payload: Record<string, unknown>,
        rawQuestions: readonly QuestionDefinition[],
    ): OverlayNotification {
        return {
            id,
            sessionId: String(payload.session_id ?? ''),
            workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
            type: 'question',
            title: String(payload.title ?? 'Question'),
            message: String(payload.message ?? ''),
            questions: rawQuestions,
            timestamp: Date.now(),
        };
    }

    private _createQuestionDelegate(notification: OverlayNotification): QuestionCard {
        return new QuestionCard(notification, {
            extensionPath: this._extensionPath,
            onRespond: (nid, action) => this._respond(nid, action),
            onVisitSession: this._onVisitSession ?? undefined,
        });
    }

    getResponse(id: string): string | null {
        const entry = this._entries.get(id);
        return entry?.response ?? null;
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
            this._disconnectFocusTracking();
            this._destroyEntries();
            this._destroyCountBadge();
            this._destroyContainer();
        } catch (e) {
            console.error('[Kestrel] Error destroying notification overlay:', e);
        }
    }

    private _disconnectFocusTracking(): void {
        if (this._focusSignalId) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = 0;
        }
    }

    private _destroyEntries(): void {
        for (const entry of this._entries.values()) {
            entry.delegate.destroy();
            entry.delegate.actor.destroy();
        }
        this._entries.clear();
    }

    private _destroyCountBadge(): void {
        if (this._countBadge) {
            this._countBadge.destroy();
            this._countBadge = null;
        }
    }

    private _destroyContainer(): void {
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
        }
    }

    // --- Private helpers ---

    private _buildNotification(
        id: string,
        payload: Record<string, unknown>,
        type: 'permission' | 'notification',
    ): OverlayNotification {
        const defaultTitle = type === 'permission' ? 'Permission Request' : 'Notification';
        return {
            id, type, timestamp: Date.now(),
            ...this._extractPayloadFields(payload, defaultTitle),
        };
    }

    private _extractPayloadFields(
        payload: Record<string, unknown>,
        defaultTitle: string,
    ): Omit<OverlayNotification, 'id' | 'type' | 'timestamp' | 'questions'> {
        return {
            sessionId: String(payload.session_id ?? ''),
            workspaceName: _optStr(payload.workspace_name),
            title: String(payload.title ?? defaultTitle),
            message: String(payload.message ?? ''),
            command: _optStr(payload.command),
            toolName: _optStr(payload.tool_name),
        };
    }

    private _addEntry(id: string, notification: OverlayNotification, delegate: NotificationCardDelegate): void {
        const card = delegate.actor;
        card.translation_x = CARD_RIGHT_OFFSET + 60;
        this._connectCardHoverEvents(card);

        const entry: NotifEntry = { notification, delegate, cardExpanded: false, response: null };
        this._entries.set(id, entry);
        this._container?.insert_child_below(card, this._countBadge);
        this._updateCountBadge();
        this._relayout();
        this.onEntriesChanged?.();
    }

    private _connectCardHoverEvents(card: St.BoxLayout): void {
        card.connect('enter-event', () => {
            this._handleCardEnter(card);
        });
        card.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            this._handleCardLeave(card, event);
        });
    }

    private _handleCardEnter(card: St.BoxLayout): void {
        if (this._entries.size > 1 && !this._stackExpanded) return;
        const entry = this._findEntryByCard(card);
        if (!entry) return;
        this._expandCard(entry);
        this._raiseCardAndBadge(card);
        this._relayout();
    }

    private _raiseCardAndBadge(card: St.BoxLayout): void {
        if (!this._container) return;
        this._container.set_child_above_sibling(card, null);
        if (this._countBadge) {
            this._container.set_child_above_sibling(this._countBadge, null);
        }
    }

    private _handleCardLeave(card: St.BoxLayout, event: Clutter.Event): void {
        const related = event.get_related();
        if (related && card.contains(related)) return;
        const entry = this._findEntryByCard(card);
        if (!entry) return;
        this._collapseCard(entry);
        this._relayout();
    }

    private _expandCard(entry: NotifEntry): void {
        if (entry.cardExpanded) return;
        entry.cardExpanded = true;

        const card = entry.delegate.actor;
        const behavior = getCardBehavior(entry.notification.type);
        card.style = this._cardStyle(true, behavior);

        entry.delegate.msgLabel.clutter_text.line_wrap = true;
        entry.delegate.msgLabel.clutter_text.ellipsize = 0; // NONE

        if (behavior.expandedWidth !== behavior.collapsedWidth) {
            this._easeCardResize(card, behavior.expandedWidth, 0);
        }
        this._animateExpandHeight(entry);
    }

    private _easeCardResize(card: St.BoxLayout, width: number, translationX: number): void {
        (card as unknown as Easeable).ease({
            width, translation_x: translationX,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _animateExpandHeight(entry: NotifEntry): void {
        const inner = entry.delegate.expandWrapper.get_first_child();
        if (!inner) return;
        const [, natHeight] = inner.get_preferred_height(-1);
        (entry.delegate.expandWrapper as unknown as Easeable).ease({
            height: natHeight,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _collapseCard(entry: NotifEntry): void {
        if (!entry.cardExpanded) return;
        entry.cardExpanded = false;

        const card = entry.delegate.actor;
        const behavior = getCardBehavior(entry.notification.type);
        card.style = this._cardStyle(false, behavior);

        entry.delegate.msgLabel.clutter_text.line_wrap = false;
        entry.delegate.msgLabel.clutter_text.ellipsize = 3; // END

        if (behavior.expandedWidth !== behavior.collapsedWidth) {
            this._easeCardResize(card, behavior.collapsedWidth, behavior.collapsedTranslationX);
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
        this.onRespond?.(id, action);
        this._dismissCard(id);
        this.onEntriesChanged?.();
    }

    private _dismissPreviousForSession(sessionId: string): void {
        if (!sessionId) return;
        const toDismiss = this._collectDismissableIds(sessionId);
        for (const id of toDismiss) {
            const entry = this._entries.get(id)!;
            entry.delegate.destroy();
            this._entries.delete(id);
            this._animateAndRemoveEntry(entry);
        }
        if (toDismiss.length > 0) {
            this._updateCountBadge();
            this._relayout();
        }
    }

    private _collectDismissableIds(sessionId: string): string[] {
        const ids: string[] = [];
        for (const [id, entry] of this._entries) {
            if (entry.notification.sessionId !== sessionId) continue;
            if (!this._isPendingInteractive(entry)) ids.push(id);
        }
        return ids;
    }

    private _isPendingInteractive(entry: NotifEntry): boolean {
        const t = entry.notification.type;
        return (t === 'permission' || t === 'question') && entry.response === null;
    }

    private _animateAndRemoveEntry(entry: NotifEntry): void {
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

    private _dismissCard(id: string): void {
        const entry = this._entries.get(id);
        if (!entry) return;

        entry.delegate.destroy();
        this._entries.delete(id);
        this._updateCountBadge();

        const next = this._entries.values().next().value as NotifEntry | undefined;
        if (next) this._expandCard(next);

        this._relayout();
        this._animateCardExit(entry);
    }

    private _animateCardExit(entry: NotifEntry): void {
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
            this._relayoutExpanded(entries, count);
        } else {
            this._relayoutCollapsed(entries, count);
        }

        this._repositionCountBadge();
        this._container.visible = count > 0;
    }

    private _relayoutExpanded(entries: NotifEntry[], count: number): void {
        let y = 0;
        for (let i = 0; i < count; i++) {
            const entry = entries[i]!;
            entry.delegate.actor.reactive = true;
            const cardHeight = this._computeExpandedCardHeight(entry);

            (entry.delegate.actor as unknown as Easeable).ease({
                translation_y: y,
                translation_x: this._cardTranslationX(entry),
                scale_x: 1, scale_y: 1, opacity: 255,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            y += cardHeight + STACK_OFFSET_Y;
        }

        this._container!.height = y > 0 ? y : -1;
    }

    private _computeExpandedCardHeight(entry: NotifEntry): number {
        if (!entry.cardExpanded) return COLLAPSED_H;
        const inner = entry.delegate.expandWrapper.get_first_child();
        const expandH = inner ? inner.get_preferred_height(-1)[1] : 0;
        return COLLAPSED_H + expandH;
    }

    private _cardTranslationX(entry: NotifEntry): number {
        const behavior = getCardBehavior(entry.notification.type);
        if (entry.cardExpanded && behavior.expandedWidth !== behavior.collapsedWidth) return 0;
        return behavior.collapsedTranslationX;
    }

    private _relayoutCollapsed(entries: NotifEntry[], count: number): void {
        for (let i = count - 1; i >= 0; i--) {
            const entry = entries[i]!;
            entry.delegate.actor.reactive = (i === 0);
            const props = this._computeCollapsedProps(i);

            entry.delegate.actor.pivot_point = new Graphene.Point({ x: 0.5, y: 0 });

            (entry.delegate.actor as unknown as Easeable).ease({
                translation_y: props.ty,
                translation_x: this._cardTranslationX(entry),
                scale_x: props.scale, scale_y: props.scale,
                opacity: props.opacity,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            this._container!.set_child_above_sibling(entry.delegate.actor, null);
        }

        this._raiseCollapsedBadge();
        this._setCollapsedContainerHeight(count);
    }

    private _computeCollapsedProps(i: number): { scale: number; opacity: number; ty: number } {
        const scale = Math.max(0, 1 - i * STACK_SCALE_STEP);
        const opacity = i > 4 ? 0 : Math.round(255 * Math.max(0, 1 - i * STACK_OPACITY_STEP));
        const ty = (COLLAPSED_H - COLLAPSED_H * scale) + i * STACK_OFFSET_Y;
        return { scale, opacity, ty };
    }

    private _raiseCollapsedBadge(): void {
        if (this._countBadge && this._container) {
            this._container.set_child_above_sibling(this._countBadge, null);
        }
    }

    private _setCollapsedContainerHeight(count: number): void {
        const stackHeight = count > 0
            ? COLLAPSED_H + Math.min(count - 1, 4) * STACK_OFFSET_Y
            : 0;
        this._container!.height = stackHeight > 0 ? stackHeight : -1;
    }

    private _repositionCountBadge(): void {
        if (this._countBadge && this._countBadge.visible) {
            this._countBadge.set_position(CARD_RIGHT_OFFSET + CARD_WIDTH - 30, -10);
        }
    }

    private _repositionToMonitor(monitor: { x: number; y: number; width: number; height: number }): void {
        if (!this._container) return;
        this._container.set_position(
            monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
            monitor.y + Main.panel.height + CARD_MARGIN,
        );
    }

    private _cardStyle(hovered: boolean, behavior: { hasInternalPadding: boolean }): string {
        return buildCardStyle(hovered, behavior.hasInternalPadding);
    }
}
