// Entitlement / Pro-gating tests — pure and offline (no Firebase, no network).
//
// The join gate is the arena's most security-sensitive decision, so it is
// verified two ways:
//   1. Behavioral: evaluateEntitlement (pure, deps injected) decides every
//      access model, honours env flags fail-closed, and never consults a
//      dependency it doesn't need for the branch it took.
//   2. Static wiring: the production service injects the canonical Strategy
//      Lab checkAccess gate (the same source of truth Strategy Lab /
//      Strategy Research enforce), the RTDB wallet, and no API route reads
//      an entitlement or price from client input.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessStatus } from "@/lib/strategy-lab/types";
import { createSuite } from "./harness";
import { NOW } from "./fixtures";
import { evaluateEntitlement, type EntitlementDeps } from "../entitlement";
import { defaultChallengeDefinitions } from "../policies";
import type { ChallengeAccessModel, ChallengeDefinition } from "../types";

const ROOT = process.cwd();

const ARENA_ENV_KEYS = [
    "PERFORMANCE_ARENA_ENABLED",
    "ARENA_PAID_CHALLENGES_ENABLED",
    "ARENA_STRIPE_BILLING_VERIFIED",
    "ARENA_PLATFORM_REWARDS_ENABLED",
] as const;

type EnvKey = (typeof ARENA_ENV_KEYS)[number];

const baseDefinition: ChallengeDefinition = defaultChallengeDefinitions(NOW)[0];

function def(model: ChallengeAccessModel, extra: { pricePoints?: number } = {}): ChallengeDefinition {
    return { ...baseDefinition, access: { model, ...extra } };
}

interface Recorder {
    deps: EntitlementDeps;
    entitlementCalls: string[];
    walletCalls: string[];
}

function makeDeps(opts: { entitlement?: AccessStatus; points?: number } = {}): Recorder {
    const entitlementCalls: string[] = [];
    const walletCalls: string[] = [];
    return {
        entitlementCalls,
        walletCalls,
        deps: {
            checkEntitlement: async (uid) => {
                entitlementCalls.push(uid);
                return opts.entitlement ?? { accessible: false, level: "none", status: "none", reason: "No entitlement." };
            },
            getWalletPoints: async (uid) => {
                walletCalls.push(uid);
                return opts.points ?? 0;
            },
        },
    };
}

const ENTITLED: AccessStatus = { accessible: true, level: "pro", status: "active" };
const NOT_ENTITLED: AccessStatus = { accessible: false, level: "none", status: "none" };

