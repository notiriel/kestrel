import type { ConflictDetectorPort } from './conflict-detector-port.js';
import type { MonitorPort } from './monitor-port.js';
import type { ClonePort } from './clone-port.js';
import type { WindowPort } from './window-port.js';
import type { FocusPort } from './focus-port.js';
import type { ShellPort } from './shell-port.js';
import type { KeybindingPort } from './keybinding-port.js';
import type { WindowEventPort } from './window-event-port.js';
import type { StatePersistencePort } from './state-persistence-port.js';

export interface ControllerPorts {
    conflictDetector: ConflictDetectorPort;
    monitor: MonitorPort;
    clone: ClonePort;
    window: WindowPort;
    focus: FocusPort;
    shell: ShellPort;
    keybinding: KeybindingPort;
    windowEvent: WindowEventPort;
    statePersistence: StatePersistencePort;
}
