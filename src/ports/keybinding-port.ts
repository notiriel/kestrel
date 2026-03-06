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
    onToggleHelp: () => void;
    onCloseWindow: () => void;
    onJoinStack: () => void;
    onForceWorkspaceUp: () => void;
    onForceWorkspaceDown: () => void;
    onQuakeSlot1: () => void;
    onQuakeSlot2: () => void;
    onQuakeSlot3: () => void;
    onQuakeSlot4: () => void;
    onWorkspaceTodosToggle: () => void;
}

export interface KeybindingPort {
    connect(settings: Gio.Settings, callbacks: KeybindingCallbacks): void;
    destroy(): void;
}
