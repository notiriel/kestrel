import type { WindowId } from '../domain/types.js';
import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import type { QuestionState } from './notification-adapter-types.js';
import { QuestionCard } from '../ui-components/question-card.js';
import {
    FOCUS_CARD_WIDTH,
    buildFocusModeBackdrop, buildPreviewContainer, buildCardContainer,
    buildCounterLabel, buildHintLabel,
    buildFocusCardRoot, buildFocusCardHeader, buildFocusCardMessage, buildFocusCardCommand,
    buildPermissionActionRow, buildNotificationActionRow,
    buildPlaceholderLabel,
} from '../ui-components/focus-mode-builders.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const ANIM_DURATION = 250;
const SLIDE_OFFSET = 60;
const CLONE_SCALE = 0.8;

interface FocusModeDeps {
    getPendingEntries(): Array<{ id: string; notification: OverlayNotification }>;
    getWindowForSession(sessionId: string): WindowId | null;
    getMetaWindow(windowId: WindowId): Meta.Window | undefined;
    respondToEntry(id: string, action: string): void;
    visitSession(sessionId: string): void;
    getMonitor(): { x: number; y: number; width: number; height: number };
    isOverviewActive(): boolean;
    registerEntriesChanged(cb: () => void): void;
    unregisterEntriesChanged(): void;
    // Question support
    getQuestionState(id: string): QuestionState | null;
    getQuestionCard(id: string): QuestionCard | null;
    questionNavigate(id: string, delta: number): void;
    questionSelectOption(id: string, questionIndex: number, optionIndex: number): void;
    questionSend(id: string): void;
    questionDismiss(id: string): void;
    questionVisit(id: string): void;
    extensionPath: string;
}

export class NotificationFocusMode {
    private _deps: FocusModeDeps;
    private _active: boolean = false;

    // UI elements
    private _backdrop: St.Widget | null = null;
    private _cardContainer: Clutter.Actor | null = null;
    private _currentCard: St.BoxLayout | null = null;
    private _previewContainer: Clutter.Actor | null = null;
    private _previewClone: Clutter.Clone | null = null;
    private _previewPlaceholder: St.Label | null = null;
    private _counterLabel: St.Label | null = null;
    private _hintLabel: St.Label | null = null;

    // State
    private _entryIds: string[] = [];
    private _currentIndex: number = 0;
    private _grab: { ungrab: () => void } | null = null;
    private _keyPressId: number = 0;
    private _buttonPressId: number = 0;
    private _sourceDestroyId: number = 0;
    private _currentSourceActor: Meta.WindowActor | null = null;
    private _focusModeQuestionCard: QuestionCard | null = null;
    private _autoAdvanceSyncId: number | null = null;

    constructor(deps: FocusModeDeps) {
        this._deps = deps;
    }

    get isActive(): boolean {
        return this._active;
    }

    toggle(): void {
        try {
            if (this._active) {
                this._exit();
                return;
            }
            if (this._deps.isOverviewActive()) return;

            const entries = this._deps.getPendingEntries();
            if (entries.length === 0) return;

            this._enter(entries);
        } catch (e) {
            console.error('[Kestrel] Error toggling notification focus mode:', e);
        }
    }

