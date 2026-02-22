import type { KestrelConfig, MonitorInfo } from '../domain/types.js';
import type { World } from '../domain/world.js';

export interface StatePersistencePort {
    readConfig(): KestrelConfig;
    save(world: World): void;
    tryRestore(config: KestrelConfig, monitor: MonitorInfo): World | null;
}
