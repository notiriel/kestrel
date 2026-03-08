interface NotificationInitOptions {
    onVisitSession?: (sessionId: string) => void;
}
import type { NotificationOverlayScene, NotificationCardScene } from '../../domain/scene/notification-scene.js';
import type { DomainNotification } from '../../domain/world/notification.js';
import type { OverlayNotification } from '../../domain/world/notification-types.js';
import type { QuestionState, NotificationCardDelegate } from '../../ui-components/notification-adapter-types.js';
import { PermissionCard } from '../../ui-components/permission-card.js';
import { NotificationCard } from '../../ui-components/notification-card.js';
import { QuestionCard } from '../../ui-components/question-card.js';
import {
    buildNotificationContainer, buildCountBadge, buildCardStyle,
} from '../../ui-components/notification-overlay-builders.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const ANIMATION_DURATION = 300;

interface WidgetEntry {
    delegate: NotificationCardDelegate;
    cardExpanded: boolean;
    hasInternalPadding: boolean;
}

export class NotificationOverlayAdapter {
    private _container: St.Widget | null = null;
    private _widgets: Map<string, WidgetEntry> = new Map();
    private _countBadge: St.Label | null = null;
    private _onVisitSession: ((sessionId: string) => void) | null = null;
    private _extensionPath: string = '';

    /** Callback invoked when entries are added, removed, or responded to. */
    onEntriesChanged: (() => void) | null = null;
    /** Callback invoked when a response is given, so coordinator can sync to domain. */
    onRespond: ((id: string, action: string) => void) | null = null;
    /** Callback invoked when the stack should expand (hover enter with multiple cards). */
    onExpandStack: (() => void) | null = null;
    /** Callback invoked when the stack should collapse (hover leave). */
    onCollapseStack: (() => void) | null = null;
    /** Callback invoked when a card should expand (hover enter). */
    onExpandCard: ((id: string) => void) | null = null;
    /** Callback invoked when a card should collapse (hover leave). */
    onCollapseCard: ((id: string) => void) | null = null;
    /** Callback invoked when a question option is selected (for domain sync). */
    onSelectOption: ((id: string, questionIndex: number, optionIndex: number) => void) | null = null;
    /** Callback invoked when "Other" text changes (for domain sync). */
    onSetOtherText: ((id: string, questionIndex: number, text: string) => void) | null = null;

