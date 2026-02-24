import Gio from 'gi://Gio';

const INTERFACE_XML = `
<node>
  <interface name="io.kestrel.Extension">
    <method name="HandleNotification">
      <arg name="payload"  direction="in"  type="s"/>
      <arg name="response" direction="out" type="s"/>
    </method>
    <method name="HandlePermission">
      <arg name="payload"  direction="in"  type="s"/>
      <arg name="response" direction="out" type="s"/>
    </method>
    <method name="SetWindowStatus">
      <arg name="sessionId" direction="in" type="s"/>
      <arg name="status"    direction="in" type="s"/>
    </method>
    <method name="GetNotificationResponse">
      <arg name="id"       direction="in"  type="s"/>
      <arg name="response" direction="out" type="s"/>
    </method>
    <method name="ListWorkspaces">
      <arg name="response" direction="out" type="s"/>
    </method>
    <method name="SwitchToWorkspaceByName">
      <arg name="name"     direction="in"  type="s"/>
      <arg name="response" direction="out" type="s"/>
    </method>
    <method name="RenameCurrentWorkspace">
      <arg name="name"     direction="in"  type="s"/>
      <arg name="response" direction="out" type="s"/>
    </method>
  </interface>
</node>`;

const OBJECT_PATH = '/io/kestrel/Extension';

export interface KestrelDBusCallbacks {
    handleNotification(payload: string): string;
    handlePermissionRequest(payload: string): string;
    setWindowStatus(sessionId: string, status: string): void;
    getNotificationResponse(id: string): string;
    listWorkspaces(): string;
    switchToWorkspaceByName(name: string): string;
    renameCurrentWorkspace(name: string): string;
}

export class KestrelDBusService {
    private _dbus: Gio.DBusExportedObject | null = null;

    constructor(callbacks: KestrelDBusCallbacks) {
        const handler = {
            HandleNotification(payload: string): string {
                try {
                    return callbacks.handleNotification(payload);
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
            HandlePermission(payload: string): string {
                try {
                    return callbacks.handlePermissionRequest(payload);
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
            SetWindowStatus(sessionId: string, status: string): void {
                try {
                    callbacks.setWindowStatus(sessionId, status);
                } catch (e) {
                    console.error('[Kestrel] DBus SetWindowStatus error:', e);
                }
            },
            GetNotificationResponse(id: string): string {
                try {
                    return callbacks.getNotificationResponse(id);
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
            ListWorkspaces(): string {
                try {
                    return callbacks.listWorkspaces();
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
            SwitchToWorkspaceByName(name: string): string {
                try {
                    return callbacks.switchToWorkspaceByName(name);
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
            RenameCurrentWorkspace(name: string): string {
                try {
                    return callbacks.renameCurrentWorkspace(name);
                } catch (e) {
                    return JSON.stringify({ error: String(e) });
                }
            },
        };

        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, handler);
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    destroy(): void {
        if (this._dbus) {
            try {
                this._dbus.unexport();
            } catch (e) {
                console.error('[Kestrel] Error unexporting DBus service:', e);
            }
            this._dbus = null;
        }
    }
}
