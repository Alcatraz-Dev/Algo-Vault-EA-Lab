/**
 * Bot Studio — state machine (lifecycle).
 *
 * Enforces which transitions are allowed. Any component that needs to change a
 * bot's state MUST call `validateTransition` first. Disallowed transitions
 * throw an explicit error — never silently succeed.
 *
 * State machine:
 *
 *   draft ──────────────────── validating ──► ready
 *                                                │
 *                                     ┌──────────┤
 *                                     │          ▼
 *                                 backtesting  starting
 *                                     │          │
 *                                     ▼          ▼
 *                                   ready     running ──► pausing ──► paused
 *                                                │              └────── ► stopping
 *                                                ▼
 *                                           stopping ──► stopped
 *                                                │
 *                                                ▼
 *                                           starting (restart)
 *
 *   any → error (terminal; requires manual reset to draft or stopped)
 */

import type { BotLifecycleState } from "./types";

/** All allowed transitions: from → Set<to>. */
const ALLOWED: Record<BotLifecycleState, Set<BotLifecycleState>> = {
    draft:       new Set(["validating", "error"]),
    validating:  new Set(["ready", "draft", "error"]),  // draft = validation failed, keep editing
    ready:       new Set(["validating", "backtesting", "starting", "paper", "error"]),
    backtesting: new Set(["ready", "error"]),
    paper:       new Set(["stopping", "ready", "error"]),
    starting:    new Set(["running", "stopped", "error"]),
    running:     new Set(["pausing", "stopping", "error"]),
    pausing:     new Set(["paused", "running", "error"]),
    paused:      new Set(["stopping", "starting", "error"]),
    stopping:    new Set(["stopped", "error"]),
    stopped:     new Set(["starting", "draft", "error"]),
    error:       new Set(["draft", "stopped"]),          // manual reset only
};

/** Human-readable description of each state. */
export const STATE_LABELS: Record<BotLifecycleState, string> = {
    draft:       "Draft",
    validating:  "Validating",
    ready:       "Ready",
    backtesting: "Backtesting",
    paper:       "Paper Trading",
    starting:    "Starting",
    running:     "Running",
    pausing:     "Pausing",
    paused:      "Paused",
    stopping:    "Stopping",
    stopped:     "Stopped",
    error:       "Error",
};

/** Returns true if the transition is allowed. */
export function canTransitionTo(
    current: BotLifecycleState,
    next: BotLifecycleState,
): boolean {
    return ALLOWED[current]?.has(next) ?? false;
}

/**
 * Validates a transition. Throws an explicit error if disallowed.
 * Call this before writing any state change to RTDB.
 */
export function validateTransition(
    botId: string,
    current: BotLifecycleState,
    next: BotLifecycleState,
): void {
    if (!canTransitionTo(current, next)) {
        throw new Error(
            `Bot ${botId}: invalid lifecycle transition ${current} → ${next}. ` +
            `Allowed from ${current}: [${[...(ALLOWED[current] ?? [])].join(", ")}].`
        );
    }
}

/**
 * Resolve the LEGAL path from `current` to `requested`.
 *
 * The UI speaks user intent ("start", "pause", "stop"), while the state
 * machine requires intermediate states (`ready → starting → running`,
 * `running → pausing → paused`). Callers must not bypass the machine, so the
 * route walks this path one validated step at a time and only then persists
 * the final state. Returns null when no path exists within `maxSteps`.
 */
export function transitionPath(
    current: BotLifecycleState,
    requested: BotLifecycleState,
    maxSteps = 3,
): BotLifecycleState[] | null {
    if (current === requested) return [];

    // Breadth-first search keeps the path shortest and deterministic.
    const queue: Array<{ state: BotLifecycleState; path: BotLifecycleState[] }> = [
        { state: current, path: [] },
    ];
    const seen = new Set<BotLifecycleState>([current]);

    while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.path.length >= maxSteps) continue;
        for (const next of ALLOWED[node.state] ?? []) {
            if (seen.has(next)) continue;
            const path = [...node.path, next];
            if (next === requested) return path;
            seen.add(next);
            queue.push({ state: next, path });
        }
    }
    return null;
}

/** All terminal states — no automatic progress from these. */
export const TERMINAL_STATES: ReadonlySet<BotLifecycleState> = new Set([
    "stopped",
    "error",
]);

/** States in which the runtime may accept new market data and generate signals. */
export const RUNNING_STATES: ReadonlySet<BotLifecycleState> = new Set([
    "running",
]);

/** States in which no new entries should be generated. */
export const NO_ENTRY_STATES: ReadonlySet<BotLifecycleState> = new Set([
    "pausing",
    "paused",
    "stopping",
    "stopped",
    "error",
    "draft",
    "validating",
    "ready",
    "backtesting",
]);

/** True when the bot is in any active/transitioning state (not cleanly stopped). */
export function isActive(state: BotLifecycleState): boolean {
    return !TERMINAL_STATES.has(state) && state !== "draft" && state !== "ready";
}

/** True when the bot should be accepting new signals. */
export function canGenerateSignals(state: BotLifecycleState): boolean {
    return RUNNING_STATES.has(state);
}
