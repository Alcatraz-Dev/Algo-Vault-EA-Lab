"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(callback: () => void) {
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
    });
    return () => observer.disconnect();
}

export function isDarkMode(): boolean {
    return !document.documentElement.classList.contains("light");
}

/**
 * ThemeToggle — theme switch.
 * `compact` renders the header-chip variant (icon only, same size/surface as the
 * other topbar controls) so the app shell stays consistent on narrow screens.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
    const dark = useSyncExternalStore<boolean>(
        subscribe,
        isDarkMode,
        () => true
    );

    const label = dark ? "Switch to light theme" : "Switch to dark theme";

    const toggle = () => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        document.documentElement.classList.toggle("light", !next);
        try {
            const mode = next ? "dark" : "light";
            localStorage.setItem("algovault-theme", mode);
            localStorage.setItem("theme", mode);
        } catch {
            /* no-op */
        }
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={label}
            title={compact ? label : undefined}
            className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                compact
                    ? "h-10 w-10 shrink-0 justify-center rounded-button border border-border bg-card hover:bg-muted sm:h-9 sm:w-9"
                    : "h-8 rounded-full border border-border bg-card px-2.5 hover:border-primary/50"
            )}
        >
            {dark ? <Sun size={compact ? 16 : 14} /> : <Moon size={compact ? 16 : 14} />}
            {compact ? null : <span>{dark ? "Light" : "Dark"}</span>}
        </button>
    );
}
