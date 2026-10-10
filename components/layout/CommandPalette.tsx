"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CornerDownLeft, ArrowUp, ArrowDown, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup, NavItem } from "@/components/layout/AppShell";

type CommandItem = {
    id: string;
    label: string;
    group: string;
    href: string;
    icon: NavItem["icon"];
    pro?: boolean;
};

/**
 * CommandPalette — the global ⌘K / Ctrl-K navigation surface.
 *
 * Keyboard-first: type to filter across every navigation group, ↑/↓ to move,
 * Enter to open, Esc to dismiss. Purely additive navigation chrome — it never
 * performs an action the sidebar could not already perform.
 *
 * The list state lives in a child that only exists while the dialog is open, so
 * every open starts from a clean query without a state-syncing effect.
 */
export function CommandPalette({
    open,
    onOpenChange,
    groups,
    role = "app",
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    groups: NavGroup[];
    role?: "app" | "account" | "admin";
}) {
    // Global hotkey.
    useEffect(() => {
        const handler = (event: globalThis.KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                onOpenChange(!open);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, onOpenChange]);

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/80" />
                <DialogPrimitive.Popup
                    className="fixed left-1/2 top-[12%] z-50 flex max-h-[min(70vh,32rem)] w-[min(92vw,44rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none"
                    aria-label="Command palette"
                >
                    <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
                    <CommandList
                        groups={groups}
                        role={role}
                        open={open}
                        onSelect={() => onOpenChange(false)}
                        onClose={() => onOpenChange(false)}
                    />
                </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

function CommandList({
    groups,
    role,
    open,
    onSelect,
    onClose,
}: {
    groups: NavGroup[];
    role: "app" | "account" | "admin";
    open: boolean;
    onSelect: () => void;
    onClose: () => void;
}) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [prevOpen, setPrevOpen] = useState(open);
    const listRef = useRef<HTMLUListElement | null>(null);

    // The popup stays mounted between openings; reset the search whenever it
    // transitions to open. Adjusting state during render (rather than in an
    // effect) is the supported pattern for reacting to a prop change.
    if (open !== prevOpen) {
        setPrevOpen(open);
        if (open) {
            setQuery("");
            setActiveIndex(0);
        }
    }

    const items = useMemo<CommandItem[]>(() => {
        const all: CommandItem[] = [];
        for (const group of groups) {
            for (const item of group.items) {
                all.push({
                    id: `${group.label}:${item.href}:${item.label}`,
                    label: item.label,
                    group: group.label,
                    href: item.href,
                    icon: item.icon,
                    pro: item.pro,
                });
            }
        }
        return all;
    }, [groups]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (item) =>
                item.label.toLowerCase().includes(q) ||
                item.group.toLowerCase().includes(q) ||
                item.href.toLowerCase().includes(q)
        );
    }, [items, query]);

    const grouped = useMemo(() => {
        const map = new Map<string, { item: CommandItem; index: number }[]>();
        filtered.forEach((item, index) => {
            const list = map.get(item.group) ?? [];
            list.push({ item, index });
            map.set(item.group, list);
        });
        return Array.from(map.entries());
    }, [filtered]);

    // Clamp rather than store: the result set shrinks as the user types.
    const safeIndex = filtered.length ? Math.min(activeIndex, filtered.length - 1) : 0;

    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [safeIndex]);

    const select = (item: CommandItem | undefined) => {
        if (!item) return;
        onSelect();
        router.push(item.href);
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            select(filtered[safeIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    };

    return (
        <>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Command size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveIndex(0);
                    }}
                    onKeyDown={onKeyDown}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="command-list"
                    aria-activedescendant={filtered[safeIndex] ? `command-item-${safeIndex}` : undefined}
                    aria-autocomplete="list"
                    placeholder="Search pages, tools and settings…"
                    className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground sm:block">
                    Esc
                </kbd>
            </div>

            {filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No destinations match “{query.trim()}”.
                </p>
            ) : (
                <ul
                    ref={listRef}
                    id="command-list"
                    role="listbox"
                    aria-label="Destinations"
                    className="flex-1 overflow-y-auto p-2"
                >
                    {grouped.map(([group, entries]) => (
                        <li key={group} className="mb-1 last:mb-0">
                            <p className="px-2 py-1.5 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                                {group}
                            </p>
                            <ul>
                                {entries.map(({ item, index }) => {
                                    const Icon = item.icon;
                                    const active = index === safeIndex;
                                    return (
                                        <li key={item.id}>
                                            <button
                                                type="button"
                                                id={`command-item-${index}`}
                                                data-index={index}
                                                role="option"
                                                aria-selected={active}
                                                onMouseEnter={() => setActiveIndex(index)}
                                                onClick={() => select(item)}
                                                className={cn(
                                                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                                                    active
                                                        ? "bg-muted text-foreground"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                )}
                                            >
                                                <Icon size={16} className="shrink-0" aria-hidden="true" />
                                                <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                                                {item.pro ? (
                                                    <span className="inline-flex h-4 items-center rounded border border-primary/30 bg-primary/10 px-1 text-micro font-semibold uppercase tracking-wide text-primary">
                                                        Pro
                                                    </span>
                                                ) : null}
                                                <span className="hidden shrink-0 truncate text-micro text-muted-foreground sm:block">
                                                    {item.href}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-micro text-muted-foreground">
                <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <ArrowUp size={12} aria-hidden="true" />
                        <ArrowDown size={12} aria-hidden="true" />
                        Navigate
                    </span>
                    <span className="flex items-center gap-1">
                        <CornerDownLeft size={12} aria-hidden="true" />
                        Open
                    </span>
                </span>
                <span className="hidden sm:block">
                    {role === "admin" ? "Admin" : role === "account" ? "Account" : "AlgoVault"} · {items.length} destinations
                </span>
            </div>
        </>
    );
}
