"""Kestrel workspace switcher for ULauncher."""

import json
import logging

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

from ulauncher.api.client.Extension import Extension
from ulauncher.api.client.EventListener import EventListener
from ulauncher.api.shared.event import KeywordQueryEvent
from ulauncher.api.shared.item.ExtensionResultItem import ExtensionResultItem
from ulauncher.api.shared.action.RenderResultListAction import RenderResultListAction
from ulauncher.api.shared.action.RunScriptAction import RunScriptAction
from ulauncher.api.shared.action.DoNothingAction import DoNothingAction

logger = logging.getLogger(__name__)

STATUS_ICONS = {
    "working": "\U0001f7e0",     # 🟠
    "needs-input": "\U0001f534",  # 🔴
    "done": "\U0001f7e2",        # 🟢
}

DBUS_NAME = 'org.gnome.Shell'
DBUS_PATH = '/io/kestrel/Extension'
DBUS_IFACE = 'io.kestrel.Extension'

_bus = None


def get_bus():
    """Get or create a cached DBus session connection."""
    global _bus
    if _bus is None:
        _bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    return _bus


def kestrel_call(method: str, *args) -> str:
    """Call a method on the Kestrel DBus interface."""
    try:
        bus = get_bus()
        # Build variant args
        if args:
            sig = '(' + 's' * len(args) + ')'
            params = GLib.Variant(sig, args)
        else:
            params = None
        result = bus.call_sync(
            DBUS_NAME,
            DBUS_PATH,
            DBUS_IFACE,
            method,
            params,
            GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE,
            2000,
            None,
        )
        return result.get_child_value(0).get_string()
    except Exception as e:
        logger.warning("kestrel_call(%s) failed: %s", method, e)
        global _bus
        _bus = None
        return ""


class KestrelExtension(Extension):
    def __init__(self):
        super().__init__()
        self.subscribe(KeywordQueryEvent, KeywordQueryEventListener())


class KeywordQueryEventListener(EventListener):
    def on_event(self, event, extension):
        query = (event.get_argument() or "").strip()

        # Mode 1: ws rename <name>
        if query.lower().startswith("rename "):
            name = query[7:].strip()
            if not name:
                return RenderResultListAction([
                    ExtensionResultItem(
                        icon="images/icon.svg",
                        name="Type a workspace name...",
                        on_enter=DoNothingAction(),
                    )
                ])
            escaped = name.replace("'", "'\\''")
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.svg",
                    name=f'Rename workspace to "{name}"',
                    description="Rename the current Kestrel workspace",
                    on_enter=RunScriptAction(
                        f"gdbus call --session --dest {DBUS_NAME} "
                        f"--object-path {DBUS_PATH} "
                        f"--method {DBUS_IFACE}.RenameCurrentWorkspace "
                        f"'{escaped}'",
                    ),
                )
            ])

        # Mode 2: ws <query> — list and filter workspaces
        workspaces_json = kestrel_call("ListWorkspaces")
        if not workspaces_json:
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.svg",
                    name="Kestrel not available",
                    description="Extension may not be running",
                    on_enter=DoNothingAction(),
                )
            ])

        try:
            workspaces = json.loads(workspaces_json)
        except (json.JSONDecodeError, TypeError):
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.svg",
                    name="Error parsing workspace data",
                    on_enter=DoNothingAction(),
                )
            ])

        # Filter by query
        if query:
            q = query.lower()
            workspaces = [
                ws for ws in workspaces
                if q in (ws.get("name") or f"WS {ws['index'] + 1}").lower()
            ]

        items = []
        for ws in workspaces:
            name = ws.get("name") or f"WS {ws['index'] + 1}"
            current = " (current)" if ws.get("isCurrent") else ""
            status = ws.get("claudeStatus")
            status_icon = STATUS_ICONS.get(status, "") if status else ""
            win_count = ws.get("windowCount", 0)

            escaped_name = name.replace("'", "'\\''")
            items.append(ExtensionResultItem(
                icon="images/icon.svg",
                name=f"{name}{current} {status_icon}",
                description=f"{win_count} window{'s' if win_count != 1 else ''}",
                on_enter=RunScriptAction(
                    f"gdbus call --session --dest {DBUS_NAME} "
                    f"--object-path {DBUS_PATH} "
                    f"--method {DBUS_IFACE}.SwitchToWorkspaceByName "
                    f"'{escaped_name}'",
                ),
            ))

        if not items:
            items.append(ExtensionResultItem(
                icon="images/icon.svg",
                name="No matching workspaces",
                description='Type "rename <name>" to name the current workspace',
                on_enter=DoNothingAction(),
            ))

        return RenderResultListAction(items)


if __name__ == "__main__":
    KestrelExtension().run()
