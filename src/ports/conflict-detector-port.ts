export interface ConflictDetectorPort {
    detectConflicts(): void;
    destroy(): void;
}
