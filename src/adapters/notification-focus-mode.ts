import type { WindowId } from '../domain/types.js';
import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import type { QuestionState } from './notification-overlay-adapter.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

// Colors — same as notification-overlay-adapter
const SURFACE = '#1a1a1f';
const BORDER = '#2a2a32';
const TEXT = '#e4e4e8';
const TEXT_DIM = '#7b7b86';
const ACCENT = '#c97f4a';
const GREEN = '#4a9e6e';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

const CARD_WIDTH = 480;
const ANIM_DURATION = 250;
const SLIDE_OFFSET = 60;
const CLONE_SCALE = 0.8;

export interface FocusModeDeps {
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
    questionNavigate(id: string, delta: number): void;
    questionSelectOption(id: string, questionIndex: number, optionIndex: number): void;
    questionSend(id: string): void;
    questionDismiss(id: string): void;
    questionVisit(id: string): void;
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

        // Backdrop — fullscreen dimmed overlay
        this._backdrop = new St.Widget({
            name: 'kestrel-focus-backdrop',
            style: 'background-color: rgba(0,0,0,0.6);',
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity: 0,
        });

        // Preview container — left half, centered
        this._previewContainer = new Clutter.Actor({
            name: 'kestrel-focus-preview',
            x: monitor.x,
            y: monitor.y,
            width: Math.floor(monitor.width / 2),
            height: monitor.height,
        });
        this._backdrop.add_child(this._previewContainer);

        // Card container — right half, centered
        this._cardContainer = new Clutter.Actor({
            name: 'kestrel-focus-cards',
            x: Math.floor(monitor.width / 2),
            y: 0,
            width: Math.floor(monitor.width / 2),
            height: monitor.height,
        });
        this._backdrop.add_child(this._cardContainer);

        // Counter label
        this._counterLabel = new St.Label({
            text: '',
            style: `font-family: monospace; font-size: 14px; color: ${TEXT_DIM}; text-align: center;`,
        });
        this._cardContainer.add_child(this._counterLabel);

        // Hint label at bottom center
        this._hintLabel = new St.Label({
            text: '\u2191\u2193 navigate    1-4 act    \u2190\u2192 page    Esc close',
            style: `font-family: monospace; font-size: 12px; color: ${TEXT_DIM}; text-align: center;`,
        });
        this._backdrop.add_child(this._hintLabel);
        // Position hint at bottom center
        this._hintLabel.set_position(
            Math.round((monitor.width - 320) / 2),
            monitor.height - 50,
        );

        Main.layoutManager.addTopChrome(this._backdrop, {
            affectsStruts: false,
            trackFullscreen: false,
        });

        // Push modal
        const grab = Main.pushModal(global.stage, {
            actionMode: Shell.ActionMode.ALL,
        });
        this._grab = grab;

        // Connect input handlers
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

