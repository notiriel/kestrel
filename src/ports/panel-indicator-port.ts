import type { World } from '../domain/world.js';

export interface PanelIndicatorPort {
    update(world: World): void;
    destroy(): void;
}
