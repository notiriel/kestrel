import type Gio from 'gi://Gio';

export interface KeybindingCallbacks {
    onFocusRight: () => void;
    onFocusLeft: () => void;
    onFocusDown: () => void;
    onFocusUp: () => void;
    onMoveLeft: () => void;
    onMoveRight: () => void;
    onMoveDown: () => void;
    onMoveUp: () => void;
    onToggleSize: () => void;
    onToggleOverview: () => void;
    onNewWindow: () => void;
    onToggleNotifications: () => void;
}

export interface KeybindingPort {
    connect(settings: Gio.Settings, callbacks: KeybindingCallbacks): void;
    destroy(): void;
}
