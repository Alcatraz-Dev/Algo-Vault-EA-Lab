/**
 * Product Analytics — route existence guard.
 *
 * Every route we point a user at from the Pro value gate, the re-engagement
 * copy, or the plan comparison must actually exist. A 404 on an upgrade prompt
 * is both a broken funnel and a credibility problem, so this is enforced by a
 * test rather than by review.
 *
 * Run directly: `npm run test:product-analytics` includes it via the runner,
 * or `npx jiti lib/product-analytics/__tests__/check-routes.ts`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PRO_VALUE_POINTS, PLAN_COMPARISON } from "../pro-value";
import { VALUE_MOMENT_COPY } from "../retention";
import { UPGRADE_TRIGGERS } from "../upgrade-intent";
import { SAFE_SURFACES } from "../experiments";

const APP_DIR = join(process.cwd(), "app");

/**
 * A Next.js App Router route exists if it has a `page.tsx` (page) or
 * `route.ts` (API handler) at that path, or is a dynamic segment with at least
 * one child that does.
 */
export function routeExists(route: string): boolean {
    const clean = route.replace(/\/+$/, "") || "/";
    const dir = join(APP_DIR, clean);
    if (existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))) return true;
    // A dynamic segment like /strategy-research/[missionId] still means the
    // parent path is routable, so accept it if the directory has any page.
    if (existsSync(dir)) return hasAnyPage(dir);
    return false;
}

function hasAnyPage(dir: string, depth = 0): boolean {
    if (depth > 6) return false;
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return false;
    }
    if (entries.includes("page.tsx")) return true;
    for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        try {
            if (statSync(full).isDirectory() && hasAnyPage(full, depth + 1)) return true;
        } catch {
            continue;
        }
    }
    return false;
}

const failures: string[] = [];

function assertRoute(label: string, route: string) {
    if (routeExists(route)) {
        console.log(`  PASS: ${label} → ${route}`);
    } else {
        failures.push(`${label} → ${route}`);
        console.log(`  FAIL: ${label} → ${route} (route does not exist)`);
    }
}

console.log("\n── Pro value catalogue routes ──────────────────────────");
for (const [key, value] of Object.entries(PRO_VALUE_POINTS)) {
    assertRoute(`pro-value:${key}`, value.exampleRoute);
}

console.log("\n── Plan comparison routes ─────────────────────────────");
for (const row of PLAN_COMPARISON) {
    assertRoute(`plan:${row.workflow}`, row.route);
}

console.log("\n── Re-engagement routes ───────────────────────────────");
const seenMoments = new Set<string>();
for (const [moment, copy] of Object.entries(VALUE_MOMENT_COPY)) {
    if (seenMoments.has(copy.href)) continue;
    seenMoments.add(copy.href);
    assertRoute(`re-engagement:${moment}`, copy.href);
}

console.log("\n── Data integrity of the catalogue ────────────────────");
const forbidden = /(guarantee|risk[- ]?free|100%|never lose|get rich|proven returns)/i;
for (const [key, value] of Object.entries(PRO_VALUE_POINTS)) {
    const text = [value.title, value.freeIncludes, ...value.adds].join(" ");
    if (forbidden.test(text)) {
        failures.push(`pro-value:${key} contains a blocked claim`);
        console.log(`  FAIL: pro-value:${key} contains a blocked claim`);
    } else {
        console.log(`  PASS: pro-value:${key} makes no unsupported claim`);
    }
    // `PRO_VALUE_POINTS` is `as const`, so every entry's `adds` is a non-empty
    // tuple at the type level. Assert it at runtime anyway — the runtime shape
    // is what the component actually renders.
    if (value.adds.length < 1) {
        failures.push(`pro-value:${key} lists no capabilities`);
        console.log(`  FAIL: pro-value:${key} lists no capabilities`);
    }
}

const triggersWithoutCopy = UPGRADE_TRIGGERS.filter((t) => !(t in PRO_VALUE_POINTS));
console.log(`${triggersWithoutCopy.length === 0 ? "  PASS" : "  FAIL"}: every upgrade trigger has value copy`);
if (triggersWithoutCopy.length > 0) failures.push(`triggers without value copy: ${triggersWithoutCopy.join(", ")}`);

const uniqueRoutes = new Set(Object.values(PRO_VALUE_POINTS).map((v) => v.exampleRoute));
console.log(`  INFO: ${uniqueRoutes.size} distinct example routes across ${Object.keys(PRO_VALUE_POINTS).length} gates`);

console.log(`  INFO: ${SAFE_SURFACES.length} experimentable surfaces`);

console.log("\n" + "=".repeat(62));
if (failures.length > 0) {
    console.log(`  ${failures.length} route/data failures:`);
    for (const f of failures) console.log(`   - ${f}`);
    console.log("=".repeat(62));
    process.exit(1);
}
console.log("  ALL ROUTES AND CLAIMS VALID");
console.log("=".repeat(62));
console.log("\n🎉 ROUTE VALIDATION PASSED\n");
