"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

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

export default function ThemeToggle() {
    const dark = useSyncExternalStore<boolean>(
        subscribe,
        isDarkMode,
        () => true
    );

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
            aria-label="Toggle color theme"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            <span>{dark ? "Light" : "Dark"}</span>
        </button>
    );
}