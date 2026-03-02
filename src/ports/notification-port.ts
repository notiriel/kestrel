import type { NotificationOverlayScene } from '../domain/notification-scene.js';
import type { DomainNotification } from '../domain/notification.js';

export interface NotificationInitOptions {
    onVisitSession?: (sessionId: string) => void;
}

export interface NotificationPort {
    init(options?: NotificationInitOptions): void;
    applyOverlayScene(scene: NotificationOverlayScene, notifications: ReadonlyMap<string, DomainNotification>): void;
    destroy(): void;
}
