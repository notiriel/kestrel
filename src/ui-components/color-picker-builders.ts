import St from 'gi://St';
import Clutter from 'gi://Clutter';
import type { WorkspaceColorId } from '../domain/types.js';
import { WORKSPACE_COLORS } from '../domain/types.js';

const SWATCH_SIZE = 24;
const SELECTED_BORDER = 'border: 2px solid white;';
const DEFAULT_BORDER = 'border: 2px solid transparent;';

/** Build a horizontal row of circular color swatches for the overview color picker. */
export function buildColorPicker(
    currentId: WorkspaceColorId,
    onSelect: (color: WorkspaceColorId) => void,
): St.BoxLayout {
    const row = new St.BoxLayout({
        name: 'kestrel-color-picker',
        style: 'background-color: rgba(0,0,0,0.9); border-radius: 16px; padding: 8px 12px; spacing: 8px;',
        reactive: true,
    });

    for (const entry of WORKSPACE_COLORS) {
        const isSelected = entry.id === currentId;
        // For default (null), show a grey swatch with a slash-through appearance
        const bgColor = entry.id === null ? '#555555' : entry.solid.slice(0, 7);
        const borderStyle = isSelected ? SELECTED_BORDER : DEFAULT_BORDER;

        const swatch = new St.Button({
            style: `${borderStyle} border-radius: ${SWATCH_SIZE / 2}px; background-color: ${bgColor}; min-width: ${SWATCH_SIZE}px; min-height: ${SWATCH_SIZE}px; max-width: ${SWATCH_SIZE}px; max-height: ${SWATCH_SIZE}px;`,
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        swatch.connect('clicked', () => {
            try { onSelect(entry.id); } catch (e) { console.error('[Kestrel] Error in color picker click:', e); }
        });

        row.add_child(swatch);
    }

    // Consume clicks so they don't fall through to overview hit-test
    row.connect('button-press-event', () => Clutter.EVENT_STOP);

    return row;
}
