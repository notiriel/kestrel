/**
 * Notification scene model — pure TypeScript, no gi:// imports.
 *
 * Computes visual scene descriptions for notification overlay, focus mode,
 * and status badges. Adapters consume these scene models to position/animate widgets.
 */

import type { WindowId } from '../world/types.js';
import type { NotificationState, DomainNotification, NotificationType, NotificationInteractionState } from '../world/notification.js';
import { getPendingEntries } from '../world/notification.js';
import type { ClaudeStatus } from '../world/notification-types.js';

// --- Layout constants (moved from adapters) ---

const COLLAPSED_H = 62;
const STACK_OFFSET_Y = 4;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.05;
const CARD_MARGIN = 12;
const MAX_VISIBLE_STACKED = 5;

// Card dimensions imported as constants (matching notification-overlay-builders.ts)
const CARD_WIDTH = 400;
const QUESTION_CARD_WIDTH = 600;
const CARD_RIGHT_OFFSET = QUESTION_CARD_WIDTH - CARD_WIDTH;

// Focus mode constants (moved from notification-focus-mode.ts)
const FOCUS_CARD_WIDTH = 600;
const CLONE_SCALE = 0.8;

// --- Scene model types ---

export interface NotificationCardScene {
    readonly id: string;
    readonly type: NotificationType;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly scale: number;
    readonly opacity: number;
    readonly translationX: number;
    readonly reactive: boolean;
    readonly hasInternalPadding: boolean;
}

export interface NotificationCountBadgeScene {
    readonly visible: boolean;
    readonly text: string;
    readonly x: number;
    readonly y: number;
}

export interface NotificationOverlayScene {
    readonly visible: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly cards: readonly NotificationCardScene[];
    readonly countBadge: NotificationCountBadgeScene;
}

export interface FocusModeCardScene {
    readonly notificationId: string;
    readonly type: NotificationType;
    readonly x: number;
    readonly y: number;
    readonly width: number;
}

export interface FocusModePreviewScene {
    readonly windowId: WindowId | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly showPlaceholder: boolean;
}

export interface FocusModeCounterScene {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
}

export interface FocusModeScene {
    readonly active: boolean;
    readonly card: FocusModeCardScene | null;
    readonly preview: FocusModePreviewScene;
    readonly counter: FocusModeCounterScene;
    readonly hintY: number;
}

export interface StatusBadgeScene {
    readonly windowId: WindowId;
    readonly status: ClaudeStatus;
    readonly x: number;
    readonly y: number;
    readonly visible: boolean;
    readonly message: string;
}

// --- Monitor/panel info needed for layout ---