        this._buttonPressId = global.stage.connect('button-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    const button = event.get_button();
                    if (button !== 1) return Clutter.EVENT_PROPAGATE;
                    // Click on backdrop (outside card/preview) exits
                    this._exit();
                    return Clutter.EVENT_STOP;
                } catch (e) {
                    console.error('[Kestrel] Error in focus mode click handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );

        // Animate backdrop in
        (this._backdrop as unknown as Easeable).ease({
            opacity: 255,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Register for live updates
        this._deps.registerEntriesChanged(() => this._onEntriesChanged());

        // Show the first entry
        this._showEntry(0, 'none');
    }

    private _exit(): void {
        if (!this._active) return;
        this._active = false;

        this._deps.unregisterEntriesChanged();

        // Disconnect input
        if (this._keyPressId) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        if (this._buttonPressId) {
            global.stage.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }

        // Pop modal (deferred)
        if (this._grab) {
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

        // Animate out then destroy
        if (this._backdrop) {
            const backdrop = this._backdrop;
            (backdrop as unknown as Easeable).ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    try {
                        this._cleanupUI();
                        Main.layoutManager.removeChrome(backdrop);
                        backdrop.destroy();
                    } catch (e) {
                        console.error('[Kestrel] Error cleaning up focus mode:', e);
                    }
                },
            });
            this._backdrop = null;
        } else {
            this._cleanupUI();
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
        const entryId = this._entryIds[index];
        const entryData = entries.find(e => e.id === entryId);

        if (!entryData) {
            // Entry was resolved externally, try to advance
            this._entryIds.splice(index, 1);
            if (this._entryIds.length === 0) {
                this._exit();
                return;
            }
            this._currentIndex = Math.min(index, this._entryIds.length - 1);
            this._showEntry(this._currentIndex, direction);
            return;
        }

        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        // Remove old card with animation
        if (this._currentCard) {
            const oldCard = this._currentCard;
            const slideY = direction === 'up' ? SLIDE_OFFSET : -SLIDE_OFFSET;
            (oldCard as unknown as Easeable).ease({
                translation_y: slideY,
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try { oldCard.destroy(); } catch { /* already gone */ }
                },
            });
        }

        // Build new card
        const card = this._buildFocusCard(entryData.notification);
        this._currentCard = card;
        this._cardContainer.add_child(card);

        // Position card centered in right half
        const cardX = Math.round((halfW - CARD_WIDTH) / 2);
        const [, cardNatH] = card.get_preferred_height(CARD_WIDTH);
        const cardY = Math.round((monitor.height - cardNatH) / 2);
        card.set_position(cardX, cardY);

        // Animate card in
        const slideIn = direction === 'up' ? -SLIDE_OFFSET : (direction === 'down' ? SLIDE_OFFSET : 0);
        card.translation_y = direction === 'none' ? 0 : slideIn;
        card.opacity = 0;
        (card as unknown as Easeable).ease({
            translation_y: 0,
            opacity: 255,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Update counter
        this._updateCounter();

        // Position counter below card
        if (this._counterLabel) {
            this._counterLabel.set_position(cardX, cardY + cardNatH + 16);
            this._counterLabel.width = CARD_WIDTH;
        }

        // Update clone preview
        this._updatePreview(entryData.notification.sessionId, direction);
    }

    private _updatePreview(sessionId: string | undefined, direction: 'up' | 'down' | 'none'): void {
        if (!this._previewContainer) return;

        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        // Clean up old preview
        this._disconnectSourceDestroy();
        const oldClone = this._previewClone;
        const oldPlaceholder = this._previewPlaceholder;

        if (oldClone) {
            const slideY = direction === 'up' ? SLIDE_OFFSET : -SLIDE_OFFSET;
            (oldClone as unknown as Easeable).ease({
                translation_y: slideY,
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try { oldClone.destroy(); } catch { /* already gone */ }
                },
            });
            this._previewClone = null;
        }
        if (oldPlaceholder) {
            (oldPlaceholder as unknown as Easeable).ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try { oldPlaceholder.destroy(); } catch { /* already gone */ }
                },
            });
            this._previewPlaceholder = null;
        }

        // Resolve session → window → actor
        let actor: Meta.WindowActor | null = null;
        let frameRect: { x: number; y: number; width: number; height: number } | null = null;
        if (sessionId) {
            const windowId = this._deps.getWindowForSession(sessionId);
            if (windowId) {
                const metaWindow = this._deps.getMetaWindow(windowId);
                if (metaWindow) {
                    actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
                    frameRect = metaWindow.get_frame_rect();
                }
            }
        }

