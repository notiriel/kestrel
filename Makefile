UUID = paperflow@paperflow.github.com
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

build:
	npx tsc

test:
	npx vitest run

install: build
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)/schemas
	cp -r dist/* $(INSTALL_DIR)/
	cp src/metadata.json $(INSTALL_DIR)/
	cp src/stylesheet.css $(INSTALL_DIR)/
	cp schemas/*.xml $(INSTALL_DIR)/schemas/
	glib-compile-schemas $(INSTALL_DIR)/schemas/

dev: install
	@echo "Restart GNOME Shell to load changes"
	@echo "  Wayland: log out and back in"

.PHONY: build test install dev