export interface NotificationMonitorInfo {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

// --- Card behavior (type-specific layout properties) ---

interface CardBehavior {
    readonly collapsedWidth: number;
    readonly expandedWidth: number;
    readonly collapsedTranslationX: number;
    readonly hasInternalPadding: boolean;
}

function getCardBehavior(type: NotificationType): CardBehavior {
    if (type === 'question') {
        return {
            collapsedWidth: CARD_WIDTH,
            expandedWidth: QUESTION_CARD_WIDTH,
            collapsedTranslationX: CARD_RIGHT_OFFSET,
            hasInternalPadding: true,
        };
    }
    return {
        collapsedWidth: CARD_WIDTH,
        expandedWidth: CARD_WIDTH,
        collapsedTranslationX: CARD_RIGHT_OFFSET,
        hasInternalPadding: false,
    };
}

// --- Overlay scene computation ---

/**
 * Compute the notification overlay scene from domain state.
 * Produces positions for all pending notification cards and the count badge.
 */
export function computeOverlayScene(
    notifState: NotificationState,
    interactionState: NotificationInteractionState,
    monitor: NotificationMonitorInfo,
    panelHeight: number,
    expandedCardHeights?: ReadonlyMap<string, number>,
): NotificationOverlayScene {
    const pending = getPendingEntries(notifState);
    const count = pending.length;

    if (count === 0) {
        return {
            visible: false,
            x: monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
            y: monitor.y + panelHeight + CARD_MARGIN,
            width: QUESTION_CARD_WIDTH + CARD_MARGIN * 2,
            height: 0,
            cards: [],
            countBadge: { visible: false, text: '0', x: 0, y: 0 },
        };
    }

    const containerX = monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2;
    const containerY = monitor.y + panelHeight + CARD_MARGIN;
    const containerWidth = QUESTION_CARD_WIDTH + CARD_MARGIN * 2;

    let cards: NotificationCardScene[];
    let containerHeight: number;

    if (interactionState.stackExpanded) {
        const result = computeExpandedCards(pending, interactionState, expandedCardHeights);
        cards = result.cards;
        containerHeight = result.totalHeight;
    } else {
        const result = computeCollapsedCards(pending);
        cards = result.cards;
        containerHeight = result.totalHeight;
    }

    const countBadge: NotificationCountBadgeScene = {
        visible: count > 1,
        text: String(count),
        x: CARD_RIGHT_OFFSET + CARD_WIDTH - 30,
        y: -10,
    };

    return {
        visible: true,
        x: containerX,
        y: containerY,
        width: containerWidth,
        height: containerHeight,
        cards,
        countBadge,
    };
}

function computeExpandedCards(
    pending: readonly DomainNotification[],
    interactionState: NotificationInteractionState,
    expandedCardHeights?: ReadonlyMap<string, number>,
): { cards: NotificationCardScene[]; totalHeight: number } {
    const cards: NotificationCardScene[] = [];
    let y = 0;

    for (const notif of pending) {
        const behavior = getCardBehavior(notif.type);
        const isCardExpanded = interactionState.expandedCardIds.has(notif.id);
        const expandedHeight = expandedCardHeights?.get(notif.id) ?? 0;
        const cardHeight = isCardExpanded ? COLLAPSED_H + expandedHeight : COLLAPSED_H;
        const translationX = isCardExpanded && behavior.expandedWidth !== behavior.collapsedWidth
            ? 0
            : behavior.collapsedTranslationX;

        cards.push({
            id: notif.id,
            type: notif.type,
            x: 0,
            y,
            width: isCardExpanded ? behavior.expandedWidth : behavior.collapsedWidth,
            scale: 1,
            opacity: 255,
            translationX,
            reactive: true,
            hasInternalPadding: behavior.hasInternalPadding,
        });

        y += cardHeight + STACK_OFFSET_Y;
    }

    return { cards, totalHeight: y > 0 ? y : 0 };
}

function computeCollapsedCards(
    pending: readonly DomainNotification[],
): { cards: NotificationCardScene[]; totalHeight: number } {
    const cards: NotificationCardScene[] = [];
    const count = pending.length;

    for (let i = 0; i < count; i++) {
        const notif = pending[i]!;
        const behavior = getCardBehavior(notif.type);
        const scale = Math.max(0, 1 - i * STACK_SCALE_STEP);
        const opacity = i > MAX_VISIBLE_STACKED - 1
            ? 0
            : Math.round(255 * Math.max(0, 1 - i * STACK_OPACITY_STEP));
        const ty = (COLLAPSED_H - COLLAPSED_H * scale) + i * STACK_OFFSET_Y;

        cards.push({
            id: notif.id,
            type: notif.type,
            x: 0,
            y: ty,
            width: behavior.collapsedWidth,
            scale,
            opacity,
            translationX: behavior.collapsedTranslationX,
            reactive: i === 0,
            hasInternalPadding: behavior.hasInternalPadding,
        });
    }

    const stackHeight = count > 0
        ? COLLAPSED_H + Math.min(count - 1, MAX_VISIBLE_STACKED - 1) * STACK_OFFSET_Y
        : 0;

    return { cards, totalHeight: stackHeight };
}

// --- Focus mode scene computation ---

/**
 * Compute the focus mode scene from domain state.
 * Produces card position, preview geometry, and counter text.
 */
export function computeFocusModeScene(
    notifState: NotificationState,
    monitor: NotificationMonitorInfo,
    windowGeometries: ReadonlyMap<WindowId, { x: number; y: number; width: number; height: number }>,
    cardHeight?: number,
): FocusModeScene {
    const fm = notifState.focusMode;
    if (!fm.active) {
        return {
            active: false,
            card: null,
            preview: { windowId: null, x: 0, y: 0, width: 0, height: 0, scale: 0, showPlaceholder: true },
            counter: { text: '', x: 0, y: 0, width: 0 },
            hintY: 0,
        };
    }

    const halfW = Math.floor(monitor.width / 2);
    const pending = getPendingEntries(notifState);
    const entryId = fm.entryIds[fm.currentIndex];
    const entry = pending.find(n => n.id === entryId);

    // Card scene
    let card: FocusModeCardScene | null = null;
    const resolvedCardHeight = cardHeight ?? 200;
    const cardX = Math.round((halfW - FOCUS_CARD_WIDTH) / 2);
    const cardY = Math.round((monitor.height - resolvedCardHeight) / 2);

    if (entry) {
        card = {
            notificationId: entry.id,
            type: entry.type,
            x: cardX,
            y: cardY,
            width: FOCUS_CARD_WIDTH,
        };
    }

    // Preview scene
    let preview: FocusModePreviewScene;
    if (entry) {
        const windowId = notifState.sessionWindows.get(entry.sessionId) ?? null;
        const geo = windowId ? windowGeometries.get(windowId) : null;

        if (geo) {
            const scaledW = Math.round(geo.width * CLONE_SCALE);
            const scaledH = Math.round(geo.height * CLONE_SCALE);
            preview = {
                windowId,
                x: Math.round((halfW - scaledW) / 2),
                y: Math.round((monitor.height - scaledH) / 2),
                width: scaledW,
                height: scaledH,
                scale: CLONE_SCALE,
                showPlaceholder: false,
            };
        } else {
            preview = {
                windowId,
                x: Math.round((halfW - 200) / 2),
                y: Math.round(monitor.height / 2),
                width: 200,
                height: 0,
                scale: 0,
                showPlaceholder: true,
            };
        }
    } else {
        preview = {
            windowId: null,
            x: Math.round((halfW - 200) / 2),
            y: Math.round(monitor.height / 2),
            width: 200,
            height: 0,
            scale: 0,
            showPlaceholder: true,
        };
    }

    // Counter
    const counter: FocusModeCounterScene = {
        text: `${fm.currentIndex + 1} / ${fm.entryIds.length}`,
        x: cardX,
        y: cardY + resolvedCardHeight + 16,
        width: FOCUS_CARD_WIDTH,
    };

    // Hint position
    const hintY = monitor.height - 50;

    return { active: true, card, preview, counter, hintY };
}

// --- Status badge scene computation ---

export interface OverviewTransformInfo {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
}

export interface ClonePositionInfo {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly wsIndex: number;
}

const PILL_MARGIN = 8;

/**
 * Compute status badge scenes for all windows with Claude session status.
 * Used during overview mode to position pill badges at top-center of clones.
 * The x coordinate is the horizontal center; adapters subtract half pill width.
 */
export function computeStatusBadgeScenes(
    notifState: NotificationState,
    clonePositions: ReadonlyMap<WindowId, ClonePositionInfo>,
    transform: OverviewTransformInfo,
    layerHeight: number,
): StatusBadgeScene[] {
    const badges: StatusBadgeScene[] = [];

    for (const [windowId, status] of notifState.windowStatuses) {
        const pos = clonePositions.get(windowId);
        if (!pos) continue;

        const { scale, offsetX, offsetY } = transform;
        const x = (pos.x + pos.width / 2) * scale + offsetX;
        const y = (pos.wsIndex * layerHeight + pos.y + PILL_MARGIN) * scale + offsetY;

        badges.push({
            windowId,
            status,
            x: Math.round(x),
            y: Math.round(y),
            visible: true,
            message: notifState.windowStatusMessages.get(windowId) ?? '',
        });
    }

    return badges;
}
