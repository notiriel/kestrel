import type { WindowId, LayoutState, WindowLayout } from '../domain/types.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

interface CloneEntry {
    wrapper: Clutter.Actor;
    clone: Clutter.Clone;
}

export class CloneAdapter {
    private _layer: Clutter.Actor | null = null;
    private _scrollContainer: Clutter.Actor | null = null;
    private _clones: Map<WindowId, CloneEntry> = new Map();

    init(): void {
        this._layer = new Clutter.Actor({ name: 'paperflow-layer' });
        this._scrollContainer = new Clutter.Actor({ name: 'paperflow-scroll' });
        this._layer.add_child(this._scrollContainer);

        // Insert paperflow-layer above window_group
        const stage = global.get_stage();
        stage.insert_child_above(this._layer, global.window_group);
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._scrollContainer) return;

        const wrapper = new Clutter.Actor({ name: `paperflow-clone-${windowId}` });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        this._scrollContainer.add_child(wrapper);
        this._clones.set(windowId, { wrapper, clone });
    }

    removeClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry) return;
        entry.wrapper.destroy();
        this._clones.delete(windowId);
    }

    applyLayout(layout: LayoutState): void {
        for (const wl of layout.windows) {
            const entry = this._clones.get(wl.windowId);
            if (!entry) continue;
            entry.wrapper.set_position(wl.x, wl.y);
            entry.wrapper.set_size(wl.width, wl.height);
            entry.clone.set_size(wl.width, wl.height);
            entry.wrapper.visible = wl.visible;
        }
    }

    destroy(): void {
        this._clones.clear();
        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
            this._scrollContainer = null;
        }
    }
}
