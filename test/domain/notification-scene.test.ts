import { describe, it, expect } from 'vitest';
import type { WindowId } from '../../src/domain/types.js';
import type { NotificationState, DomainNotification } from '../../src/domain/notification.js';
import { createNotificationState, enterFocusMode, registerSession, setSessionStatus, setSessionMessage } from '../../src/domain/notification.js';
import {
    createNotificationInteractionState,
    expandStack, collapseStack, expandCard, collapseCard,
    computeOverlayScene, computeFocusModeScene, computeStatusBadgeScenes,
    type NotificationMonitorInfo,
    type OverviewTransformInfo, type ClonePositionInfo,
} from '../../src/domain/notification-scene.js';

const MONITOR: NotificationMonitorInfo = { x: 0, y: 0, width: 1920, height: 1080 };
const PANEL_HEIGHT = 32;

function makeDomainNotification(overrides: Partial<DomainNotification> & { id: string }): DomainNotification {
    return {
        sessionId: 'session-1',
        type: 'permission',
        title: 'Permission Request',
        message: 'Allow this?',
        questions: [],
        status: 'pending',
        response: null,
        timestamp: Date.now(),
        questionState: { currentPage: 0, answers: new Map(), otherTexts: new Map(), otherActive: new Map() },
        ...overrides,
    };
}

function stateWithNotifications(...notifs: DomainNotification[]): NotificationState {
    let state = createNotificationState();
    for (const n of notifs) {
        const notifications = new Map(state.notifications);
        notifications.set(n.id, n);
        state = { ...state, notifications };
    }
    return state;
}

describe('NotificationInteractionState', () => {
    it('creates with defaults', () => {
        const state = createNotificationInteractionState();
        expect(state.stackExpanded).toBe(false);
        expect(state.expandedCardIds.size).toBe(0);
    });

    it('expandStack / collapseStack', () => {
        let state = createNotificationInteractionState();
        state = expandStack(state);
        expect(state.stackExpanded).toBe(true);
        state = collapseStack(state);
        expect(state.stackExpanded).toBe(false);
    });

    it('expandCard / collapseCard', () => {
        let state = createNotificationInteractionState();
        state = expandCard(state, 'card-1');
        expect(state.expandedCardIds.has('card-1')).toBe(true);
        state = expandCard(state, 'card-2');
        expect(state.expandedCardIds.size).toBe(2);
        state = collapseCard(state, 'card-1');
        expect(state.expandedCardIds.has('card-1')).toBe(false);
        expect(state.expandedCardIds.has('card-2')).toBe(true);
    });

    it('collapseStack clears expanded cards', () => {
        let state = createNotificationInteractionState();
        state = expandStack(state);
        state = expandCard(state, 'card-1');
        state = collapseStack(state);
        expect(state.expandedCardIds.size).toBe(0);
    });
});

