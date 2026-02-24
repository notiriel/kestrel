import type { World } from '../domain/world.js';

export class WorldHolder {
    private _world: World | null = null;
    private _onWorldChanged: ((world: World) => void) | null = null;

    setOnWorldChanged(cb: ((world: World) => void) | null): void {
        this._onWorldChanged = cb;
    }

    get world(): World | null {
        return this._world;
    }

    setWorld(world: World): void {
        this._world = world;
        if (this._onWorldChanged) {
            this._onWorldChanged(world);
        }
    }
}
