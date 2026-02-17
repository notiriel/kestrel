export interface ShellPort {
    /** Dismiss the GNOME overview if it is currently visible. */
    hideOverview(): void;
    /** Intercept WM destroy/minimize/unminimize animations to skip them. */
    interceptWmAnimations(): void;
    destroy(): void;
}