describe('computeOverlayScene', () => {
    it('returns invisible scene for empty state', () => {
        const state = createNotificationState();
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);
        expect(scene.visible).toBe(false);
        expect(scene.cards).toHaveLength(0);
        expect(scene.countBadge.visible).toBe(false);
    });

    it('single card collapsed', () => {
        const notif = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const state = stateWithNotifications(notif);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        expect(scene.visible).toBe(true);
        expect(scene.cards).toHaveLength(1);
        expect(scene.cards[0]!.id).toBe('n1');
        expect(scene.cards[0]!.scale).toBe(1);
        expect(scene.cards[0]!.opacity).toBe(255);
        expect(scene.cards[0]!.reactive).toBe(true);
        expect(scene.countBadge.visible).toBe(false);
    });

    it('multiple cards collapsed — stacking with scale/opacity', () => {
        const n1 = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const n2 = makeDomainNotification({ id: 'n2', timestamp: 2000 });
        const n3 = makeDomainNotification({ id: 'n3', timestamp: 3000 });
        const state = stateWithNotifications(n1, n2, n3);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        expect(scene.visible).toBe(true);
        expect(scene.cards).toHaveLength(3);
        expect(scene.countBadge.visible).toBe(true);
        expect(scene.countBadge.text).toBe('3');

        // First card (top of stack) — full size, reactive
        expect(scene.cards[0]!.scale).toBe(1);
        expect(scene.cards[0]!.opacity).toBe(255);
        expect(scene.cards[0]!.reactive).toBe(true);

        // Second card — slightly scaled down, not reactive
        expect(scene.cards[1]!.scale).toBeLessThan(1);
        expect(scene.cards[1]!.opacity).toBeLessThan(255);
        expect(scene.cards[1]!.reactive).toBe(false);

        // Third card — more scaled down
        expect(scene.cards[2]!.scale).toBeLessThan(scene.cards[1]!.scale);
    });

    it('expanded stack — all cards at full scale, reactive', () => {
        const n1 = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const n2 = makeDomainNotification({ id: 'n2', timestamp: 2000 });
        const state = stateWithNotifications(n1, n2);
        const interaction = expandStack(createNotificationInteractionState());
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        expect(scene.cards).toHaveLength(2);
        for (const card of scene.cards) {
            expect(card.scale).toBe(1);
            expect(card.opacity).toBe(255);
            expect(card.reactive).toBe(true);
        }
        // Cards should be vertically offset
        expect(scene.cards[1]!.y).toBeGreaterThan(scene.cards[0]!.y);
    });

    it('container positioned at top-right of monitor', () => {
        const n1 = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const state = stateWithNotifications(n1);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        // Container should be right-aligned
        expect(scene.x).toBe(MONITOR.width - 600 - 12 * 2);
        expect(scene.y).toBe(PANEL_HEIGHT + 12);
    });

    it('question card uses full width, no translationX offset', () => {
        const n1 = makeDomainNotification({ id: 'n1', type: 'question', timestamp: 1000 });
        const state = stateWithNotifications(n1);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        expect(scene.cards[0]!.translationX).toBe(0);
        expect(scene.cards[0]!.width).toBe(600);
    });

    it('permission card has translationX offset in collapsed state', () => {
        const n1 = makeDomainNotification({ id: 'n1', type: 'permission', timestamp: 1000 });
        const state = stateWithNotifications(n1);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        expect(scene.cards[0]!.translationX).toBe(200); // CARD_RIGHT_OFFSET
        expect(scene.cards[0]!.width).toBe(400);
    });

    it('cards beyond visible limit have opacity 0', () => {
        const notifs = Array.from({ length: 7 }, (_, i) =>
            makeDomainNotification({ id: `n${i}`, timestamp: i * 1000 }),
        );
        const state = stateWithNotifications(...notifs);
        const interaction = createNotificationInteractionState();
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT);

        // Cards at index >= 5 should be invisible
        expect(scene.cards[4]!.opacity).toBeGreaterThan(0);
        expect(scene.cards[5]!.opacity).toBe(0);
        expect(scene.cards[6]!.opacity).toBe(0);
    });

    it('expanded card height affects layout in expanded stack', () => {
        const n1 = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const n2 = makeDomainNotification({ id: 'n2', timestamp: 2000 });
        const state = stateWithNotifications(n1, n2);
        let interaction = expandStack(createNotificationInteractionState());
        interaction = expandCard(interaction, 'n1');

        const expandedHeights = new Map([['n1', 100]]);
        const scene = computeOverlayScene(state, interaction, MONITOR, PANEL_HEIGHT, expandedHeights);

        // n2 should be offset by n1's expanded height (62 + 100 + 4)
        expect(scene.cards[1]!.y).toBe(62 + 100 + 4);
    });
});

describe('computeFocusModeScene', () => {
    it('returns inactive scene when focus mode is off', () => {
        const state = createNotificationState();
        const scene = computeFocusModeScene(state, MONITOR, new Map());
        expect(scene.active).toBe(false);
        expect(scene.card).toBeNull();
    });

    it('computes card position centered in right half', () => {
        const notif = makeDomainNotification({ id: 'n1', sessionId: 'sess-1', timestamp: 1000 });
        let state = stateWithNotifications(notif);
        state = enterFocusMode(state, ['n1']);

        const scene = computeFocusModeScene(state, MONITOR, new Map(), 200);
        expect(scene.active).toBe(true);
        expect(scene.card).not.toBeNull();
        expect(scene.card!.notificationId).toBe('n1');
        expect(scene.card!.width).toBe(600);

        // Card should be centered in right half
        const halfW = Math.floor(1920 / 2);
        expect(scene.card!.x).toBe(Math.round((halfW - 600) / 2));
        expect(scene.card!.y).toBe(Math.round((1080 - 200) / 2));
    });

    it('computes preview with clone geometry when window available', () => {
        const notif = makeDomainNotification({ id: 'n1', sessionId: 'sess-1', timestamp: 1000 });
        let state = stateWithNotifications(notif);
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = enterFocusMode(state, ['n1']);

        const windowGeos = new Map([
            ['win-1' as WindowId, { x: 100, y: 100, width: 800, height: 600 }],
        ]);
        const scene = computeFocusModeScene(state, MONITOR, windowGeos, 200);

        expect(scene.preview.windowId).toBe('win-1');
        expect(scene.preview.showPlaceholder).toBe(false);
        expect(scene.preview.width).toBe(Math.round(800 * 0.8));
        expect(scene.preview.height).toBe(Math.round(600 * 0.8));
        expect(scene.preview.scale).toBe(0.8);
    });

    it('shows placeholder when no window geometry available', () => {
        const notif = makeDomainNotification({ id: 'n1', sessionId: 'sess-1', timestamp: 1000 });
        let state = stateWithNotifications(notif);
        state = enterFocusMode(state, ['n1']);

        const scene = computeFocusModeScene(state, MONITOR, new Map(), 200);

        expect(scene.preview.showPlaceholder).toBe(true);
        expect(scene.preview.windowId).toBeNull();
    });

    it('counter text reflects current index and total', () => {
        const n1 = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        const n2 = makeDomainNotification({ id: 'n2', timestamp: 2000 });
        let state = stateWithNotifications(n1, n2);
        state = enterFocusMode(state, ['n1', 'n2']);

        const scene = computeFocusModeScene(state, MONITOR, new Map(), 200);
        expect(scene.counter.text).toBe('1 / 2');
    });

    it('hint positioned at bottom of monitor', () => {
        const notif = makeDomainNotification({ id: 'n1', timestamp: 1000 });
        let state = stateWithNotifications(notif);
        state = enterFocusMode(state, ['n1']);

        const scene = computeFocusModeScene(state, MONITOR, new Map(), 200);
        expect(scene.hintY).toBe(1080 - 50);
    });
});