export async function runEntitlementTests(): Promise<boolean> {
    const s = createSuite("entitlement-pro-gating");

    const saved = Object.fromEntries(ARENA_ENV_KEYS.map((k) => [k, process.env[k]])) as Record<EnvKey, string | undefined>;
    const setEnv = (key: EnvKey, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    try {
        // Deterministic baseline: arena on, paid off (product default), rewards on.
        setEnv("PERFORMANCE_ARENA_ENABLED", "true");
        setEnv("ARENA_PAID_CHALLENGES_ENABLED", "false");
        setEnv("ARENA_STRIPE_BILLING_VERIFIED", "false");
        setEnv("ARENA_PLATFORM_REWARDS_ENABLED", "true");

        s.section("Free model — allowed with no dependency consulted");
        {
            const r = makeDeps();
            const res = await evaluateEntitlement("uid_free", def("free"), r.deps);
            s.check(res.allowed === true && res.level === "free", "free challenge allowed (level=free)");
            s.check(r.entitlementCalls.length === 0 && r.walletCalls.length === 0, "no entitlement/wallet call for free entry");
        }

        s.section("Pro model — server-side canonical Pro gate");
        {
            const r = makeDeps({ entitlement: ENTITLED });
            const res = await evaluateEntitlement("uid_pro", def("pro"), r.deps);
            s.check(res.allowed === true && res.level === "pro", "entitled user allowed (level=pro)");
            s.check(r.entitlementCalls.length === 1 && r.entitlementCalls[0] === "uid_pro", "entitlement checked exactly once for the uid");
            s.check(r.walletCalls.length === 0, "wallet never consulted for pro entry");
        }
        {
            const reason = "The AI Strategy Lab requires an active Pro subscription or the AI Strategy Lab license.";
            const r = makeDeps({ entitlement: { ...NOT_ENTITLED, reason } });
            const res = await evaluateEntitlement("uid_noPro", def("pro"), r.deps);
            s.check(res.allowed === false, "non-Pro user denied");
            s.check(res.reason === reason, "license reason propagated verbatim");
        }
        {
            const r = makeDeps({ entitlement: NOT_ENTITLED });
            const res = await evaluateEntitlement("uid_noReason", def("pro"), r.deps);
            s.check(res.allowed === false && res.reason === "This challenge requires an active Pro subscription.", "missing reason falls back to the honest default");
        }

        s.section("Paid model — OFF by default, billing-gated when on");
        {
            const r = makeDeps({ entitlement: ENTITLED });
            const res = await evaluateEntitlement("uid_paid", def("paid"), r.deps);
            s.check(res.allowed === false && res.reason === "Paid challenges are not available yet.", "paid denied while ARENA_PAID_CHALLENGES_ENABLED=false (product default)");
            s.check(r.entitlementCalls.length === 0, "flag gate short-circuits before any entitlement call");
        }
        setEnv("ARENA_PAID_CHALLENGES_ENABLED", "true");
        setEnv("ARENA_STRIPE_BILLING_VERIFIED", "true");
        {
            const r = makeDeps({ entitlement: ENTITLED });
            r.deps.checkPaidChallengeGrant = async () => true;
            const res = await evaluateEntitlement("uid_paid", def("paid"), r.deps);
            s.check(res.allowed === true && res.level === "paid", "verified order grant allows paid challenge when flag on");
            s.check(r.entitlementCalls.length === 0, "Pro subscription does not substitute for a paid challenge purchase");
        }
        {
            const r = makeDeps({ entitlement: ENTITLED });
            r.deps.checkPaidChallengeGrant = async () => false;
            const res = await evaluateEntitlement("uid_paid", def("paid"), r.deps);
            s.check(res.allowed === false && res.reason === "A verified purchase for this challenge is required.", "denies paid challenge without verified purchase even for Pro user");
        }
        setEnv("ARENA_PAID_CHALLENGES_ENABLED", "false");
        setEnv("ARENA_STRIPE_BILLING_VERIFIED", "false");

        s.section("Credits model — AV Points priced entry (server wallet)");
        {
            const r = makeDeps({ points: 500 });
            const res = await evaluateEntitlement("uid_pts", def("credits", { pricePoints: 200 }), r.deps);
            s.check(res.allowed === true && res.level === "credits", "sufficient AV Points allowed (level=credits)");
            s.check(r.entitlementCalls.length === 0, "no Pro check for points-priced entry");
            s.check(r.walletCalls.length === 1 && r.walletCalls[0] === "uid_pts", "wallet read exactly once for the uid");
        }
        {
            const r = makeDeps({ points: 100 });
            const res = await evaluateEntitlement("uid_pts", def("credits", { pricePoints: 200 }), r.deps);
            s.check(res.allowed === false && res.reason === "Requires 200 AV Points (you have 100).", "insufficient AV Points denied with exact shortfall");
        }
        {
            const r = makeDeps({ points: 0 });
            const res = await evaluateEntitlement("uid_pts", def("credits"), r.deps);
            s.check(res.allowed === true && res.level === "credits", "missing pricePoints ⇒ cost 0 (free-of-points entry still allowed)");
        }
        setEnv("ARENA_PLATFORM_REWARDS_ENABLED", "false");
        {
            const r = makeDeps({ points: 10_000 });
            const res = await evaluateEntitlement("uid_pts", def("credits", { pricePoints: 1 }), r.deps);
            s.check(res.allowed === false && res.reason === "Points-based challenge access is currently disabled.", "points entry denied when platform rewards flag off");
            s.check(r.walletCalls.length === 0, "flag gate short-circuits before the wallet read");
        }
        setEnv("ARENA_PLATFORM_REWARDS_ENABLED", "true");

        s.section("Fail-closed flags and unknown inputs");
        setEnv("PERFORMANCE_ARENA_ENABLED", "false");
        {
            const r = makeDeps({ entitlement: ENTITLED });
            const res = await evaluateEntitlement("uid_off", def("pro"), r.deps);
            s.check(res.allowed === false && res.reason === "Performance Arena is currently disabled.", "arena disabled ⇒ everything denied");
            s.check(r.entitlementCalls.length === 0 && r.walletCalls.length === 0, "disabled flag short-circuits before any dependency");
        }
        setEnv("PERFORMANCE_ARENA_ENABLED", "true");
        {
            const r = makeDeps({ entitlement: ENTITLED });
            const res = await evaluateEntitlement("uid_x", def("mystery" as unknown as ChallengeAccessModel), r.deps);
            s.check(res.allowed === false && res.reason === "Unknown access model.", "unknown access model denied (never granted)");
            s.check(r.entitlementCalls.length === 0 && r.walletCalls.length === 0, "unknown model consults nothing");
        }

        s.section("Production wiring — canonical gate, server-side only (static)");
        const serviceSrc = readFileSync(join(ROOT, "lib/performance-arena/service.ts"), "utf8");
        s.check(serviceSrc.includes('import { checkAccess } from "@/lib/strategy-lab/license"'), "service imports the canonical Strategy Lab gate");
        s.check(/checkEntitlement:\s*checkAccess/.test(serviceSrc), "service injects checkAccess as the entitlement checker");
        s.check(/getWalletPoints:[\s\S]*store\.getWallet/.test(serviceSrc), "service injects the RTDB wallet as the points source");
        s.check((serviceSrc.match(/await evaluateAccess\(uid, definition\)/g) ?? []).length >= 2, "join and catalog both gate through evaluateAccess");

        const licenseSrc = readFileSync(join(ROOT, "lib/strategy-lab/license.ts"), "utf8");
        s.check(licenseSrc.includes("checkAccess failed") && licenseSrc.includes("Unable to verify access"), "canonical gate fails closed on backend errors (deny, never throw)");

        const joinRouteSrc = readFileSync(join(ROOT, "app/api/performance-arena/attempts/route.ts"), "utf8");
        s.check(joinRouteSrc.includes("joinChallenge("), "join route delegates to the server service");
        s.check(!/body\s*\.\s*(access|entitlement|pro|level|price)/i.test(joinRouteSrc), "join route reads no entitlement/price field from the client body");
    } finally {
        for (const key of ARENA_ENV_KEYS) setEnv(key, saved[key]);
    }

    return s.finish();
}