        if (actor && frameRect) {
            const clone = new Clutter.Clone({ source: actor });
            this._previewClone = clone;
            this._currentSourceActor = actor;

            // Connect source destroy to swap in placeholder
            this._sourceDestroyId = actor.connect('destroy', () => {
                this._sourceDestroyId = 0;
                this._currentSourceActor = null;
                if (this._previewClone) {
                    try { this._previewClone.destroy(); } catch { /* gone */ }
                    this._previewClone = null;
                }
                this._showPlaceholder(sessionId ?? '');
            });

            // Scale to 80%
            const scaledW = Math.round(frameRect.width * CLONE_SCALE);
            const scaledH = Math.round(frameRect.height * CLONE_SCALE);
            clone.set_size(scaledW, scaledH);

            // Center in left half
            const cloneX = Math.round((halfW - scaledW) / 2);
            const cloneY = Math.round((monitor.height - scaledH) / 2);
            clone.set_position(cloneX, cloneY);

            this._previewContainer.add_child(clone);

            // Animate in
            const slideIn = direction === 'up' ? -SLIDE_OFFSET : (direction === 'down' ? SLIDE_OFFSET : 0);
            clone.translation_y = direction === 'none' ? 0 : slideIn;
            clone.opacity = 0;
            (clone as unknown as Easeable).ease({
                translation_y: 0,
                opacity: 255,
                duration: ANIM_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._showPlaceholder(sessionId ?? '');
        }
    }

    private _showPlaceholder(sessionId: string): void {
        if (!this._previewContainer) return;

        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        const label = new St.Label({
            text: sessionId ? 'No preview available' : 'No associated session',
            style: `font-size: 14px; color: ${TEXT_DIM}; text-align: center;`,
        });
        this._previewPlaceholder = label;
        this._previewContainer.add_child(label);
        label.set_position(
            Math.round((halfW - 200) / 2),
            Math.round(monitor.height / 2),
        );
        label.width = 200;
        label.opacity = 0;
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
        const card = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 18px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);`,
            width: CARD_WIDTH,
        });

        // Header row: title + workspace
        const header = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });
        const titleLabel = new St.Label({
            text: notif.title,
            style: `font-weight: bold; font-size: 14px; color: ${TEXT};`,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        header.add_child(titleLabel);

        if (notif.workspaceName) {
            const wsLabel = new St.Label({
                text: notif.workspaceName,
                style: `font-family: monospace; font-size: 11px; color: ${TEXT_DIM};`,
                x_align: Clutter.ActorAlign.END,
            });
            header.add_child(wsLabel);
        }
        card.add_child(header);

        // Message — always fully expanded
        if (notif.message) {
            const msgLabel = new St.Label({
                text: notif.message,
                style: `font-size: 13px; color: ${TEXT_DIM}; margin-top: 8px;`,
                x_expand: true,
            });
            msgLabel.clutter_text.line_wrap = true;
            msgLabel.clutter_text.ellipsize = 0; // NONE
            card.add_child(msgLabel);
        }

        // Command block (permissions)
        if (notif.type === 'permission' && notif.command) {
            const cmdBlock = new St.Label({
                text: `$ ${notif.command}`,
                style: `font-family: monospace; font-size: 12px; color: ${ACCENT}; background-color: rgba(0,0,0,0.35); border-radius: 8px; padding: 8px 12px; margin-top: 12px; border: 1px solid rgba(255,255,255,0.03);`,
                x_expand: true,
            });
            cmdBlock.clutter_text.line_wrap = true;
            card.add_child(cmdBlock);
        }

        // Action hints
        if (notif.type === 'question') {
            // Build question-specific focus card content
            const entryId = notif.id;
            const qs = this._deps.getQuestionState(entryId);
            if (qs) {
                const isSubmitPage = qs.currentPage >= qs.questions.length;

                // Nav bar
                const navRow = new St.BoxLayout({
                    style: 'spacing: 4px; margin-top: 10px; margin-bottom: 8px;',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                const totalPages = qs.questions.length + 1;
                for (let i = 0; i < totalPages; i++) {
                    const isCurrent = i === qs.currentPage;
                    const isAnswered = i < qs.questions.length && (qs.answers.get(i) ?? []).length > 0;
                    let dotText: string;
                    let dotColor: string;
                    if (isCurrent) { dotText = '\u25CF'; dotColor = ACCENT; }
                    else if (isAnswered) { dotText = '\u2713'; dotColor = GREEN; }
                    else { dotText = '\u25CB'; dotColor = TEXT_DIM; }
                    navRow.add_child(new St.Label({
                        text: dotText,
                        style: `font-size: 10px; color: ${dotColor}; padding: 2px 3px;`,
                    }));
                }
                card.add_child(navRow);

                if (isSubmitPage) {
                    // Summary
                    for (let i = 0; i < qs.questions.length; i++) {
                        const qDef = qs.questions[i];
                        const selected = qs.answers.get(i) ?? [];
                        const answerText = selected.length > 0 ? selected.join(', ') : '(no answer)';
                        card.add_child(new St.Label({
                            text: `${qDef.header}: ${answerText}`,
                            style: `font-size: 11px; color: ${selected.length > 0 ? TEXT_DIM : RED}; margin-left: 4px;`,
                            x_expand: true,
                        }));
                    }

                    const allAnswered = qs.questions.every((_: QuestionDefinition, i: number) => (qs.answers.get(i) ?? []).length > 0);
                    const buttonRow = new St.BoxLayout({
                        style: 'spacing: 8px; margin-top: 14px;',
                        x_expand: true,
                    });
                    buttonRow.add_child(this._makeActionButton(
                        '[1] Send',
                        allAnswered ? GREEN : TEXT_DIM,
                        allAnswered ? 'rgba(74,158,110,0.12)' : 'transparent',
                    ));
                    buttonRow.add_child(this._makeActionButton('[2] Dismiss', TEXT_DIM, 'transparent'));
                    buttonRow.add_child(this._makeActionButton('[3] Visit', ACCENT, 'rgba(201,127,74,0.12)'));
                    card.add_child(buttonRow);
                } else {
                    // Question page with numbered options
                    const qDef = qs.questions[qs.currentPage];
                    const selected = qs.answers.get(qs.currentPage) ?? [];

                    const qLabel = new St.Label({
                        text: qDef.question,
                        style: `font-size: 13px; font-weight: bold; color: ${TEXT}; margin-bottom: 8px;`,
                        x_expand: true,
                    });
                    qLabel.clutter_text.line_wrap = true;
                    card.add_child(qLabel);

                    for (let i = 0; i < qDef.options.length; i++) {
                        const opt = qDef.options[i];
                        const isSelected = selected.includes(opt.label);
                        card.add_child(this._makeActionButton(
                            `[${i + 1}] ${opt.label}`,
                            isSelected ? TEXT : TEXT_DIM,
                            isSelected ? 'rgba(201,127,74,0.12)' : 'transparent',
                        ));
                    }
                }

                // Hint
                const hintText = isSubmitPage
                    ? '1-3 act    \u2190 \u2192 page    Esc close'
                    : '1-4 select    \u2190 \u2192 page    Esc close';
                card.add_child(new St.Label({
                    text: hintText,
                    style: `font-family: monospace; font-size: 10px; color: ${TEXT_DIM}; margin-top: 10px; text-align: center;`,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            }
        } else if (notif.type === 'permission') {
            const buttonRow = new St.BoxLayout({
                style: 'spacing: 8px; margin-top: 14px;',
                x_expand: true,
            });
            buttonRow.add_child(this._makeActionButton('[1] Allow', GREEN, 'rgba(74,158,110,0.12)'));
            buttonRow.add_child(this._makeActionButton('[2] Always', BLUE, 'rgba(90,142,201,0.12)'));
            buttonRow.add_child(this._makeActionButton('[3] Deny', RED, 'rgba(201,90,90,0.12)'));
            card.add_child(buttonRow);
        } else {
            const buttonRow = new St.BoxLayout({
                style: 'spacing: 8px; margin-top: 14px;',
                x_expand: true,
            });
            buttonRow.add_child(this._makeActionButton('[1] Visit', ACCENT, 'rgba(201,127,74,0.12)'));
            buttonRow.add_child(this._makeActionButton('[2] Dismiss', TEXT_DIM, 'transparent'));
            card.add_child(buttonRow);
        }

        return card;
    }

    private _makeActionButton(label: string, color: string, bgColor: string): St.Label {
        return new St.Label({
            text: label,
            style: `font-size: 13px; font-weight: bold; color: ${color}; background-color: ${bgColor}; border-radius: 8px; padding: 8px 16px; text-align: center;`,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
    }

    private _handleKeyPress(
        event: Clutter.Event,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const symbol = event.get_key_symbol();

        // Check if current entry is a question
        const entryId = this._entryIds[this._currentIndex];
        if (entryId) {
            const entries = this._deps.getPendingEntries();
            const entry = entries.find(e => e.id === entryId);
            if (entry?.notification.type === 'question') {
                return this._handleQuestionKeyPress(entryId, symbol);
            }
        }

        switch (symbol) {
            case Clutter.KEY_Up:
                this._navigate(-1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Down:
                this._navigate(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_1:
            case Clutter.KEY_KP_1:
                this._handleAction1();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_2:
            case Clutter.KEY_KP_2:
                this._handleAction2();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_3:
            case Clutter.KEY_KP_3:
                this._handleAction3();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Escape:
                this._exit();
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_STOP; // Consume all keys while modal
        }
    }

    private _handleQuestionKeyPress(
        entryId: string,
        symbol: number,
    ): typeof Clutter.EVENT_STOP {
        const qs = this._deps.getQuestionState(entryId);
        if (!qs) return Clutter.EVENT_STOP;

        const isSubmitPage = qs.currentPage >= qs.questions.length;

        switch (symbol) {
            case Clutter.KEY_Left:
                this._deps.questionNavigate(entryId, -1);
                this._refreshQuestionCard(entryId);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Right:
                this._deps.questionNavigate(entryId, 1);
                this._refreshQuestionCard(entryId);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Up:
                this._navigate(-1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Down:
                this._navigate(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_1:
            case Clutter.KEY_KP_1:
                if (isSubmitPage) {
                    // Send
                    const allAnswered = qs.questions.every((_: QuestionDefinition, i: number) => (qs.answers.get(i) ?? []).length > 0);
                    if (allAnswered) {
                        this._deps.questionSend(entryId);
                        this._removeCurrentEntry();
                    }
                } else {
                    this._deps.questionSelectOption(entryId, qs.currentPage, 0);
                    this._refreshQuestionCard(entryId);
                }
                return Clutter.EVENT_STOP;
            case Clutter.KEY_2:
            case Clutter.KEY_KP_2:
                if (isSubmitPage) {
                    // Dismiss
                    this._deps.questionDismiss(entryId);
                    this._removeCurrentEntry();
                } else if (qs.questions[qs.currentPage]?.options.length > 1) {
                    this._deps.questionSelectOption(entryId, qs.currentPage, 1);
                    this._refreshQuestionCard(entryId);
                }
                return Clutter.EVENT_STOP;
            case Clutter.KEY_3:
            case Clutter.KEY_KP_3:
                if (isSubmitPage) {
                    // Visit
                    this._deps.questionVisit(entryId);
                    this._removeCurrentEntry();
                } else if (qs.questions[qs.currentPage]?.options.length > 2) {
                    this._deps.questionSelectOption(entryId, qs.currentPage, 2);
                    this._refreshQuestionCard(entryId);
                }
                return Clutter.EVENT_STOP;
            case Clutter.KEY_4:
            case Clutter.KEY_KP_4:
                if (!isSubmitPage && qs.questions[qs.currentPage]?.options.length > 3) {
                    this._deps.questionSelectOption(entryId, qs.currentPage, 3);
                    this._refreshQuestionCard(entryId);
                }
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Escape:
                this._exit();
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_STOP;
        }
    }

    private _removeCurrentEntry(): void {
        const entryId = this._entryIds[this._currentIndex];
        if (!entryId) return;
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
        // Rebuild the focus card in-place for the current question page
        const entries = this._deps.getPendingEntries();
        const entryData = entries.find(e => e.id === entryId);
        if (!entryData || !this._cardContainer) return;

        // Remove old card
        if (this._currentCard) {
            try { this._currentCard.destroy(); } catch { /* gone */ }
        }

        const monitor = this._deps.getMonitor();
        const halfW = Math.floor(monitor.width / 2);

        const card = this._buildFocusCard(entryData.notification);
        this._currentCard = card;
        this._cardContainer.add_child(card);

        const cardX = Math.round((halfW - CARD_WIDTH) / 2);
        const [, cardNatH] = card.get_preferred_height(CARD_WIDTH);
        const cardY = Math.round((monitor.height - cardNatH) / 2);
        card.set_position(cardX, cardY);
        card.opacity = 255;

        if (this._counterLabel) {
            this._counterLabel.set_position(cardX, cardY + cardNatH + 16);
            this._counterLabel.width = CARD_WIDTH;
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

    private _onEntriesChanged(): void {
        if (!this._active) return;

        try {
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

            if (this._entryIds.length === 0) {
                this._exit();
                return;
            }

            // Adjust current index
            this._currentIndex = Math.min(this._currentIndex, this._entryIds.length - 1);
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
        if (this._active) {
            // Synchronous cleanup for extension disable
            this._active = false;
            this._deps.unregisterEntriesChanged();

            if (this._keyPressId) {
                global.stage.disconnect(this._keyPressId);
                this._keyPressId = 0;
            }
            if (this._buttonPressId) {
                global.stage.disconnect(this._buttonPressId);
                this._buttonPressId = 0;
            }
            if (this._grab) {
                try {
                    Main.popModal(this._grab);
                } catch (e) {
                    console.error('[Kestrel] Error in focus mode destroy popModal:', e);
                }
                this._grab = null;
            }
            this._cleanupUI();
            if (this._backdrop) {
                Main.layoutManager.removeChrome(this._backdrop);
                this._backdrop.destroy();
                this._backdrop = null;
            }
        }
    }
}
