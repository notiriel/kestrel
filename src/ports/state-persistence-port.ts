import type { PaperFlowConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';

export interface StatePersistencePort {
    readConfig(): PaperFlowConfig;
    save(world: World): void;
    tryRestore(config: PaperFlowConfig, monitor: MonitorInfo): World | null;
}
