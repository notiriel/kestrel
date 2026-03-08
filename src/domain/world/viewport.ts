export interface Viewport {
    readonly workspaceIndex: number;
    readonly scrollX: number;
    readonly widthPx: number;
}

export function createViewport(widthPx: number): Viewport {
    return { workspaceIndex: 0, scrollX: 0, widthPx };
}
