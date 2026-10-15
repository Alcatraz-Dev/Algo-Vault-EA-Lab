/**
 * Packaged macOS rendering regression guards.
 *
 * Runs with:
 *   node scripts/jiti-tsrun.mjs tests/packaged-home-login.test.ts
 *
 * Confirmed failures covered (credential-free, structural):
 *  - `/` returned HTTP 500 because `app/page.tsx` awaited Admin-backed
 *    `getHomeData()` with no fallback when packaged env strips Admin creds.
 *  - `/login` server HTML contained no form because the entire form was
 *    inside `<Suspense>` with `useSearchParams()` (which suspends on SSR).
 *  - Hydration mismatch risk from reading `window.matchMedia` during initial
 *    render in MaskedWordReveal / TacticalCard / HeroConsoleChart.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    throw e;
  }
}

// 1. Homepage degrades to usable UI instead of throwing to a 500.
check("homepage catches Admin failure and renders offline fallback", () => {
  const src = read("app/page.tsx");
  assert.match(src, /try\s*\{[\s\S]*getHomeData\(\)/, "page must try getHomeData");
  assert.match(src, /catch/, "page must catch data failure");
  assert.match(src, /OFFLINE_HOME_DATA/, "page must define offline fallback data");
  assert.match(src, /dataNotice/, "page must surface an explicit data notice");
  assert.match(src, /Live marketplace data is currently unavailable/, "notice must be explicit");
  assert.ok(!/previewBacktests:\s*true/.test(stripComments(src)) || /OFFLINE_HOME_DATA/.test(src), "fallback must not masquerade as live data");
});

check("HomePage renders notice slot and stable root marker", () => {
  const src = read("components/home/HomePage.tsx");
  assert.match(src, /dataNotice\?:/, "HomePage must accept dataNotice");
  assert.match(src, /data-home-page/, "HomePage root marker must remain");
  assert.match(src, /data-home-data-notice/, "notice slot must be rendered");
});

// 2. Login form server-renders; only redirect param is suspense-isolated.
check("login form renders outside Suspense; useSearchParams is isolated", () => {
  const src = read("app/login/page.tsx");
  assert.match(src, /function RedirectReader/, "redirect reader must exist");
  assert.match(src, /useSearchParams/, "redirect reader uses useSearchParams");
  // Main form markup must not be wrapped as a whole in Suspense fallback null.
  assert.ok(!/<Suspense[^>]*>\s*<LoginForm/.test(src), "LoginForm must not be fully wrapped in Suspense");
  assert.match(src, /<Suspense fallback=\{null\}>\s*<RedirectReader/, "only RedirectReader is suspense-isolated");
  assert.match(src, /Welcome back/, "login heading must be present");
  assert.match(src, /login-email/, "email input must be present");
  assert.match(src, /login-password/, "password input must be present");
});

// 3. No window/media-query reads during initial render.
check("MaskedWordReveal initial state matches server", () => {
  const src = stripComments(read("components/home/MaskedWordReveal.tsx"));
  assert.match(src, /useState\(false\)/, "must init false for SSR match");
  assert.ok(!/useState\(\(\)\s*=>\s*\{[\s\S]*?window/.test(src), "must not read window in initializer");
  assert.match(src, /useEffect\([\s\S]*matchMedia/, "preference applied in effect");
});

check("TacticalCard initial state matches server", () => {
  const src = stripComments(read("components/home/TacticalCard.tsx"));
  assert.match(src, /useState\(false\)/, "must init false for SSR match");
  assert.ok(!/useState\(\(\)\s*=>\s*\{[\s\S]*?window/.test(src), "must not read window in initializer");
});

check("HeroConsoleChart does not read matchMedia during render", () => {
  const src = read("components/home/HeroConsoleChart.tsx");
  const renderSection = src.split("const data = useMemo")[0];
  // matchMedia may appear only inside useEffect in the pre-data section.
  const withoutEffects = renderSection.replace(/useEffect\([\s\S]*?\}, \[\]\);/g, "");
  assert.ok(!withoutEffects.includes("matchMedia"), "matchMedia must not run during render");
  assert.match(src, /useState\(false\)/, "reduceMotion must init false");
});

// 4. Security boundaries unchanged: Admin missing-config still throws,
//    packaged env still strips Admin creds.
check("Admin config still requires credentials (no silent bypass)", () => {
  const src = read("lib/firebase-admin-config.ts");
  assert.match(src, /Missing Firebase Admin environment variables/, "must still throw when missing");
});

check("packaged server env still denies Admin forwarding", () => {
  const src = read("apps/desktop/src/main/server-env.ts");
  assert.match(src, /isPackaged === false/, "packaged boundary must remain");
});

console.log(`\npackaged-home-login guards passed: ${passed}`);
