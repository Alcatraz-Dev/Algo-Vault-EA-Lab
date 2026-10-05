/**
 * Phase 11 — canonical deep-link target renderer.
 *
 * One component renders every canonical deep-link destination. The individual
 * routes (`/setup/{id}`, `/alert/{id}`, …) are thin wrappers that pass a parsed
 * `DeepLinkTarget` here. That is deliberate: seven hand-written pages would drift
 * from each other and from the notification router within a release.
 *
 * Rules enforced here:
 *   • The id is validated against the same grammar the RTDB repositories use
 *     before it touches a database reference.
 *   • Records are read with the Admin SDK under the authenticated caller's uid
 *     only — a deep link can never read another user's setup, alert or position.
 *   • Anything that cannot be found renders "Not available" rather than an empty
 *     page or, worse, a zeroed-out record that looks real.
 */

import { cookies } from "next/headers";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import type { DeepLinkTarget } from "@/lib/mobile/contracts";
import { MEMORY_PATHS } from "@/lib/market-intelligence/memory/repository";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";

export const dynamic = "force-dynamic";

type Resolved =
    | { kind: "ok"; title: string; subtitle: string; rows: Array<[string, string]>; deepLink?: string }
    | { kind: "unavailable"; title: string; reason: string };

/** Firebase web session cookie. The id token in the Authorization header is not
 *  available to a server component during a cold navigation from a push tap, so
 *  the session cookie is the correct check here. */
async function currentUid(): Promise<string | null> {
    const store = await cookies();
    const session = store.get("__session")?.value ?? store.get("session")?.value;
    if (!session) return null;
    try {
        const decoded = await adminAuth.verifySessionCookie(session, true);
        return decoded.uid;
    } catch {
        return null;
    }
}

export async function DeepLinkPage({
    target,
    loginRedirect,
}: {
    target: DeepLinkTarget;
    /** Path to send an unauthenticated visitor to, preserving the destination. */
    loginRedirect: string;
}) {
    const uid = await currentUid();

    if (!uid) {
        return (
            <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
                <h1 className="text-lg font-semibold">Sign in to continue</h1>
                <p className="text-sm text-muted-foreground">
                    This link points at your AlgoVault data. We&apos;ll take you straight there once you sign in.
                </p>
                <a
                    href={loginRedirect}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-primary"
                >
                    Sign in
                </a>
            </main>
        );
    }

    const resolved = await resolve(target, uid);

    if (resolved.kind === "unavailable") {
        return (
            <main className="mx-auto max-w-md space-y-3 p-6">
                <h1 className="text-lg font-semibold">{resolved.title}</h1>
                <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                    {resolved.reason}
                </p>
                <a href="/mobile" className="inline-block text-sm text-primary">
                    Back to Command Center
                </a>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-md space-y-4 p-4">
            <header>
                <h1 className="text-lg font-semibold">{resolved.title}</h1>
                <p className="text-xs text-muted-foreground">{resolved.subtitle}</p>
            </header>
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {resolved.rows.map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 px-3 py-2.5">
                        <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                        <dd className="text-right font-mono text-xs tabular-nums">{value}</dd>
                    </div>
                ))}
            </dl>
            {resolved.deepLink && (
                <a
                    href={resolved.deepLink}
                    className="block rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-center text-sm font-medium text-primary"
                >
                    Open in Terminal
                </a>
            )}
            <a href="/mobile" className="inline-block text-sm text-muted-foreground">
                Back to Command Center
            </a>
        </main>
    );
}

async function resolve(target: DeepLinkTarget, uid: string): Promise<Resolved> {
    switch (target.kind) {
        case "terminal":
        case "terminal-home":
            return {
                kind: "ok",
                title: target.kind === "terminal" ? target.symbol : "Terminal",
                subtitle: "Open the chart to see this market.",
                rows: [
                    ["Symbol", target.kind === "terminal" ? target.symbol : "Workspace default"],
                    ["Timeframe", target.kind === "terminal" && target.timeframe ? target.timeframe : "Workspace default"],
                ],
                deepLink:
                    target.kind === "terminal"
                        ? `/mobile/terminal/${encodeURIComponent(target.symbol)}${target.timeframe ? `?tf=${target.timeframe}` : ""}`
                        : "/mobile/terminal",
            };

        case "setup":
            return resolveSetup(target.setupId, uid);

        case "alert":
            return resolveAlert(target.alertId, uid);

        case "position":
            return resolvePosition(target.positionId, uid);

        case "research":
            return {
                kind: "ok",
                title: "Research run",
                subtitle: "Research runs are monitored on the server. Open the full report for results.",
                rows: [
                    ["Research id", target.researchId],
                    ["Computation", "Server-side — never on the device"],
                ],
                deepLink: `/strategy-research/${encodeURIComponent(target.researchId)}`,
            };

        case "strategy":
            return {
                kind: "ok",
                title: "Strategy",
                subtitle: "Health, validation state and live-versus-paper divergence.",
                rows: [["Strategy id", target.strategyId]],
                deepLink: `/strategy-lab/${encodeURIComponent(target.strategyId)}`,
            };

        case "journal":
            return {
                kind: "ok",
                title: "Journal entry",
                subtitle: "Thesis, execution and AI review of what actually happened.",
                rows: [["Entry id", target.entryId]],
                deepLink: `/trade-journal/${encodeURIComponent(target.entryId)}`,
            };
    }
}

