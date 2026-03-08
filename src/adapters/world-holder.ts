import type { SceneModel } from '../domain/scene/scene.js';
import type { WorkspaceId, WorldUpdate } from '../domain/world/types.js';
import type { World } from '../domain/world/world.js';

export interface SceneApplyOptions {
    animate: boolean;
    nudgeUnsettled?: boolean;
    scrollTransfer?: { workspaceId: WorkspaceId; oldScrollX: number };
}

export interface SceneSubscriber {
    onSceneChanged(scene: SceneModel, options: SceneApplyOptions): void;
}

export interface WorldSubscriber {
    onWorldChanged(world: World): void;
}

export class WorldHolder {
    private _world: World | null = null;
    private _sceneSubscribers: SceneSubscriber[] = [];
    private _worldSubscribers: WorldSubscriber[] = [];

    get world(): World | null {
        return this._world;
    }

    /** Store world and fire world subscribers only. Used for notification-only changes. */
    setWorld(world: World): void {
        this._world = world;
        for (const sub of this._worldSubscribers) {
            sub.onWorldChanged(world);
        }
    }

    /** Store world, fire world subscribers, then fire scene subscribers. */
    applyUpdate(update: WorldUpdate, options: SceneApplyOptions): void {
        this._world = update.world;
        for (const sub of this._worldSubscribers) {
            sub.onWorldChanged(update.world);
        }
        for (const sub of this._sceneSubscribers) {
            sub.onSceneChanged(update.scene, options);
        }
    }

    subscribeScene(subscriber: SceneSubscriber): void {
        this._sceneSubscribers.push(subscriber);
    }

    unsubscribeScene(subscriber: SceneSubscriber): void {
        const idx = this._sceneSubscribers.indexOf(subscriber);
        if (idx >= 0) this._sceneSubscribers.splice(idx, 1);
    }

    subscribeWorld(subscriber: WorldSubscriber): void {
        this._worldSubscribers.push(subscriber);
    }

    unsubscribeWorld(subscriber: WorldSubscriber): void {
        const idx = this._worldSubscribers.indexOf(subscriber);
        if (idx >= 0) this._worldSubscribers.splice(idx, 1);
    }
}
