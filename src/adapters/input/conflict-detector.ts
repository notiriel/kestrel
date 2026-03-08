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

export class ConflictDetector {
    private _source: Source | null = null;
    private _signalId: number | null = null;
    private _notified = new Set<string>();

    detectConflicts(): void {
        this._checkAll();
        this._watchExtensionChanges();
    }

    private _watchExtensionChanges(): void {
        try {
            this._signalId = Main.extensionManager.connect(
                'extension-state-changed',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (_mgr: any, ext: any): undefined => {
                    this._onExtensionStateChanged(ext);
                },
            );
        } catch (e) {
            console.error('[Kestrel] Failed to connect extension-state-changed:', e);
        }
    }

    private _onExtensionStateChanged(ext: { uuid?: string; metadata?: { uuid?: string }; state?: number }): void {
        try {
            const uuid = this._getExtensionUuid(ext);
            if (!uuid) return;
            if (ext.state === EXTENSION_STATE_ENABLED) {
                this._notifyConflict(uuid);
            }
        } catch (e) {
            console.error('[Kestrel] Error in extension-state-changed handler:', e);
        }
    }

    private _getExtensionUuid(ext: { uuid?: string; metadata?: { uuid?: string } }): string | null {
        const uuid = ext.uuid || ext.metadata?.uuid;
        return uuid && (CONFLICTING_EXTENSIONS as readonly string[]).includes(uuid) ? uuid : null;
    }

    private _checkAll(): void {
        for (const uuid of CONFLICTING_EXTENSIONS) {
            try {
                const ext = Main.extensionManager.lookup(uuid);
                if (ext && ext.state === EXTENSION_STATE_ENABLED) {
                    this._notifyConflict(uuid);
                }
            } catch (e) {
                console.error(`[Kestrel] Error checking extension ${uuid}:`, e);
            }
        }
    }

    private _notifyConflict(uuid: string): void {
        if (this._notified.has(uuid)) return;
        this._notified.add(uuid);

        try {
            this._source = new Source({ title: 'Kestrel', iconName: 'dialog-warning-symbolic' });
            Main.messageTray.add(this._source);

            const notification = new Notification({
                source: this._source,
                title: 'Kestrel: Extension Conflict',
                body: `"${uuid}" conflicts with Kestrel keybindings (Super+Arrow). Disable it for Kestrel to work correctly.`,
                isTransient: false,
            });

            notification.addAction('Disable ' + uuid, () => this._disableExtension(uuid));
            this._source.addNotification(notification);
        } catch (e) {
            console.error('[Kestrel] Failed to show conflict notification:', e);
        }
    }

    private _disableExtension(uuid: string): void {
        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

            const enabled = shellSettings.get_strv('enabled-extensions');
            if (enabled.includes(uuid)) {
                shellSettings.set_strv('enabled-extensions', enabled.filter(u => u !== uuid));
            }

            const disabled = shellSettings.get_strv('disabled-extensions');
            if (!disabled.includes(uuid)) {
                shellSettings.set_strv('disabled-extensions', [...disabled, uuid]);
            }

            console.log(`[Kestrel] Disabled conflicting extension: ${uuid}`);
        } catch (e) {
            console.error(`[Kestrel] Failed to disable ${uuid}:`, e);
        }
    }

    destroy(): void {
        if (this._signalId !== null) {
            try {
                Main.extensionManager.disconnect(this._signalId);
            } catch (e) {
                console.error('[Kestrel] Failed to disconnect extension-state-changed:', e);
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