    init(options?: NotificationInitOptions & { extensionPath?: string }): void {
        this._applyInitOptions(options);
        try {
            this._createContainer();
            this._createCountBadge();
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
    }

    private _connectContainerHover(): void {
        this._container!.connect('enter-event', () => {
            if (this._widgets.size <= 1) return;
            this.onExpandStack?.();
        });
        this._container!.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const related = (event as Clutter.Event).get_related();
            if (related && this._container!.contains(related)) return;
            this.onCollapseStack?.();
        });
    }

    private _createCountBadge(): void {
        this._countBadge = buildCountBadge();
        this._container!.add_child(this._countBadge);
    }

    /**
     * Apply a notification overlay scene. Diffs current widgets against scene cards:
     * creates new, updates existing, removes stale.
     */
    applyOverlayScene(scene: NotificationOverlayScene, notifications: ReadonlyMap<string, DomainNotification>): void {
        try {
            if (!this._container) return;
            this._removeStaleWidgets(scene);
            this._syncWidgets(scene, notifications);
            this._updateCountBadgeFromScene(scene);
            this._updateContainer(scene);
        } catch (e) {
            console.error('[Kestrel] Error applying overlay scene:', e);
        }
    }

    private _removeStaleWidgets(scene: NotificationOverlayScene): void {
        const sceneIds = new Set(scene.cards.map(c => c.id));
        for (const [id, entry] of this._widgets) {
            if (!sceneIds.has(id)) {
                this._animateAndRemoveWidget(id, entry);
            }
        }
    }

    private _syncWidgets(scene: NotificationOverlayScene, notifications: ReadonlyMap<string, DomainNotification>): void {
        for (const cardScene of scene.cards) {
            const existing = this._widgets.get(cardScene.id);
            if (existing) {
                this._updateWidget(existing, cardScene);
            } else {
                const notif = notifications.get(cardScene.id);
                if (notif) this._createWidget(cardScene.id, notif, cardScene);
            }
        }
    }

    private _updateContainer(scene: NotificationOverlayScene): void {
        if (!this._container) return;
        this._container.visible = scene.visible;
        this._container.set_position(scene.x, scene.y);
        this._container.width = scene.width;
        if (scene.height > 0) this._container.height = scene.height;
    }

    private _createWidget(id: string, domainNotif: DomainNotification, cardScene: NotificationCardScene): void {
        const overlayNotif = this._domainToOverlay(domainNotif);
        const delegate = this._createDelegate(id, domainNotif.type, overlayNotif);

        const card = delegate.actor;
        card.translation_x = cardScene.translationX + 60; // Start off-screen for slide-in
        this._connectCardHoverEvents(id, card);

        const entry: WidgetEntry = { delegate, cardExpanded: false, hasInternalPadding: cardScene.hasInternalPadding };
        this._widgets.set(id, entry);
        this._container?.insert_child_below(card, this._countBadge);

        // Animate to scene position
        this._animateWidgetToScene(entry, cardScene);
        this.onEntriesChanged?.();
    }

    private _createDelegate(_id: string, type: string, notification: OverlayNotification): NotificationCardDelegate {
        const respondCb = (nid: string, action: string) => this._respond(nid, action);
        const visitCb = this._onVisitSession ?? undefined;
        const opts = { extensionPath: this._extensionPath, onRespond: respondCb };
        if (type === 'question') return new QuestionCard(notification, {
            ...opts, onVisitSession: visitCb,
            onSelectOption: (id, qi, oi) => this.onSelectOption?.(id, qi, oi),
            onSetOtherText: (id, qi, text) => this.onSetOtherText?.(id, qi, text),
        });
        if (type === 'notification') return new NotificationCard(notification, { ...opts, onVisitSession: visitCb });
        return new PermissionCard(notification, { ...opts, onVisitSession: visitCb });
    }

    private _domainToOverlay(n: DomainNotification): OverlayNotification {
        return {
            id: n.id,
            sessionId: n.sessionId,
            workspaceName: n.workspaceName,
            type: n.type,
            title: n.title,
            message: n.message,
            command: n.command,
            toolName: n.toolName,
            timestamp: n.timestamp,
            questions: n.questions,
        };
    }

    private _updateWidget(entry: WidgetEntry, cardScene: NotificationCardScene): void {
        this._animateWidgetToScene(entry, cardScene);
    }

    private _animateWidgetToScene(entry: WidgetEntry, cardScene: NotificationCardScene): void {
        const card = entry.delegate.actor;
        card.reactive = cardScene.reactive;
        card.pivot_point = new Graphene.Point({ x: 0.5, y: 0 });

        (card as unknown as Easeable).ease({
            translation_y: cardScene.y,
            translation_x: cardScene.translationX,
            width: cardScene.width,
            scale_x: cardScene.scale,
            scale_y: cardScene.scale,
            opacity: cardScene.opacity,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _animateAndRemoveWidget(id: string, entry: WidgetEntry): void {
        this._widgets.delete(id);
        entry.delegate.destroy();

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

        this.onEntriesChanged?.();
    }

    private _connectCardHoverEvents(id: string, card: St.BoxLayout): void {
        card.connect('enter-event', () => {
            this._handleCardEnter(id, card);
        });
        card.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            this._handleCardLeave(id, card, event);
        });
    }

    private _handleCardEnter(id: string, card: St.BoxLayout): void {
        if (this._widgets.size > 1) {
            // Only expand individual card when stack is expanded (handled by scene)
            this.onExpandCard?.(id);
        } else {
            this.onExpandCard?.(id);
        }
        this._raiseCardAndBadge(card);
    }

    private _raiseCardAndBadge(card: St.BoxLayout): void {
        if (!this._container) return;
        this._container.set_child_above_sibling(card, null);
        if (this._countBadge) {
            this._container.set_child_above_sibling(this._countBadge, null);
        }
    }

    private _handleCardLeave(id: string, card: St.BoxLayout, event: Clutter.Event): void {
        const related = event.get_related();
        if (related && card.contains(related)) return;
        this.onCollapseCard?.(id);
    }

    /**
     * Expand a card's visual state (line-wrap, height animation).
     * Called by coordinator after interaction state update.
     */
    expandCardVisual(id: string): void {
        const entry = this._widgets.get(id);
        if (!entry || entry.cardExpanded) return;
        entry.cardExpanded = true;

        const card = entry.delegate.actor;
        card.style = this._cardStyle(true, entry.hasInternalPadding);

        entry.delegate.msgLabel.clutter_text.line_wrap = true;
        entry.delegate.msgLabel.clutter_text.ellipsize = 0; // NONE

        this._animateExpandHeight(entry);
    }

    /**
     * Collapse a card's visual state.
     * Called by coordinator after interaction state update.
     */
    collapseCardVisual(id: string): void {
        const entry = this._widgets.get(id);
        if (!entry || !entry.cardExpanded) return;
        entry.cardExpanded = false;

        const card = entry.delegate.actor;
        card.style = this._cardStyle(false, entry.hasInternalPadding);

        entry.delegate.msgLabel.clutter_text.line_wrap = false;
        entry.delegate.msgLabel.clutter_text.ellipsize = 3; // END

        (entry.delegate.expandWrapper as unknown as Easeable).ease({
            height: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Get the actual expanded height of a card's expand wrapper. */
    getExpandedCardHeight(id: string): number {
        const entry = this._widgets.get(id);
        if (!entry) return 0;
        const inner = entry.delegate.expandWrapper.get_first_child();
        return inner ? inner.get_preferred_height(-1)[1] : 0;
    }

    private _animateExpandHeight(entry: WidgetEntry): void {
        const inner = entry.delegate.expandWrapper.get_first_child();
        if (!inner) return;
        const [, natHeight] = inner.get_preferred_height(-1);
        (entry.delegate.expandWrapper as unknown as Easeable).ease({
            height: natHeight,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _respond(id: string, action: string): void {
        this.onRespond?.(id, action);
        this.onEntriesChanged?.();
    }

    private _updateCountBadgeFromScene(scene: NotificationOverlayScene): void {
        if (!this._countBadge) return;
        this._countBadge.text = scene.countBadge.text;
        this._countBadge.visible = scene.countBadge.visible;
        if (scene.countBadge.visible) {
            this._countBadge.set_position(scene.countBadge.x, scene.countBadge.y);
        }
    }

    /** Get question state for an entry (for focus mode). */
    getQuestionState(id: string): QuestionState | null {
        const entry = this._widgets.get(id);
        if (!entry || !(entry.delegate instanceof QuestionCard)) return null;
        return entry.delegate.questionState;
    }

    /** Get question card delegate for an entry (for focus mode). */
    getQuestionCard(id: string): QuestionCard | null {
        const entry = this._widgets.get(id);
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

    /** Returns pending entries sorted by timestamp. Uses domain notifications. */
    getPendingEntries(): Array<{ id: string; notification: OverlayNotification }> {
        const result: Array<{ id: string; notification: OverlayNotification }> = [];
        // This is now mainly used by focus mode deps — coordinator provides domain data
        return result;
    }

    /** Respond to an entry (public wrapper for focus mode). */
    respond(id: string, action: string): void {
        this._respond(id, action);
    }

    destroy(): void {
        try {
            this._destroyWidgets();
            this._destroyCountBadge();
            this._destroyContainer();
        } catch (e) {
            console.error('[Kestrel] Error destroying notification overlay:', e);
        }
    }

    private _destroyWidgets(): void {
        for (const entry of this._widgets.values()) {
            entry.delegate.destroy();
            entry.delegate.actor.destroy();
        }
        this._widgets.clear();
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

    private _cardStyle(hovered: boolean, hasInternalPadding: boolean): string {
        return buildCardStyle(hovered, hasInternalPadding);
    }
}
