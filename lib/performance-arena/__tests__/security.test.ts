// Security posture tests (static analysis of the committed configuration and
// route sources). These encode the assumptions the runtime relies on:
//   1. performanceArena is denied to clients in database.rules.json.
//   2. Every arena API route authenticates (one deliberate exception: flags).
//   3. No Firestore anywhere in the arena surface.
//   4. The arena lib uses ONLY the admin (server) database — never the client
//      SDK — so balances/results/rewards cannot be written from the browser.
//   5. The cash endpoint delegates to the server flag gate and never reads a
//      client-supplied flag.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createSuite } from "./harness";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

export async function runSecurityTests(): Promise<boolean> {
    const s = createSuite("security");

    s.section("RTDB rules (client deny-by-default for the arena)");
    const rulesRaw = readFileSync(join(ROOT, "database.rules.json"), "utf8");
    const rules = JSON.parse(rulesRaw) as { rules: Record<string, unknown> };
    s.check(rules.rules[".read"] === false, "root .read = false");
    s.check(rules.rules[".write"] === false, "root .write = false");
    const arena = rules.rules["performanceArena"] as Record<string, unknown> | undefined;
    s.check(Boolean(arena), "performanceArena rule block exists");
    s.check(arena?.[".read"] === false, "performanceArena .read = false (clients cannot read balances/results/rewards)");
    s.check(arena?.[".write"] === false, "performanceArena .write = false (clients cannot edit anything in the arena)");

    s.section("API routes authenticate");
    const routeDirs = [join(ROOT, "app/api/performance-arena"), join(ROOT, "app/api/admin/performance-arena")];
    const routes = routeDirs.flatMap((dir) => walk(dir).filter((f) => f.endsWith("route.ts")));

    // Deliberate, documented exception: the flags snapshot only reveals which
    // surfaces render; every mutation route re-checks entitlement server-side.
    const deliberatePublic = new Set([join("app/api/performance-arena/flags/route.ts")]);

    for (const route of routes) {
        const rel = relative(ROOT, route);
        if (deliberatePublic.has(rel)) continue;
        const source = readFileSync(route, "utf8");
        const authenticated = source.includes("arenaAuth(") || source.includes("authenticate(") || source.includes("requireAdmin(");
        s.check(authenticated, `${rel} authenticates the caller`);
    }
    s.check(routes.length >= 15, `route inventory covered (${routes.length} routes found)`);

    s.section("Cash endpoint is server-gated only");
    const payoutRoute = readFileSync(join(ROOT, "app/api/performance-arena/payouts/route.ts"), "utf8");
    s.check(payoutRoute.includes("requestCashReward("), "payout route delegates to the server gate");
    s.check(!/body\s*\.\s*cash/i.test(payoutRoute), "no client body flag is read as a gate");
    s.check(!/searchParams[^\n]*cash/i.test(payoutRoute), "no query-string flag is read as a gate");

    s.section("Admin reward policy route refuses cash configuration");
    const adminRewards = readFileSync(join(ROOT, "app/api/admin/performance-arena/rewards/route.ts"), "utf8");
    s.check(adminRewards.includes('"CASH"') && adminRewards.includes("CASH_REWARDS_DISABLED"), "admin API rejects CASH grants");
    s.check(!adminRewards.includes("isCashRewardsEnabled() === true"), "admin API never turns cash on");

    s.section("No Firestore, no client DB SDK inside the arena");
    const arenaSources = [
        ...walk(join(ROOT, "lib/performance-arena")),
        ...routeDirs.flatMap((dir) => walk(dir)),
        ...walk(join(ROOT, "components/performance-arena")),
    ].filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    let firestoreHits = 0;
    let clientSdkHits = 0;
    for (const file of arenaSources) {
        const source = readFileSync(file, "utf8");
        if (/from\s+["']firebase\/firestore["']/.test(source) || /firestore\(/i.test(source)) firestoreHits += 1;
        if (/from\s+["']firebase\/database["']/.test(source)) clientSdkHits += 1;
    }
    s.check(firestoreHits === 0, `zero Firestore references (${arenaSources.length} files scanned)`);
    s.check(clientSdkHits === 0, "arena server modules never import the client database SDK");

    const libStore = readFileSync(join(ROOT, "lib/performance-arena/store.ts"), "utf8");
    s.check(libStore.includes('from "@/lib/firebase-admin"'), "store.ts writes through the Admin SDK only");

    s.section("Server-authoritative accounting in the orders route");
    const ordersRoute = readFileSync(join(ROOT, "app/api/performance-arena/attempts/[attemptId]/orders/route.ts"), "utf8");
    s.check(ordersRoute.includes("placeOrder(") && ordersRoute.includes("closePosition("), "orders route delegates to the service layer");
    s.check(ordersRoute.includes("clientRequestId"), "order placement is idempotent");

    s.section("Feature flags live in code/env, not in writable RTDB state");
    const flagsSource = readFileSync(join(ROOT, "lib/performance-arena/flags.ts"), "utf8");
    s.check(flagsSource.includes('process.env'), "flags read from env (deployment-controlled)");
    s.check(!/adminDatabase|ref\(/.test(flagsSource), "flags module has no database dependency (cannot be flipped client-side)");

    return s.finish();
}