describe('computeStatusBadgeScenes', () => {
    it('returns empty for state with no statuses', () => {
        const state = createNotificationState();
        const badges = computeStatusBadgeScenes(state, new Map(), { scale: 0.5, offsetX: 0, offsetY: 0 }, 1080);
        expect(badges).toHaveLength(0);
    });

    it('computes badge position from clone position and transform', () => {
        let state = createNotificationState();
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = setSessionStatus(state, 'sess-1', 'working');

        const clonePositions = new Map<WindowId, ClonePositionInfo>([
            ['win-1' as WindowId, { x: 100, y: 50, width: 800, height: 600, wsIndex: 0 }],
        ]);
        const transform: OverviewTransformInfo = { scale: 0.5, offsetX: 10, offsetY: 20 };
        const badges = computeStatusBadgeScenes(state, clonePositions, transform, 1080);

        expect(badges).toHaveLength(1);
        expect(badges[0]!.windowId).toBe('win-1');
        expect(badges[0]!.status).toBe('working');
        expect(badges[0]!.visible).toBe(true);

        // Verify top-center position calculation (pill margin = 8)
        const expectedX = (100 + 800 / 2) * 0.5 + 10;
        const expectedY = (0 * 1080 + 50 + 8) * 0.5 + 20;
        expect(badges[0]!.x).toBe(Math.round(expectedX));
        expect(badges[0]!.y).toBe(Math.round(expectedY));
    });

    it('skips windows without clone positions', () => {
        let state = createNotificationState();
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = setSessionStatus(state, 'sess-1', 'working');

        // No clone positions for win-1
        const badges = computeStatusBadgeScenes(state, new Map(), { scale: 0.5, offsetX: 0, offsetY: 0 }, 1080);
        expect(badges).toHaveLength(0);
    });

    it('includes message from windowStatusMessages', () => {
        let state = createNotificationState();
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = setSessionStatus(state, 'sess-1', 'working');
        state = setSessionMessage(state, 'sess-1', 'Fixing auth module');

        const clonePositions = new Map<WindowId, ClonePositionInfo>([
            ['win-1' as WindowId, { x: 100, y: 50, width: 800, height: 600, wsIndex: 0 }],
        ]);
        const transform: OverviewTransformInfo = { scale: 0.5, offsetX: 10, offsetY: 20 };
        const badges = computeStatusBadgeScenes(state, clonePositions, transform, 1080);

        expect(badges).toHaveLength(1);
        expect(badges[0]!.message).toBe('Fixing auth module');
    });

    it('returns "..." message after status change', () => {
        let state = createNotificationState();
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = setSessionStatus(state, 'sess-1', 'working');

        const clonePositions = new Map<WindowId, ClonePositionInfo>([
            ['win-1' as WindowId, { x: 100, y: 50, width: 800, height: 600, wsIndex: 0 }],
        ]);
        const transform: OverviewTransformInfo = { scale: 0.5, offsetX: 0, offsetY: 0 };
        const badges = computeStatusBadgeScenes(state, clonePositions, transform, 1080);

        expect(badges).toHaveLength(1);
        expect(badges[0]!.message).toBe('...');
    });

    it('multiple windows on different workspaces', () => {
        let state = createNotificationState();
        state = registerSession(state, 'sess-1', 'win-1' as WindowId);
        state = registerSession(state, 'sess-2', 'win-2' as WindowId);
        state = setSessionStatus(state, 'sess-1', 'working');
        state = setSessionStatus(state, 'sess-2', 'needs-input');

        const clonePositions = new Map<WindowId, ClonePositionInfo>([
            ['win-1' as WindowId, { x: 100, y: 50, width: 800, height: 600, wsIndex: 0 }],
            ['win-2' as WindowId, { x: 200, y: 100, width: 600, height: 400, wsIndex: 1 }],
        ]);
        const transform: OverviewTransformInfo = { scale: 1, offsetX: 0, offsetY: 0 };
        const badges = computeStatusBadgeScenes(state, clonePositions, transform, 1080);

        expect(badges).toHaveLength(2);
        const badge1 = badges.find(b => b.windowId === ('win-1' as WindowId));
        const badge2 = badges.find(b => b.windowId === ('win-2' as WindowId));
        expect(badge1!.status).toBe('working');
        expect(badge2!.status).toBe('needs-input');
        // win-2 on wsIndex 1 should have higher y due to layerHeight offset
        expect(badge2!.y).toBeGreaterThan(badge1!.y);
    });
});
