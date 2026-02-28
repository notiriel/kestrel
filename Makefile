UUID = kestrel@kestrel.github.com
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
PLUGIN_DIR = $(HOME)/.claude/plugins/kestrel
PLUGIN_CACHE_DIR = $(HOME)/.claude/plugins/cache/kestrel-local/kestrel/1.0.0
ULAUNCHER_DIR = $(HOME)/.local/share/ulauncher/extensions/kestrel-workspaces
SETTINGS_JSON = $(HOME)/.claude/settings.json
CURDIR_ABS = $(shell pwd)

# Extensions that Kestrel's conflict-detector disables at runtime
CONFLICTING_EXTS = tiling-assistant@ubuntu.com ding@rastersoft.com ubuntu-dock@ubuntu.com

build:
	npx tsc

test:
	npx vitest run --coverage

coverage:
	npx vitest run --coverage --coverage.include='src/**/*.ts' --coverage.exclude='src/ambient.d.ts' --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0

lint:
	npx eslint src/ test/
	npx knip

# ── Install everything ──────────────────────────────────────────────
install: build test lint
	# GNOME extension
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)/schemas
	cp -r dist/* $(INSTALL_DIR)/
	cp src/metadata.json $(INSTALL_DIR)/
	cp src/stylesheet.css $(INSTALL_DIR)/
	cp -r data $(INSTALL_DIR)/
	cp schemas/*.xml $(INSTALL_DIR)/schemas/
	glib-compile-schemas $(INSTALL_DIR)/schemas/
	# Claude Code plugin — symlink + copy hooks to cache
	ln -sfn $(CURDIR_ABS)/kestrel-plugin $(PLUGIN_DIR)
	mkdir -p $(PLUGIN_CACHE_DIR)/hooks
	chmod +x kestrel-plugin/hooks/*.sh
	cp kestrel-plugin/hooks/* $(PLUGIN_CACHE_DIR)/hooks/
	chmod +x $(PLUGIN_CACHE_DIR)/hooks/*.sh
	# Ulauncher extension — symlink
	mkdir -p $(dir $(ULAUNCHER_DIR))
	ln -sfn $(CURDIR_ABS)/ulauncher-kestrel $(ULAUNCHER_DIR)
	@echo ""
	@echo "Installed. Run 'make enable' to activate, then restart your session."

# ── Enable Kestrel ────────────────────────────────────────────────
enable:
	# Enable GNOME extension
	gnome-extensions enable $(UUID)
	gsettings set org.gnome.shell disable-user-extensions false
	# Disable conflicting GNOME extensions
	@for ext in $(CONFLICTING_EXTS); do \
		current=$$(gsettings get org.gnome.shell enabled-extensions); \
		if echo "$$current" | grep -q "$$ext"; then \
			gsettings set org.gnome.shell enabled-extensions "$$(echo $$current | sed "s/'$$ext'//" | sed "s/, ,/,/" | sed "s/\[, /[/" | sed "s/, \]/]/")" 2>/dev/null || true; \
		fi; \
		disabled=$$(gsettings get org.gnome.shell disabled-extensions); \
		if ! echo "$$disabled" | grep -q "$$ext"; then \
			gnome-extensions disable $$ext 2>/dev/null || true; \
		fi; \
	done
	# Enable Claude Code plugin
	@if [ -f $(SETTINGS_JSON) ]; then \
		jq '.enabledPlugins["kestrel@kestrel-local"] = true' $(SETTINGS_JSON) > $(SETTINGS_JSON).tmp \
		&& mv $(SETTINGS_JSON).tmp $(SETTINGS_JSON); \
	fi
	# Clean stale hooks from settings.json (plugin handles these now)
	@if [ -f $(SETTINGS_JSON) ]; then \
		jq 'del(.hooks.Stop, .hooks.SessionEnd)' $(SETTINGS_JSON) > $(SETTINGS_JSON).tmp \
		&& mv $(SETTINGS_JSON).tmp $(SETTINGS_JSON); \
		echo "Cleaned stale hooks from settings.json"; \
	fi
	@echo ""
	@echo "Kestrel enabled. Restart your session for changes to take effect."

# ── Disable Kestrel ───────────────────────────────────────────────
disable:
	# Disable GNOME extension
	gnome-extensions disable $(UUID) 2>/dev/null || true
	# Re-enable conflicting GNOME extensions
	@for ext in $(CONFLICTING_EXTS); do \
		if gnome-extensions info $$ext >/dev/null 2>&1; then \
			gnome-extensions enable $$ext 2>/dev/null || true; \
			echo "Re-enabled $$ext"; \
		fi; \
	done
	# Restore GNOME keybindings to defaults
	gsettings reset org.gnome.mutter overlay-key
	gsettings reset org.gnome.mutter.keybindings toggle-tiled-left
	gsettings reset org.gnome.mutter.keybindings toggle-tiled-right
	gsettings reset org.gnome.shell.keybindings toggle-message-tray
	gsettings reset org.gnome.desktop.wm.keybindings switch-applications
	gsettings reset org.gnome.desktop.wm.keybindings switch-applications-backward
	gsettings reset org.gnome.desktop.wm.keybindings maximize
	gsettings reset org.gnome.desktop.wm.keybindings unmaximize
	gsettings reset org.gnome.desktop.wm.keybindings move-to-monitor-left
	gsettings reset org.gnome.desktop.wm.keybindings move-to-monitor-right
	gsettings reset org.gnome.desktop.wm.keybindings move-to-monitor-up
	gsettings reset org.gnome.desktop.wm.keybindings move-to-monitor-down
	# Disable Claude Code plugin
	@if [ -f $(SETTINGS_JSON) ]; then \
		jq '.enabledPlugins["kestrel@kestrel-local"] = false' $(SETTINGS_JSON) > $(SETTINGS_JSON).tmp \
		&& mv $(SETTINGS_JSON).tmp $(SETTINGS_JSON); \
	fi
	@echo ""
	@echo "Kestrel disabled. Restart your session for changes to take effect."

# ── Show status ─────────────────────────────────────────────────────
status:
	@echo "── GNOME Extension ──"
	@gnome-extensions info $(UUID) 2>/dev/null | grep -E 'Enabled|State' || echo "  Not installed"
	@echo ""
	@echo "── User Extensions ──"
	@echo -n "  disable-user-extensions: "; gsettings get org.gnome.shell disable-user-extensions
	@echo ""
	@echo "── Conflicting Extensions ──"
	@for ext in $(CONFLICTING_EXTS); do \
		state=$$(gnome-extensions info $$ext 2>/dev/null | grep 'State:' | awk '{print $$2}'); \
		if [ -n "$$state" ]; then \
			echo "  $$ext: $$state"; \
		else \
			echo "  $$ext: not installed"; \
		fi; \
	done
	@echo ""
	@echo "── Claude Code Plugin ──"
	@if [ -L $(PLUGIN_DIR) ]; then \
		echo -n "  Symlink: "; readlink $(PLUGIN_DIR); \
		if [ -f $(SETTINGS_JSON) ]; then \
			echo -n "  Enabled: "; jq -r '.enabledPlugins["kestrel@kestrel-local"] // false' $(SETTINGS_JSON); \
		fi; \
	else \
		echo "  Not installed"; \
	fi
	@echo ""
	@echo "── Ulauncher Extension ──"
	@if [ -L $(ULAUNCHER_DIR) ]; then \
		echo -n "  Symlink: "; readlink $(ULAUNCHER_DIR); \
	else \
		echo "  Not installed"; \
	fi

dev: install enable
	@echo ""
	@echo "Restart GNOME Shell to load changes"
	@echo "  Wayland: log out and back in"

.PHONY: build test coverage lint install enable disable status dev

