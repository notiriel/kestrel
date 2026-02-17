# PaperFlow Claude Code Plugin

Claude Code plugin for PaperFlow GNOME Shell extension development.

## What's Included

### Agent: dbus-manual-tester

Manual QA agent that tests the live PaperFlow extension through GNOME Shell's DBus eval interface. Executes test cases against the running extension, inspects domain state via `global._paperflow`, and reports structured pass/fail results.

### Agent: paperwm-expert

Source code analyst for the PaperWM extension (located at `~/development/PaperWM`). Answers questions about PaperWM's architecture, signal handling, window management, and implementation details by reading the actual source code.

## Installation

```bash
claude --plugin-dir ./paperflow-plugin
```

Or use the `/plugin install` command from within Claude Code.
