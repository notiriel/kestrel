import type { WindowId } from '../domain/types.js';
import type { FloatClonePort } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
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

        const wrapper = new Clutter.Actor({ name: `kestrel-float-${windowId}` });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        this._floatLayer.add_child(wrapper);

        this._syncFloatClone(wrapper, clone, metaWindow);

        const positionChangedId = metaWindow.connect('position-changed', () => {
            try {
                this._syncFloatClone(wrapper, clone, metaWindow);
            } catch (e) {
                console.error('[Kestrel] Error in float position-changed handler:', e);
            }
        });

        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._syncFloatClone(wrapper, clone, metaWindow);
            } catch (e) {
                console.error('[Kestrel] Error in float size-changed handler:', e);
            }
        });

        const entry: FloatCloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            positionChangedId, sizeChangedId,
            sourceDestroyId: 0, sourceDestroyed: false,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => {
            entry.sourceDestroyed = true;
        });

        this._floatClones.set(windowId, entry);
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
