// Admin view of account health.
//
// Complements `/api/account-health`, which is scoped to the caller's own
// account. Access control reuses the project's existing `requireAdmin` (Firebase
// ID token + an `admin` role in the RTDB `users` node) — no parallel auth
// system is introduced.
//
// ── Two modes ─────────────────────────────────────────────────────────────────
//   GET /api/admin/account-health                    the whole directory
//   GET /api/admin/account-health?uid=<firebaseUid>  one account, in full
//   GET /api/admin/account-health?email=<email>      one account, by email
//
// The directory is the default, so an operator never has to know a uid: it
// resolves the email and display name of every account itself. The detail mode
// exists because the list deliberately carries only summary figures, and the
// position-level report is read on demand rather than shipped for every user at
// once.
//
// ── Cost of the directory ─────────────────────────────────────────────────────
// Four reads total regardless of user count, not seven reads per user — see
// `loadAccountHealthDirectory`. Sorting happens server-side so the worst
// accounts are first without the client having to hold the whole list to find
// them.
//
// ── What it exposes ───────────────────────────────────────────────────────────
// Verdicts and aggregate figures, plus the account owner's display name and
// email so an operator can confirm they are looking at the right person. No
// credentials, journals, prompts or provider payloads.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { buildAccountHealthDirectory, buildAccountHealthReport } from "@/lib/account-health/report";
import {
    loadAccountHealthDirectory,
    loadAccountHealthFacts,
    readAccountIdentity,
} from "@/lib/account-health/load";
import type { AccountHealthDirectoryEntry } from "@/lib/account-health/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Firebase uids are opaque; this only rejects shapes that could escape the path. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSafeUid(raw: string | null): raw is string {
    return typeof raw === "string" && UID_PATTERN.test(raw);
}

/**
 * Resolve `?email=` to a uid.
 *
 * Scans the `users` node rather than trusting a client-supplied mapping. The
 * read is admin-only (Admin SDK bypasses rules) and only ever returns the uid
 * of a user whose stored email matches exactly.
 */
async function uidFromEmail(email: string): Promise<string | null> {
    const snap = await adminDatabase.ref("users").get();
    if (!snap.exists()) return null;
    const users = snap.val() as Record<string, { email?: unknown }> | null;
    if (!users || typeof users !== "object") return null;
    const target = email.trim().toLowerCase();
    for (const [uid, record] of Object.entries(users)) {
        const candidate = record && typeof record === "object" ? (record as { email?: unknown }).email : null;
        if (typeof candidate === "string" && candidate.trim().toLowerCase() === target) {
            return isSafeUid(uid) ? uid : null;
        }
    }
    return null;
}

/** True when the account has any node at all, so a typo is a 404 not a zero. */
async function accountExists(uid: string): Promise<boolean> {
    const [accountSnap, positionSnap, balanceSnap] = await Promise.all([
        adminDatabase.ref(`trading_accounts/${uid}`).get(),
        adminDatabase.ref(`trading_positions/${uid}`).get(),
        adminDatabase.ref(`users/${uid}`).get(),
    ]);
    return accountSnap.exists() || positionSnap.exists() || balanceSnap.exists();
}

async function handleDetail(rawUid: string | null, rawEmail: string | null): Promise<NextResponse> {
    let uid: string | null = isSafeUid(rawUid) ? rawUid : null;

    if (!uid && rawEmail) {
        const email = rawEmail.trim();
        if (!EMAIL_PATTERN.test(email)) {
            return NextResponse.json({ error: "That email address is not valid." }, { status: 400 });
        }
        uid = await uidFromEmail(email);
        if (!uid) {
            return NextResponse.json({ error: "No user matches that email address." }, { status: 404 });
        }
    }

    if (!uid) {
        return NextResponse.json({ error: "That uid is not a valid Firebase uid." }, { status: 400 });
    }

    if (!(await accountExists(uid))) {
        return NextResponse.json({ error: "No trading account found for that user." }, { status: 404 });
    }

    const [facts, identity] = await Promise.all([
        loadAccountHealthFacts(uid),
        readAccountIdentity(uid),
    ]);
    const health = buildAccountHealthReport(facts);

    return NextResponse.json({
        success: true,
        uid,
        email: identity.email,
        displayName: identity.displayName,
        health,
    });
}

async function handleDirectory(): Promise<NextResponse> {
    const rows = await loadAccountHealthDirectory();

    const entries: AccountHealthDirectoryEntry[] = rows.map(({ uid, email, displayName, facts }) => {
        const health = buildAccountHealthReport(facts);
        return {
            uid,
            email,
            displayName,
            score: health.score,
            riskLevel: health.riskLevel,
            drawdownStatus: health.drawdownStatus,
            marginStatus: health.marginStatus,
            exposureStatus: health.exposureStatus,
            hasData: health.hasData,
            balance: health.metrics.balance,
            equity: health.metrics.equity,
            marginLevel: health.metrics.marginLevel,
            openRisk: health.metrics.openRisk,
            totalPositions: health.metrics.totalPositions,
            positionsAtRisk: health.metrics.positionsAtRisk,
            accounts: health.metrics.accounts,
            // Reporting the account's own currency stops a EUR account being read
            // as a $ one; a multi-currency user shows the first account's.
            currency: health.accounts[0]?.currency ?? "USD",
            connected: health.accounts.some((a) => a.status === "connected"),
        };
    });

    return NextResponse.json({ success: true, directory: buildAccountHealthDirectory(entries) });
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const rawUid = params.get("uid");
    const rawEmail = params.get("email");

    try {
        // No target named at all: return every account, already resolved to an
        // email. This is what makes the console usable without a uid lookup.
        if (!rawUid && !rawEmail) {
            return await handleDirectory();
        }
        return await handleDetail(rawUid, rawEmail);
    } catch (err) {
        console.error("[admin account-health] request failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Failed to load account health." }, { status: 500 });
    }
}
