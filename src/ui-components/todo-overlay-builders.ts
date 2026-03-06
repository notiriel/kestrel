import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import { BORDER, TEXT_DIM, ACCENT } from './card-builders.js';

const SURFACE = '#0a0f0c';
const TEXT = '#e8ede9';
const SELECTED_BG = 'rgba(98,175,133,0.10)';
const DELETE_BG = 'rgba(201,90,90,0.15)';

export interface TodoDisplayItem {
    readonly uuid: string;
    readonly text: string;
    readonly completed: boolean;
    readonly fadingOut: boolean;
    readonly number: number;
}

export interface TodoOverlayConfig {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly workspaceName: string | null;
    readonly items: readonly TodoDisplayItem[];
    readonly selectedIndex: number;
    readonly mode: 'navigation' | 'editing' | 'confirm-delete';
    readonly editText: string;
    readonly editingIndex: number;
}

export function buildTodoBackdrop(
    monitorWidth: number,
    monitorHeight: number,
    monitorX: number,
    monitorY: number,
): St.Widget {
    return new St.Widget({
        style: 'background-color: rgba(0, 0, 0, 0.6);',
        reactive: true,
        width: monitorWidth,
        height: monitorHeight,
        x: monitorX,
        y: monitorY,
    });
}

interface TodoCardResult {
    readonly card: St.BoxLayout;
    readonly entry: St.Entry | null;
}