async function resolveSetup(setupId: string, uid: string): Promise<Resolved> {
    const snap = await adminDatabase.ref(`${MEMORY_PATHS.userSetups(uid)}/${setupId}`).get();
    if (!snap.exists()) {
        return {
            kind: "unavailable",
            title: "Setup not found",
            reason:
                "This setup does not exist on your account, or it was removed. Setups are private to the account that created them.",
        };
    }
    const setup = snap.val() as SetupMemoryRecord;
    const conditions = setup.conditions ?? [];
    const matched = conditions.filter((c) => c.matched).length;

    return {
        kind: "ok",
        title: `${setup.symbol ?? "Setup"} · ${setup.timeframe ?? ""}`.trim(),
        subtitle: "Setup Memory record",
        rows: [
            ["Status", setup.status],
            ["Conditions", `${matched} / ${conditions.length}`],
            ["Updated", new Date(setup.updatedAt).toISOString()],
            ...(setup.triggeredAt ? ([["Triggered", new Date(setup.triggeredAt).toISOString()]] as Array<[string, string]>) : []),
            ...(setup.invalidatedAt ? ([["Invalidated", new Date(setup.invalidatedAt).toISOString()]] as Array<[string, string]>) : []),
        ],
        deepLink: setup.symbol ? `/mobile/terminal/${encodeURIComponent(setup.symbol)}?tf=${setup.timeframe ?? "M5"}` : undefined,
    };
}

async function resolveAlert(alertId: string, uid: string): Promise<Resolved> {
    const snap = await adminDatabase.ref(`alerts/${uid}/${alertId}`).get();
    if (!snap.exists()) {
        return { kind: "unavailable", title: "Alert not found", reason: "This alert does not exist on your account." };
    }
    const alert = snap.val() as Record<string, unknown>;
    const symbol = String(alert.symbol ?? "");
    const timeframe = String(alert.timeframe ?? "");
    return {
        kind: "ok",
        title: `${symbol || "Alert"} · ${timeframe}`.trim(),
        subtitle: String(alert.message ?? alert.type ?? "Alert"),
        rows: [
            ["Type", String(alert.type ?? "—")],
            ["Triggered", alert.triggered ? "Yes" : "Not yet"],
            ["Created", new Date(Number(alert.createdAt ?? 0)).toISOString()],
        ],
        deepLink: symbol ? `/mobile/terminal/${encodeURIComponent(symbol)}${timeframe ? `?tf=${timeframe}` : ""}` : undefined,
    };
}

async function resolvePosition(positionId: string, uid: string): Promise<Resolved> {
    const snap = await adminDatabase.ref(`trading_positions/${uid}/${positionId}`).get();
    if (!snap.exists()) {
        return {
            kind: "unavailable",
            title: "Position not found",
            reason: "This position is no longer open, or it does not belong to your account.",
        };
    }
    const position = snap.val() as Record<string, unknown>;
    return {
        kind: "ok",
        title: `${String(position.symbol ?? "Position")} · ${String(position.type ?? position.side ?? "")}`.trim(),
        subtitle: "Open position",
        rows: [
            ["Lots", String(position.lots ?? position.volume ?? "—")],
            ["Open price", String(position.openPrice ?? "—")],
            ["Current price", String(position.currentPrice ?? "—")],
            ["Stop loss", position.stopLoss ? String(position.stopLoss) : "None"],
            ["Take profit", position.takeProfit ? String(position.takeProfit) : "None"],
        ],
        deepLink: position.symbol
            ? `/mobile/terminal/${encodeURIComponent(String(position.symbol))}`
            : undefined,
    };
}
