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
    return document.documentElement.classList.contains("dark");
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
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:text-foreground"
        >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
    );
}