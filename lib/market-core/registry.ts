/**
 * Component registries — the single place new indicators/overlays are added.
 *
 * A registration declares identity, version, inputs, outputs, rendering
 * placement and documentation. Duplicate ids are rejected loudly: two
 * implementations of the same id is exactly the "duplicated business logic"
 * this phase exists to prevent.
 */

import type { IndicatorDefinition, OverlayDefinition } from "./types";

export class Registry<T extends { id: string; version: string }> {
    private readonly entries = new Map<string, T>();

    constructor(private readonly label: string) {}

    /** Register a component. Throws on duplicate id (any version). */
    register(definition: T): T {
        if (this.entries.has(definition.id)) {
            const existing = this.entries.get(definition.id)!;
            throw new Error(
                `[market-core] ${this.label}: "${definition.id}" is already registered ` +
                    `(existing version ${existing.version}, incoming ${definition.version}). ` +
                    `Bump the existing version instead of registering a second implementation.`,
            );
        }
        this.entries.set(definition.id, definition);
        return definition;
    }

    get(id: string): T | undefined {
        return this.entries.get(id);
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    list(): T[] {
        return Array.from(this.entries.values());
    }

    ids(): string[] {
        return Array.from(this.entries.keys());
    }

    /** Remove by id — used only by tests/unmount cleanup. */
    unregister(id: string): boolean {
        return this.entries.delete(id);
    }
}

/** The canonical indicator registry (calculation + declaration, no rendering). */
export const indicatorRegistry = new Registry<IndicatorDefinition>("indicatorRegistry");

/** The canonical overlay registry (market-coordinate producers). */
export const overlayRegistry = new Registry<OverlayDefinition>("overlayRegistry");
