// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Scope Guard
//
// The agent's allowed purpose is developing, debugging, testing, inspecting,
// documenting and verifying the AlgoVault platform — nothing else. This module
// classifies every incoming request BEFORE any planning or tool use and refuses
// out-of-scope work in code (not just via the system prompt).
//
// The classifier is deliberately conservative:
//   • Explicit credential/personal/system intents → out_of_scope.
//   • Engineering keywords or repo entity mentions → in_scope.
//   • Anything it cannot tie to the platform → ambiguous → treated as
//     out_of_scope in ask/engineer execution unless the user rephrases.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScopeCheck } from "../core/types";

/** Strong out-of-scope signals (checked case-insensitively). */
const OUT_OF_SCOPE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\b(personal|my|the)\s+(files?|photos?|documents?|computer|laptop|machine|desktop|downloads?)\b/i, reason: "Accessing personal files or the user's computer is outside the AlgoVault project scope." },
    { pattern: /\b(ssh\s+keys?|private\s+keys?|certificates?|wallet|seed\s+phrase|passwords?)\b/i, reason: "Credentials and keys are never in scope for the agent." },
    { pattern: /\b(hack|exploit|bruteforce|brute\s?force|credential\s+harvest|keylog)\w*/i, reason: "Hacking or credential collection is out of scope and refused." },
    { pattern: /\b(other|another|unrelated)\s+(project|repo|repositor\w+|app|website)\b/i, reason: "Unrelated projects or repositories are out of scope." },
    { pattern: /\b(my|our|the)\s+(gmail|email|facebook|instagram|twitter|x|bank|paypal|stripe)\s+(account|inbox)?\b/i, reason: "Managing personal or external accounts is out of scope." },
    { pattern: /\b(screenshot|record|control)\s+(my|the)\s+(screen|desktop|browser)\b/i, reason: "Controlling the user's machine or screen is out of scope." },
    { pattern: /\b(install|configure|clean)\s+(windows|macos|linux|drivers?|printer|antivirus)\b/i, reason: "Operating-system configuration is out of scope." },
    { pattern: /\b(prod(uction)?|live)\s+(database|db|infra|server|deploy)\b/i, reason: "Production infrastructure is out of reach for the agent by policy." },
    { pattern: /\b(delete|wipe|format)\s+(everything|all\s+files|my\s+disk|the\s+repo)\b/i, reason: "Mass deletion requests are refused." },
];

/** Signals that the request is about building/fixing the platform. */
const IN_SCOPE_PATTERNS: RegExp[] = [
    /\b(algovault|trading|trader|signal|signals|strategy|strategies|backtest|backtesting|market|intelligence|workflow|workflows|workspace|studio|chart|charts|indicator|indicators|broker|account|accounts|license|licenses|subscription|subscription?|checkout|order|orders|marketplace|bot|bots|journal|analytics|radar|scalping|copilot|dashboard|admin)\b/i,
    /\b(component|components|page|pages|route|routes|api|hook|hooks|store|lib|utils?|types?|test|tests|lint|typecheck|build|refactor|bug|fix|error|regression|deploy(ed|ment)?\s+config|docs?|documentation|readme|architecture|design\s+system|tailwind|css|ui|ux)\b/i,
    /\b(next\.?js|react|typescript|firebase|rtdb|firestore|tailwind|eslint|vitest|jiti|recharts|lightweight-charts)\b/i,
    /\b(add|implement|create|write|remove|delete|update|fix|refactor|improve|optimi[sz]e|document|test|verify|debug|investigate|inspect|explain|review|plan)\b/i,
];

const AMBIGUOUS_GENERIC = [
    /^(hi|hello|hey|yo|test)\b/i,
    /^(thanks|thank you|ok|okay|great|nice)\b/i,
    /^(what can you do|who are you|help)\b/i,
];

/**
 * Classify a user request against the agent's mission.
 * Pure function; throws nothing.
 */
export function checkRequestScope(request: string): ScopeCheck {
    if (typeof request !== "string" || request.trim().length === 0) {
        return { verdict: "out_of_scope", reason: "Empty request." };
    }

    // 1. Out-of-scope patterns take precedence — security first.
    for (const { pattern, reason } of OUT_OF_SCOPE_PATTERNS) {
        if (pattern.test(request)) {
            return { verdict: "out_of_scope", reason };
        }
    }

    // 2. Greetings/meta questions are ambiguous-but-harmless: allow as
    //    conversational, they cannot trigger tool execution.
    for (const rx of AMBIGUOUS_GENERIC) {
        if (rx.test(request.trim())) {
            return { verdict: "ambiguous", reason: "Conversational message — no engineering task identified." };
        }
    }

    // 3. In-scope engineering signals.
    const hits = IN_SCOPE_PATTERNS.reduce(
        (acc, rx) => (rx.test(request) ? acc + 1 : acc),
        0,
    );

    if (hits > 0) {
        return { verdict: "in_scope", reason: "Request matches AlgoVault engineering scope." };
    }

    // 4. Ambiguous → the caller decides, defaulting to refusal for mutating modes.
    return {
        verdict: "ambiguous",
        reason:
            "The request could not be tied to the AlgoVault platform. Rephrase it as a platform engineering task (component, route, test, workflow, signal pipeline…).",
    };
}

/**
 * Hard refusal message used by the runtime when scope fails. The agent never
 * becomes useful by weakening this: the message stays generic and non-negotiable.
 */
export function scopeRefusalMessage(reason: string): string {
    return `This task is outside the AlgoVault agent's configured project scope, so I can't execute it. ${reason} The agent only works on the AlgoVault platform itself — its code, tests, docs, workflows and infrastructure-as-code inside the approved workspace.`;
}
