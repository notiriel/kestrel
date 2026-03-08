import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { WorkspaceId } from '../../domain/world/types.js';
import type { TodoItem } from '../../domain/world/todo.js';
import { todosFilePath, todosDir } from '../../domain/world/todo.js';

export class TodoPersistenceAdapter {
    loadItems(wsId: WorkspaceId): readonly TodoItem[] {
        try {
            const filePath = todosFilePath(GLib.get_home_dir(), wsId);
            const file = Gio.File.new_for_path(filePath);
            if (!file.query_exists(null)) return [];
            const [, contents] = file.load_contents(null);
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (e) {
            console.error('[Kestrel] Error loading todos:', e);
            return [];
        }
    }

    saveItems(wsId: WorkspaceId, items: readonly TodoItem[]): void {
        try {
            const homeDir = GLib.get_home_dir();
            const dir = Gio.File.new_for_path(todosDir(homeDir, wsId));
            if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
            const json = JSON.stringify(items, null, 2);
            const file = Gio.File.new_for_path(todosFilePath(homeDir, wsId));
            file.replace_contents(new TextEncoder().encode(json), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error('[Kestrel] Error saving todos:', e);
        }
    }
}