    private _enter(entries: Array<{ id: string; notification: OverlayNotification }>): void {
        this._active = true;
        this._entryIds = entries.map(e => e.id);
        this._currentIndex = 0;

        const monitor = this._deps.getMonitor();
        this._buildBackdrop(monitor);
        this._pushModalAndConnectInput();

        // Animate backdrop in
        (this._backdrop as unknown as Easeable).ease({
            opacity: 255,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._deps.registerEntriesChanged(() => this._onEntriesChanged());
        this._showEntry(0, 'none');
    }

    private _buildBackdrop(monitor: { x: number; y: number; width: number; height: number }): void {
        this._backdrop = buildFocusModeBackdrop(monitor);
        const halfW = Math.floor(monitor.width / 2);

        this._previewContainer = buildPreviewContainer(monitor, halfW);
        this._backdrop.add_child(this._previewContainer);
        this._cardContainer = buildCardContainer(halfW, monitor.height);
        this._backdrop.add_child(this._cardContainer);

        this._counterLabel = buildCounterLabel();
        this._cardContainer.add_child(this._counterLabel);
        this._hintLabel = buildHintLabel();
        this._backdrop.add_child(this._hintLabel);
        this._hintLabel.set_position(Math.round((monitor.width - 320) / 2), monitor.height - 50);

        Main.layoutManager.addTopChrome(this._backdrop, {
            affectsStruts: false,
            trackFullscreen: false,
        });
    }

    private _pushModalAndConnectInput(): void {
        this._grab = Main.pushModal(global.stage, {
            actionMode: Shell.ActionMode.ALL,
        });
        this._connectKeyPress();
        this._connectButtonPress();
    }

    private _connectKeyPress(): void {
        this._keyPressId = global.stage.connect('key-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleKeyPress(event);
                } catch (e) {
                    console.error('[Kestrel] Error in focus mode key handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );
    }

    private _connectButtonPress(): void {
        this._buttonPressId = global.stage.connect('button-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    const button = event.get_button();
                    if (button !== 1) return Clutter.EVENT_PROPAGATE;
                    this._exit();
                    return Clutter.EVENT_STOP;
                } catch (e) {
                    console.error('[Kestrel] Error in focus mode click handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );
    }

    private _exit(): void {
        if (!this._active) return;
        this._active = false;

        this._destroyFocusModeQuestionCard();
        this._cancelAutoAdvanceSync();
        this._deps.unregisterEntriesChanged();
        this._disconnectInput();
        this._deferModalClose();
        this._animateBackdropOut();
    }

    private _disconnectInput(): void {
        if (this._keyPressId) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        if (this._buttonPressId) {
            global.stage.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }
    }

    private _deferModalClose(): void {
        if (!this._grab) return;
        const grab = this._grab;
        this._grab = null;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                Main.popModal(grab);
            } catch (e) {
                console.error('[Kestrel] Error in focus mode popModal:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _animateBackdropOut(): void {
        if (!this._backdrop) {
            this._cleanupUI();
            return;
        }
        const backdrop = this._backdrop;
        this._backdrop = null;
        (backdrop as unknown as Easeable).ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => this._onBackdropFadeComplete(backdrop),
        });
    }

    private _onBackdropFadeComplete(backdrop: St.Widget): void {
        try {
            this._cleanupUI();
            Main.layoutManager.removeChrome(backdrop);
            backdrop.destroy();
        } catch (e) {
            console.error('[Kestrel] Error cleaning up focus mode:', e);
        }
    }

    private _cleanupUI(): void {
        this._disconnectSourceDestroy();
        this._currentCard = null;
        this._previewClone = null;
        this._previewPlaceholder = null;
        this._previewContainer = null;
        this._cardContainer = null;
        this._counterLabel = null;
        this._hintLabel = null;
    }

    private _showEntry(index: number, direction: 'up' | 'down' | 'none'): void {
        if (!this._cardContainer || !this._previewContainer) return;

        const entries = this._deps.getPendingEntries();
        const entryData = entries.find(e => e.id === this._entryIds[index]);

        if (!entryData) {
            this._handleStaleEntry(index, direction);
            return;
        }

        const monitor = this._deps.getMonitor();
        this._destroyFocusModeQuestionCard();
        this._removeOldCard(direction);
        this._createAndShowCard(entryData.notification, direction, monitor);
        this._updateCounter();
        this._positionCounter(monitor);
        this._updatePreview(entryData.notification.sessionId, direction);
    }

    private _handleStaleEntry(index: number, direction: 'up' | 'down' | 'none'): void {
        this._entryIds.splice(index, 1);
        if (this._entryIds.length === 0) {
            this._exit();
            return;
        }
        this._currentIndex = Math.min(index, this._entryIds.length - 1);
        this._showEntry(this._currentIndex, direction);
    }

    private _removeOldCard(direction: 'up' | 'down' | 'none'): void {
        if (!this._currentCard) return;
        this._animateSlideOut(this._currentCard, direction);
    }

    private _createAndShowCard(
        notification: OverlayNotification,
        direction: 'up' | 'down' | 'none',
        monitor: { x: number; y: number; width: number; height: number },
    ): void {
        const halfW = Math.floor(monitor.width / 2);
        const card = this._buildFocusCard(notification);
        this._currentCard = card;
        this._cardContainer!.add_child(card);

        const cardX = Math.round((halfW - FOCUS_CARD_WIDTH) / 2);
        const [, cardNatH] = card.get_preferred_height(FOCUS_CARD_WIDTH);
        const cardY = Math.round((monitor.height - cardNatH) / 2);
        card.set_position(cardX, cardY);
        this._animateSlideIn(card, direction);
    }

    private _animateSlideIn(actor: Clutter.Actor, direction: 'up' | 'down' | 'none'): void {
        const slideIn = direction === 'up' ? -SLIDE_OFFSET : (direction === 'down' ? SLIDE_OFFSET : 0);
        actor.translation_y = direction === 'none' ? 0 : slideIn;
        actor.opacity = 0;
        (actor as unknown as Easeable).ease({
            translation_y: 0,
            opacity: 255,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _positionCounter(monitor: { x: number; y: number; width: number; height: number }): void {
        if (!this._counterLabel || !this._currentCard) return;
        const halfW = Math.floor(monitor.width / 2);
        const cardX = Math.round((halfW - FOCUS_CARD_WIDTH) / 2);
        const [, cardNatH] = this._currentCard.get_preferred_height(FOCUS_CARD_WIDTH);
        const cardY = Math.round((monitor.height - cardNatH) / 2);
        this._counterLabel.set_position(cardX, cardY + cardNatH + 16);
        this._counterLabel.width = FOCUS_CARD_WIDTH;
    }

    private _updatePreview(sessionId: string | undefined, direction: 'up' | 'down' | 'none'): void {
        if (!this._previewContainer) return;

        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        this._teardownOldPreview(direction);

        const resolved = this._resolvePreviewActor(sessionId);
        if (resolved) {
            this._createPreviewClone(resolved.actor, resolved.frameRect, halfW, monitor.height, direction, sessionId);
        } else {
            this._showPlaceholder(sessionId ?? '');
        }
    }

    private _teardownOldPreview(direction: 'up' | 'down' | 'none'): void {
        this._disconnectSourceDestroy();
        if (this._previewClone) {
            this._animateSlideOut(this._previewClone, direction);
            this._previewClone = null;
        }
        if (this._previewPlaceholder) {
            this._animateFadeOut(this._previewPlaceholder);
            this._previewPlaceholder = null;
        }
    }

    private _animateSlideOut(actor: Clutter.Actor, direction: 'up' | 'down' | 'none'): void {
        const slideY = direction === 'up' ? SLIDE_OFFSET : -SLIDE_OFFSET;
        (actor as unknown as Easeable).ease({
            translation_y: slideY,
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try { actor.destroy(); } catch { /* already gone */ }
            },
        });
    }

    private _animateFadeOut(actor: Clutter.Actor): void {
        (actor as unknown as Easeable).ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try { actor.destroy(); } catch { /* already gone */ }
            },
        });
    }

    private _resolvePreviewActor(sessionId: string | undefined): {
        actor: Meta.WindowActor;
        frameRect: { x: number; y: number; width: number; height: number };
    } | null {
        if (!sessionId) return null;
        const windowId = this._deps.getWindowForSession(sessionId);
        if (!windowId) return null;
        const metaWindow = this._deps.getMetaWindow(windowId);
        if (!metaWindow) return null;
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor) return null;
        return { actor, frameRect: metaWindow.get_frame_rect() };
    }

    private _createPreviewClone(
        actor: Meta.WindowActor,
        frameRect: { x: number; y: number; width: number; height: number },
        halfW: number,
        monitorHeight: number,
        direction: 'up' | 'down' | 'none',
        sessionId: string | undefined,
    ): void {
        const clone = new Clutter.Clone({ source: actor });
        this._previewClone = clone;
        this._currentSourceActor = actor;
        this._connectSourceDestroyForPreview(actor, sessionId);

        const scaledW = Math.round(frameRect.width * CLONE_SCALE);
        const scaledH = Math.round(frameRect.height * CLONE_SCALE);
        clone.set_size(scaledW, scaledH);
        clone.set_position(Math.round((halfW - scaledW) / 2), Math.round((monitorHeight - scaledH) / 2));

        this._previewContainer!.add_child(clone);
        this._animateSlideIn(clone, direction);
    }

    private _connectSourceDestroyForPreview(actor: Meta.WindowActor, sessionId: string | undefined): void {
        this._sourceDestroyId = actor.connect('destroy', () => {
            this._sourceDestroyId = 0;
            this._currentSourceActor = null;
            if (this._previewClone) {
                try { this._previewClone.destroy(); } catch { /* gone */ }
                this._previewClone = null;
            }
            this._showPlaceholder(sessionId ?? '');
        });
    }

    private _showPlaceholder(sessionId: string): void {
        if (!this._previewContainer) return;
        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        const label = buildPlaceholderLabel(!!sessionId);
        this._previewPlaceholder = label;
        this._previewContainer.add_child(label);
        label.set_position(Math.round((halfW - 200) / 2), Math.round(monitor.height / 2));
        (label as unknown as Easeable).ease({
            opacity: 255,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _disconnectSourceDestroy(): void {
        if (this._sourceDestroyId && this._currentSourceActor) {
            try {
                this._currentSourceActor.disconnect(this._sourceDestroyId);
            } catch { /* already disconnected */ }
        }
        this._sourceDestroyId = 0;
        this._currentSourceActor = null;
    }

    private _buildFocusCard(notif: OverlayNotification): St.BoxLayout {
        if (notif.type === 'question') {
            const result = this._buildQuestionFocusCard(notif);
            if (result) return result;
        }
        return this._buildSimpleFocusCard(notif);
    }

    private _buildQuestionFocusCard(notif: OverlayNotification): St.BoxLayout | null {
        const overlayCard = this._deps.getQuestionCard(notif.id);
        if (!overlayCard) return null;

        this._destroyFocusModeQuestionCard();
        const focusCard = new QuestionCard(notif, {
            extensionPath: this._deps.extensionPath,
            onRespond: (nid, action) => this._deps.respondToEntry(nid, action),
            onVisitSession: (sid) => this._deps.visitSession(sid),
        }, true, overlayCard.getSharedState());
        this._focusModeQuestionCard = focusCard;
        return focusCard.actor as St.BoxLayout;
    }

    private _buildSimpleFocusCard(notif: OverlayNotification): St.BoxLayout {
        const card = buildFocusCardRoot();
        card.add_child(buildFocusCardHeader(notif.title, notif.workspaceName));
        if (notif.message) card.add_child(buildFocusCardMessage(notif.message));
        if (notif.type === 'permission' && notif.command) card.add_child(buildFocusCardCommand(notif.command));
        card.add_child(notif.type === 'permission' ? buildPermissionActionRow() : buildNotificationActionRow());
        return card;
    }

    private _handleKeyPress(
        event: Clutter.Event,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const symbol = event.get_key_symbol();
        const delegated = this._tryDelegateToQuestion(symbol);
        if (delegated !== null) return delegated;
        return this._handlePermissionKey(symbol);
    }

    private _tryDelegateToQuestion(
        symbol: number,
    ): typeof Clutter.EVENT_STOP | null {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return null;
        const entries = this._deps.getPendingEntries();
        const entry = entries.find(e => e.id === entryId);
        if (entry?.notification.type !== 'question') return null;
        return this._handleQuestionKeyPress(entryId, symbol);
    }

    private _handlePermissionKey(
        symbol: number,
    ): typeof Clutter.EVENT_STOP {
        const keyActions: Record<number, () => void> = {
            [Clutter.KEY_Up]: () => this._navigate(-1),
            [Clutter.KEY_Down]: () => this._navigate(1),
            [Clutter.KEY_1]: () => this._handleAction1(),
            [Clutter.KEY_KP_1]: () => this._handleAction1(),
            [Clutter.KEY_2]: () => this._handleAction2(),
            [Clutter.KEY_KP_2]: () => this._handleAction2(),
            [Clutter.KEY_3]: () => this._handleAction3(),
            [Clutter.KEY_KP_3]: () => this._handleAction3(),
            [Clutter.KEY_Escape]: () => this._exit(),
        };
        const action = keyActions[symbol];
        if (action) action();
        return Clutter.EVENT_STOP;
    }

    private _handleQuestionKeyPress(
        entryId: string,
        symbol: number,
    ): typeof Clutter.EVENT_STOP {
        const qs = this._deps.getQuestionState(entryId);
        if (!qs) return Clutter.EVENT_STOP;
        if (this._handleQuestionNav(entryId, symbol)) return Clutter.EVENT_STOP;
        const isSubmitPage = qs.currentPage >= qs.questions.length;
        const keyNumber = this._symbolToNumber(symbol);
        if (keyNumber !== null) {
            this._handleQuestionNumberKey(entryId, qs, keyNumber, isSubmitPage);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) this._exit();
        return Clutter.EVENT_STOP;
    }

    private _handleQuestionNav(entryId: string, symbol: number): boolean {
        if (symbol === Clutter.KEY_Left) {
            this._deps.questionNavigate(entryId, -1);
            this._refreshQuestionCard(entryId);
            return true;
        }
        if (symbol === Clutter.KEY_Right) {
            this._deps.questionNavigate(entryId, 1);
            this._refreshQuestionCard(entryId);
            return true;
        }
        if (symbol === Clutter.KEY_Up) { this._navigate(-1); return true; }
        if (symbol === Clutter.KEY_Down) { this._navigate(1); return true; }
        return false;
    }

    private _symbolToNumber(symbol: number): number | null {
        const map: Record<number, number> = {
            [Clutter.KEY_1]: 1, [Clutter.KEY_KP_1]: 1,
            [Clutter.KEY_2]: 2, [Clutter.KEY_KP_2]: 2,
            [Clutter.KEY_3]: 3, [Clutter.KEY_KP_3]: 3,
            [Clutter.KEY_4]: 4, [Clutter.KEY_KP_4]: 4,
            [Clutter.KEY_5]: 5, [Clutter.KEY_KP_5]: 5,
        };
        return map[symbol] ?? null;
    }

    private _handleQuestionNumberKey(
        entryId: string, qs: QuestionState, keyNumber: number, isSubmitPage: boolean,
    ): void {
        if (isSubmitPage) {
            this._handleQuestionSubmitAction(entryId, qs, keyNumber);
            return;
        }
        if (keyNumber === 1) {
            this._handleKey1OnQuestion(entryId, qs);
            return;
        }
        this._selectQuestionOptionByNumber(entryId, qs, keyNumber - 1);
    }

    private _handleQuestionSubmitAction(
        entryId: string, qs: QuestionState, keyNumber: number,
    ): void {
        if (keyNumber === 1) {
            const allAnswered = qs.questions.every(
                (_: QuestionDefinition, i: number) => (qs.answers.get(i) ?? []).length > 0,
            );
            if (allAnswered) {
                this._deps.questionSend(entryId);
                this._removeCurrentEntry();
            }
        } else if (keyNumber === 2) {
            this._deps.questionDismiss(entryId);
            this._removeCurrentEntry();
        } else if (keyNumber === 3) {
            this._deps.questionVisit(entryId);
            this._removeCurrentEntry();
        }
    }

    private _handleKey1OnQuestion(entryId: string, qs: QuestionState): void {
        this._deps.questionSelectOption(entryId, qs.currentPage, 0);
        this._refreshQuestionCard(entryId);
        const qDef = qs.questions[qs.currentPage];
        if (qDef && !qDef.multiSelect) {
            this._scheduleAutoAdvanceSync(entryId);
        }
    }

    private _selectQuestionOptionByNumber(entryId: string, qs: QuestionState, optionIndex: number): void {
        const qDef = qs.questions[qs.currentPage];
        if (!qDef) return;
        // optionIndex 0..options.length-1 = regular options, options.length = "Other"
        const maxIndex = qDef.options.length; // "Other" is at this index
        if (optionIndex <= maxIndex) {
            this._deps.questionSelectOption(entryId, qs.currentPage, optionIndex);
            this._refreshQuestionCard(entryId);
            // For single-select (not "Other"), the overlay card schedules auto-advance
            // after 300ms. Schedule a delayed sync so the focus card picks up the page change.
            if (!qDef.multiSelect && optionIndex < qDef.options.length) {
                this._scheduleAutoAdvanceSync(entryId);
            }
        }
    }

    /** Schedule a delayed refresh so the focus card picks up the overlay card's auto-advance. */
    private _scheduleAutoAdvanceSync(entryId: string): void {
        if (this._autoAdvanceSyncId !== null) {
            GLib.source_remove(this._autoAdvanceSyncId);
        }
        // 350ms — slightly after the overlay card's 300ms auto-advance delay
        this._autoAdvanceSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._autoAdvanceSyncId = null;
            try {
                if (this._active) {
                    this._refreshQuestionCard(entryId);
                }
            } catch (e) {
                console.error('[Kestrel] Error in auto-advance sync:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _cancelAutoAdvanceSync(): void {
        if (this._autoAdvanceSyncId !== null) {
            GLib.source_remove(this._autoAdvanceSyncId);
            this._autoAdvanceSyncId = null;
        }
    }

    private _destroyFocusModeQuestionCard(): void {
        if (!this._focusModeQuestionCard) return;
        this._focusModeQuestionCard.destroy();
        // Don't destroy actor here — _showEntry's old card animation handles it
        this._focusModeQuestionCard = null;
    }

    private _removeCurrentEntry(): void {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return;

        this._destroyFocusModeQuestionCard();

        const idx = this._entryIds.indexOf(entryId);
        if (idx !== -1) this._entryIds.splice(idx, 1);
        if (this._entryIds.length === 0) {
            this._exit();
            return;
        }
        this._currentIndex = Math.min(this._currentIndex, this._entryIds.length - 1);
        this._showEntry(this._currentIndex, 'down');
    }

    private _refreshQuestionCard(entryId: string): void {
        this._syncQuestionState(entryId);
        this._repositionCard();
    }

    private _syncQuestionState(_entryId: string): void {
        if (this._focusModeQuestionCard) {
            this._focusModeQuestionCard.refresh();
        }
    }

    private _repositionCard(): void {
        if (!this._currentCard || !this._cardContainer) return;
        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);
        const cardX = Math.round((halfW - FOCUS_CARD_WIDTH) / 2);
        const [, cardNatH] = this._currentCard.get_preferred_height(FOCUS_CARD_WIDTH);
        const cardY = Math.round((monitor.height - cardNatH) / 2);
        this._currentCard.set_position(cardX, cardY);
        if (this._counterLabel) {
            this._counterLabel.set_position(cardX, cardY + cardNatH + 16);
            this._counterLabel.width = FOCUS_CARD_WIDTH;
        }
    }

    private _navigate(delta: number): void {
        if (this._entryIds.length <= 1) return;

        const newIndex = ((this._currentIndex + delta) % this._entryIds.length + this._entryIds.length) % this._entryIds.length;
        const direction = delta > 0 ? 'down' : 'up';
        this._currentIndex = newIndex;
        this._showEntry(this._currentIndex, direction);
    }

    private _handleAction1(): void {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return;

        const entries = this._deps.getPendingEntries();
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        if (entry.notification.type === 'permission') {
            this._performAction(entryId, 'allow');
        } else {
            // Visit: navigate to session, then exit
            if (entry.notification.sessionId) {
                this._deps.visitSession(entry.notification.sessionId);
            }
            this._performAction(entryId, 'visit');
        }
    }

    private _handleAction2(): void {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return;

        const entries = this._deps.getPendingEntries();
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        if (entry.notification.type === 'permission') {
            this._performAction(entryId, 'always');
        } else {
            this._performAction(entryId, 'dismiss');
        }
    }

    private _handleAction3(): void {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return;

        const entries = this._deps.getPendingEntries();
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        // Only permissions have action 3 (Deny)
        if (entry.notification.type === 'permission') {
            this._performAction(entryId, 'deny');
        }
    }

    private _performAction(entryId: string, action: string): void {
        // Respond via the overlay adapter
        this._deps.respondToEntry(entryId, action);

        // Remove from our list
        const idx = this._entryIds.indexOf(entryId);
        if (idx !== -1) {
            this._entryIds.splice(idx, 1);
        }

        // Auto-exit if empty
        if (this._entryIds.length === 0) {
            this._exit();
            return;
        }

        // Auto-advance
        this._currentIndex = Math.min(this._currentIndex, this._entryIds.length - 1);
        this._showEntry(this._currentIndex, 'down');
    }

    private _syncEntryIds(): string[] {
        const entries = this._deps.getPendingEntries();
        const currentIds = new Set(entries.map(e => e.id));

        // Add new entries
        for (const entry of entries) {
            if (!this._entryIds.includes(entry.id)) {
                this._entryIds.push(entry.id);
            }
        }

        // Remove resolved entries (but not the one we just acted on — performAction handles that)
        this._entryIds = this._entryIds.filter(id => currentIds.has(id));
        return this._entryIds;
    }

    private _onEntriesChanged(): void {
        if (!this._active) return;

        try {
            const synced = this._syncEntryIds();

            if (synced.length === 0) {
                this._exit();
                return;
            }

            this._currentIndex = Math.min(this._currentIndex, synced.length - 1);
            this._updateCounter();
        } catch (e) {
            console.error('[Kestrel] Error handling focus mode entries change:', e);
        }
    }

    private _updateCounter(): void {
        if (!this._counterLabel) return;
        this._counterLabel.text = `${this._currentIndex + 1} / ${this._entryIds.length}`;
    }

    destroy(): void {
        if (!this._active) return;
        this._active = false;
        this._cancelAutoAdvanceSync();
        this._deps.unregisterEntriesChanged();
        this._disconnectInput();
        this._destroyModal();
        this._cleanupUI();
        this._destroyBackdropSync();
    }

    private _destroyModal(): void {
        if (!this._grab) return;
        try {
            Main.popModal(this._grab);
        } catch (e) {
            console.error('[Kestrel] Error in focus mode destroy popModal:', e);
        }
        this._grab = null;
    }

    private _destroyBackdropSync(): void {
        if (!this._backdrop) return;
        Main.layoutManager.removeChrome(this._backdrop);
        this._backdrop.destroy();
        this._backdrop = null;
    }
}
