import type { ConflictDetectorPort } from '../ports/conflict-detector-port.js';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Source, Notification, NotificationDestroyedReason } from 'resource:///org/gnome/shell/ui/messageTray.js';

const CONFLICTING_EXTENSIONS = [
    'tiling-assistant@ubuntu.com',
    'ding@rastersoft.com',
    'ubuntu-dock@ubuntu.com',
] as const;

/** Extension state value for ENABLED in GNOME Shell */
const EXTENSION_STATE_ENABLED = 1;

export class ConflictDetector implements ConflictDetectorPort {
    private _source: Source | null = null;
    private _signalId: number | null = null;
    private _notified = new Set<string>();

    detectConflicts(): void {
        // Check immediately for already-enabled extensions
        this._checkAll();

        // Also listen for extensions that enable after us
        try {
            this._signalId = Main.extensionManager.connect(
                'extension-state-changed',
                (_mgr: any, ext: any): undefined => {
                    try {
                        const uuid = ext?.uuid ?? ext?.metadata?.uuid;
                        if (!uuid) return;
                        if (!(CONFLICTING_EXTENSIONS as readonly string[]).includes(uuid)) return;
                        if (ext.state === EXTENSION_STATE_ENABLED) {
                            console.log(`[PaperFlow] Conflicting extension became enabled: ${uuid}`);
                            this._notifyConflict(uuid);
                        }
                    } catch (e) {
                        console.error('[PaperFlow] Error in extension-state-changed handler:', e);
                    }
                },
            );
        } catch (e) {
            console.error('[PaperFlow] Failed to connect extension-state-changed:', e);
        }
    }

    private _checkAll(): void {
        for (const uuid of CONFLICTING_EXTENSIONS) {
            try {
                const ext = Main.extensionManager.lookup(uuid);
                console.log(`[PaperFlow] Conflict check: ${uuid} → state=${ext?.state ?? 'not found'}`);
                if (ext && ext.state === EXTENSION_STATE_ENABLED) {
                    console.log(`[PaperFlow] Conflicting extension detected: ${uuid}`);
                    this._notifyConflict(uuid);
                }
            } catch (e) {
                console.error(`[PaperFlow] Error checking extension ${uuid}:`, e);
            }
        }
    }

    private _notifyConflict(uuid: string): void {
        if (this._notified.has(uuid)) return;
        this._notified.add(uuid);

        try {
            this._source = new Source({
                title: 'PaperFlow',
                iconName: 'dialog-warning-symbolic',
            });
            Main.messageTray.add(this._source);

            const notification = new Notification({
                source: this._source,
                title: 'PaperFlow: Extension Conflict',
                body: `"${uuid}" conflicts with PaperFlow keybindings (Super+Arrow). ` +
                      `Disable it for PaperFlow to work correctly.`,
                isTransient: false,
            });

            notification.addAction('Disable ' + uuid, () => {
                try {
                    const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

                    // Remove from enabled-extensions (user-installed extensions)
                    const enabled = shellSettings.get_strv('enabled-extensions');
                    if (enabled.includes(uuid)) {
                        shellSettings.set_strv(
                            'enabled-extensions',
                            enabled.filter(u => u !== uuid),
                        );
                    }

                    // Add to disabled-extensions (needed for system/default extensions
                    // like Ubuntu's tiling-assistant that are enabled implicitly)
                    const disabled = shellSettings.get_strv('disabled-extensions');
                    if (!disabled.includes(uuid)) {
                        shellSettings.set_strv(
                            'disabled-extensions',
                            [...disabled, uuid],
                        );
                    }

                    console.log(`[PaperFlow] Disabled conflicting extension: ${uuid}`);
                } catch (e) {
                    console.error(`[PaperFlow] Failed to disable ${uuid}:`, e);
                }
            });

            this._source.addNotification(notification);
        } catch (e) {
            console.error('[PaperFlow] Failed to show conflict notification:', e);
        }
    }

    destroy(): void {
        if (this._signalId !== null) {
            try {
                Main.extensionManager.disconnect(this._signalId);
            } catch (e) {
                console.error('[PaperFlow] Failed to disconnect extension-state-changed:', e);
            }
            this._signalId = null;
        }
        if (this._source) {
            this._source.destroy(NotificationDestroyedReason.SOURCE_CLOSED);
            this._source = null;
        }
        this._notified.clear();
    }
}
