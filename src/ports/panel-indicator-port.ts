import type { World } from '../domain/world.js';

export interface PanelIndicatorPort {
    update(world: World, statusOverlay?: { getWindowStatusMap(): ReadonlyMap<string, string> }): void;
    destroy(): void;
}
