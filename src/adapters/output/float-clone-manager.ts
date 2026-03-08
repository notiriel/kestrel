import type { WindowId } from '../../domain/world/types.js';
import type { FloatClonePort } from '../../ports/clone-port.js';
import { safeDisconnect } from '../signal-utils.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

interface FloatCloneEntry {
    wrapper: Clutter.Actor;
    clone: Clutter.Clone;
    metaWindow: Meta.Window;
    sourceActor: Meta.WindowActor;
    positionChangedId: number;
    sizeChangedId: number;
    sourceDestroyId: number;
    sourceDestroyed: boolean;
}

export class FloatCloneManager implements FloatClonePort {
    private _floatLayer: Clutter.Actor | null = null;
    private _floatClones: Map<WindowId, FloatCloneEntry> = new Map();

    init(parentLayer: unknown): void {
        const layer = parentLayer as Clutter.Actor;
        this._floatLayer = new Clutter.Actor({ name: 'kestrel-float-layer' });
        const parent = layer.get_parent()!;
        parent.insert_child_above(this._floatLayer, layer);
    }

    addFloatClone(windowId: WindowId, metaWindow: Meta.Window): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._floatLayer) return;

        const wrapper = this._createCloneWrapper(windowId, actor);
        const clone = wrapper.get_first_child() as Clutter.Clone;
        this._syncFloatClone(wrapper, clone, metaWindow);

        const entry = this._attachSignals(windowId, wrapper, clone, metaWindow, actor);
        this._floatClones.set(windowId, entry);
    }

    private _createCloneWrapper(windowId: WindowId, actor: Meta.WindowActor): Clutter.Actor {
        const wrapper = new Clutter.Actor({ name: `kestrel-float-${windowId}` });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        this._floatLayer!.add_child(wrapper);
        return wrapper;
    }

    private _attachSignals(windowId: WindowId, wrapper: Clutter.Actor, clone: Clutter.Clone, metaWindow: Meta.Window, actor: Meta.WindowActor): FloatCloneEntry {
        const syncFn = () => {
            try { this._syncFloatClone(wrapper, clone, metaWindow); }
            catch (e) { console.error('[Kestrel] Error in float clone sync:', e); }
        };
        const positionChangedId = metaWindow.connect('position-changed', syncFn);
        const sizeChangedId = metaWindow.connect('size-changed', syncFn);

        const entry: FloatCloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            positionChangedId, sizeChangedId,
            sourceDestroyId: 0, sourceDestroyed: false,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => { entry.sourceDestroyed = true; });
        return entry;
    }

    removeFloatClone(windowId: WindowId): void {
        const entry = this._floatClones.get(windowId);
        if (!entry) return;
        this._floatClones.delete(windowId);

        safeDisconnect(entry.metaWindow, entry.positionChangedId);
        safeDisconnect(entry.metaWindow, entry.sizeChangedId);
        if (!entry.sourceDestroyed) {
            entry.sourceActor.disconnect(entry.sourceDestroyId);
        }

        entry.wrapper.destroy();
    }

    private _syncFloatClone(wrapper: Clutter.Actor, clone: Clutter.Clone, metaWindow: Meta.Window): void {
        let frame, buffer;
        try {
            frame = metaWindow.get_frame_rect();
            buffer = metaWindow.get_buffer_rect();
        } catch {
            return;
        }
        if (frame.width <= 0 || frame.height <= 0) return;

        wrapper.set_position(frame.x, frame.y);
        wrapper.set_size(frame.width, frame.height);

        const cloneOffX = buffer.x - frame.x;
        const cloneOffY = buffer.y - frame.y;
        clone.set_position(cloneOffX, cloneOffY);
        clone.set_size(buffer.width, buffer.height);
    }

    destroy(): void {
        for (const entry of this._floatClones.values()) {
            entry.wrapper.remove_all_transitions();
            safeDisconnect(entry.metaWindow, entry.positionChangedId);
            safeDisconnect(entry.metaWindow, entry.sizeChangedId);
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.sourceDestroyId);
            }
        }
        this._floatClones.clear();

        if (this._floatLayer) {
            this._floatLayer.destroy();
            this._floatLayer = null;
        }
    }
}