export function buildTodoCard(config: TodoOverlayConfig): TodoCardResult {
    const card = new St.BoxLayout({
        vertical: true,
        style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 16px; padding: 20px 24px;`,
        reactive: true,
        width: config.width,
        height: config.height,
    });

    const { scrollView, entry } = buildItemsScrollView(config);
    card.add_child(buildHeader(config.workspaceName));
    card.add_child(scrollView);
    card.add_child(buildHint(config));

    return { card, entry };
}

function buildHeader(workspaceName: string | null): St.BoxLayout {
    const header = new St.BoxLayout({
        style: 'spacing: 8px; margin-bottom: 12px;',
        x_expand: true,
    });

    header.add_child(new St.Label({
        text: 'TODOS',
        style: `font-size: 16px; font-weight: bold; color: ${TEXT};`,
    }));

    if (workspaceName) {
        header.add_child(new St.Label({
            text: `\u2014 ${workspaceName}`,
            style: `font-size: 14px; color: ${TEXT_DIM};`,
        }));
    }

    return header;
}

interface ItemsScrollResult {
    readonly scrollView: St.ScrollView;
    readonly entry: St.Entry | null;
}

function buildItemsScrollView(config: TodoOverlayConfig): ItemsScrollResult {
    const scrollView = new St.ScrollView({
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
    });

    const { list, entry } = buildItemsList(config);
    scrollView.set_child(list);
    return { scrollView, entry };
}

function buildItemsList(config: TodoOverlayConfig): { list: St.BoxLayout; entry: St.Entry | null } {
    const list = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 2px;' });
    let entry: St.Entry | null = null;

    for (const [i, item] of config.items.entries()) {
        const isSelected = i === config.selectedIndex;
        const isEditing = config.mode === 'editing' && config.editingIndex === i;
        const result = buildTaskRow(item, isSelected, isEditing, config.mode === 'confirm-delete' && isSelected, config.editText);
        list.add_child(result.row);
        if (result.entry) entry = result.entry;
    }

    if (config.mode === 'editing' && config.editingIndex === -1) {
        const result = buildNewItemRow(config.items.length + 1, config.editText);
        list.add_child(result.row);
        entry = result.entry;
    } else if (config.items.length === 0) {
        list.add_child(new St.Label({
            text: 'No tasks yet. Press [n] to create one.',
            style: `font-size: 13px; color: ${TEXT_DIM}; padding: 20px 0;`,
            x_align: Clutter.ActorAlign.CENTER,
        }));
    }

    return { list, entry };
}

interface TaskRowResult {
    readonly row: St.BoxLayout;
    readonly entry: St.Entry | null;
}

function buildTaskRow(
    item: TodoDisplayItem,
    isSelected: boolean,
    isEditing: boolean,
    isDeleting: boolean,
    editText: string,
): TaskRowResult {
    let bg = 'transparent';
    if (isDeleting) bg = DELETE_BG;
    else if (isSelected) bg = SELECTED_BG;

    const opacity = item.fadingOut ? 128 : 255;
    const row = new St.BoxLayout({
        style: `spacing: 8px; padding: 6px 10px; border-radius: 8px; background-color: ${bg};`,
        x_expand: true,
        opacity,
    });

    // Checkbox
    const checkbox = item.completed ? '\u2611' : '\u2610';
    row.add_child(new St.Label({
        text: checkbox,
        style: `font-size: 14px; color: ${ACCENT}; min-width: 20px;`,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    // Number
    row.add_child(new St.Label({
        text: `${item.number}.`,
        style: `font-size: 12px; color: ${TEXT_DIM}; min-width: 24px;`,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    // Text or entry
    let entry: St.Entry | null = null;
    if (isEditing) {
        entry = new St.Entry({
            text: editText,
            style: `font-size: 13px; color: ${TEXT}; background-color: rgba(255,255,255,0.05); border: 1px solid ${ACCENT}; border-radius: 4px; padding: 4px 8px;`,
            x_expand: true,
            can_focus: true,
        });
        row.add_child(entry);
    } else {
        const label = new St.Label({
            style: `font-size: 13px; color: ${item.completed ? TEXT_DIM : TEXT};`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (item.completed) {
            label.clutter_text.set_markup(`<s>${escapeMarkup(item.text)}</s>`);
        } else {
            label.text = item.text;
        }
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(label);
    }

    return { row, entry };
}

interface NewItemRowResult {
    readonly row: St.BoxLayout;
    readonly entry: St.Entry;
}

function buildNewItemRow(number: number, editText: string): NewItemRowResult {
    const row = new St.BoxLayout({
        style: `spacing: 8px; padding: 6px 10px; border-radius: 8px; background-color: ${SELECTED_BG};`,
        x_expand: true,
    });
    row.add_child(new St.Label({
        text: '\u2610',
        style: `font-size: 14px; color: ${ACCENT}; min-width: 20px;`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({
        text: `${number}.`,
        style: `font-size: 12px; color: ${TEXT_DIM}; min-width: 24px;`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    const entry = new St.Entry({
        text: editText,
        style: `font-size: 13px; color: ${TEXT}; background-color: rgba(255,255,255,0.05); border: 1px solid ${ACCENT}; border-radius: 4px; padding: 4px 8px;`,
        x_expand: true,
        can_focus: true,
    });
    row.add_child(entry);
    return { row, entry };
}

function buildHint(config: TodoOverlayConfig): St.Label {
    let text: string;
    if (config.mode === 'confirm-delete') {
        text = 'Delete? [Enter] confirm  [Escape] cancel';
    } else if (config.mode === 'editing') {
        text = '[Enter] confirm  [Escape] cancel';
    } else {
        text = '[n] create  [Space] toggle  [F2] edit  [Del] delete  [Esc] close';
    }
    return new St.Label({
        text,
        style: `font-size: 11px; color: ${TEXT_DIM}; margin-top: 12px;`,
        x_align: Clutter.ActorAlign.CENTER,
    });
}

function escapeMarkup(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const ANIMATION_DURATION = 200;

export function animateTodoIn(backdrop: St.Widget): void {
    backdrop.opacity = 0;
    backdrop.visible = true;
    (backdrop as unknown as { ease(p: Record<string, unknown>): void }).ease({
        opacity: 255,
        duration: ANIMATION_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

export function animateTodoOut(backdrop: St.Widget, onComplete: () => void): void {
    (backdrop as unknown as { ease(p: Record<string, unknown>): void }).ease({
        opacity: 0,
        duration: ANIMATION_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete,
    });
}
