import type { WorkspaceId } from '../domain/types.js';
import type { TodoItem } from '../domain/todo.js';

export interface TodoPersistencePort {
    loadItems(wsId: WorkspaceId): readonly TodoItem[];
    saveItems(wsId: WorkspaceId, items: readonly TodoItem[]): void;
}
