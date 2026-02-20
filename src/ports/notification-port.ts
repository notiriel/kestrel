export interface NotificationInitOptions {
    onVisitSession?: (sessionId: string) => void;
}

export interface NotificationPort {
    init(options?: NotificationInitOptions): void;
    showPermission(id: string, payload: Record<string, unknown>): void;
    showNotification(id: string, payload: Record<string, unknown>): void;
    showQuestion(id: string, payload: Record<string, unknown>): void;
    getResponse(id: string): string | null;
    destroy(): void;
}
