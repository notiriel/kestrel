export interface QuestionOption {
    readonly label: string;
    readonly description: string;
}

export interface QuestionDefinition {
    readonly question: string;
    readonly header: string;
    readonly options: readonly QuestionOption[];
    readonly multiSelect: boolean;
}

export interface OverlayNotification {
    readonly id: string;
    readonly sessionId?: string;
    readonly workspaceName?: string;
    readonly type: 'permission' | 'notification' | 'question';
    readonly title: string;
    readonly message: string;
    readonly command?: string;
    readonly toolName?: string;
    readonly questions?: readonly QuestionDefinition[];
    readonly timestamp: number;
}

export type ClaudeStatus = 'working' | 'needs-input' | 'done';
