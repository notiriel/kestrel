"""PaperFlow workspace switcher for ULauncher."""

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

_bus = None


def get_bus():
    """Get or create a cached DBus session connection."""
    global _bus
    if _bus is None:
        _bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    return _bus


def gnome_eval(expr: str) -> str:
    """Run a JS expression via GNOME Shell DBus Eval (no subprocess)."""
    try:
        bus = get_bus()
        result = bus.call_sync(
            'org.gnome.Shell',
            '/org/gnome/Shell',
            'org.gnome.Shell',
            'Eval',
            GLib.Variant('(s)', (expr,)),
            GLib.VariantType('(bs)'),
            Gio.DBusCallFlags.NONE,
            2000,  # 2 second timeout in ms
            None,
        )
        success = result.get_child_value(0).get_boolean()
        if success:
            return result.get_child_value(1).get_string()
        return ""
    except Exception as e:
        logger.warning("gnome_eval failed: %s", e)
        _bus = None  # Reset connection on error
        return ""


class PaperFlowExtension(Extension):
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
            escaped = name.replace("\\", "\\\\").replace("'", "\\'")
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.svg",
                    name=f'Rename workspace to "{name}"',
                    description="Rename the current PaperFlow workspace",
                    on_enter=RunScriptAction(
                        f"gdbus call --session --dest org.gnome.Shell "
                        f"--object-path /org/gnome/Shell "
                        f"--method org.gnome.Shell.Eval "
                        f"\"global._paperflow.renameCurrentWorkspace('{escaped}')\"",
                    ),
                )
            ])

        # Mode 2: ws <query> — list and filter workspaces
        workspaces_json = gnome_eval("global._paperflow.listWorkspaces()")
        if not workspaces_json:
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.svg",
                    name="PaperFlow not available",
                    description="Extension may not be running",
                    on_enter=DoNothingAction(),
                )
            ])

        try:
            # GNOME Shell Eval applies JSON.stringify on the return value,
            # and listWorkspaces() also JSON.stringify's — so we get a
            # double-encoded JSON string. Unwrap both layers.
            parsed = json.loads(workspaces_json)
            workspaces = json.loads(parsed) if isinstance(parsed, str) else parsed
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

            escaped_name = name.replace("\\", "\\\\").replace("'", "\\'")
            items.append(ExtensionResultItem(
                icon="images/icon.svg",
                name=f"{name}{current} {status_icon}",
                description=f"{win_count} window{'s' if win_count != 1 else ''}",
                on_enter=RunScriptAction(
                    f"gdbus call --session --dest org.gnome.Shell "
                    f"--object-path /org/gnome/Shell "
                    f"--method org.gnome.Shell.Eval "
                    f"\"global._paperflow.switchToWorkspaceByName('{escaped_name}')\"",
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
    PaperFlowExtension().run()
