import { test, expect, type Page, type APIResponse } from "@playwright/test";

/**
 * Strategy Studio access smoke test (real Chromium).
 *
 * Verifies the Pro/non-Pro/Admin browser experience for the account-area
 * Strategy Studio routes against a running Next.js dev server.
 *
 * Prerequisites:
 *   1. A running dev server: `npm run dev` on $SMOKE_BASE_URL
 *   2. Firebase client config env vars (NEXT_PUBLIC_FIREBASE_*) — in .env.local
 *   3. Legitimate test identities via env vars (never hardcoded):
 *         SMOKE_PRO_EMAIL / SMOKE_PRO_PASSWORD   — active Pro subscriber
 *         SMOKE_FREE_EMAIL / SMOKE_FREE_PASSWORD — non-Pro subscriber
 *         SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD — admin (optional)
 *
 * Run:
 *   SMOKE_BASE_URL=http://localhost:3000 \
 *   chrome-extension/node_modules/.bin/playwright test \
 *       -c e2e/playwright.config.ts e2e/strategy-studio-access.smoke.spec.ts
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const ROUTES = [
    "/account/strategy-studio",
    "/account/strategy-studio/editor",
    "/account/strategy-studio/builder",
];

const PRO_EMAIL = process.env.SMOKE_PRO_EMAIL;
const PRO_PASSWORD = process.env.SMOKE_PRO_PASSWORD;
const FREE_EMAIL = process.env.SMOKE_FREE_EMAIL;
const FREE_PASSWORD = process.env.SMOKE_FREE_PASSWORD;

async function maybeSignIn(page: Page, email: string | undefined, password: string | undefined): Promise<boolean> {
    if (!email || !password) return false;
    await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
    const emailInput = page.locator('input[type="email"]').first();
    const passInput = page.locator('input[type="password"]').first();
    if ((await emailInput.count()) === 0 || (await passInput.count()) === 0) {
        throw new Error("Sign-in form not found at /account — cannot authenticate test identity");
    }
    await emailInput.fill(email);
    await passInput.fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(2000);
    return true;
}

function collectBotStudio401s(page: Page): APIResponse[] {
    const denied: APIResponse[] = [];
    page.on("response", (r) => {
        if (r.url().includes("/api/bot-studio/") && r.status() === 401) {
            denied.push(r);
        }
    });
    return denied;
}

test.describe("Strategy Studio — unauthenticated access", () => {
    for (const route of ROUTES) {
        test(`API calls to ${route} return 401 when unsigned`, async ({ page }) => {
            const denied = collectBotStudio401s(page);
            await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(3000);
            expect(denied.length, `unauthenticated /api/bot-studio/* calls for ${route} must return 401`).toBeGreaterThan(0);
        });
    }
});

test.describe("Strategy Studio — Pro user (identity-dependent)", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("Pro user can access all Strategy Studio routes", async ({ page }) => {
        const signedIn = await maybeSignIn(page, PRO_EMAIL, PRO_PASSWORD);
        if (!signedIn) {
            test.skip(true, "SMOKE_PRO_EMAIL/SMOKE_PRO_PASSWORD not configured — Pro browser access NOT VERIFIED");
            return;
        }

        for (const route of ROUTES) {
            await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
            await expect(page).toHaveURL(new RegExp(`${route}$|${route}/`));
        }
    });

    test("Pro user can reach editor and builder surfaces", async ({ page }) => {
        const signedIn = await maybeSignIn(page, PRO_EMAIL, PRO_PASSWORD);
        if (!signedIn) {
            test.skip(true, "SMOKE_PRO_EMAIL/SMOKE_PRO_PASSWORD not configured — editor/builder NOT VERIFIED");
            return;
        }

        await page.goto(`${BASE_URL}/account/strategy-studio/editor`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: /save strategy/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /run backtest/i })).toBeVisible();
    });
});

test.describe("Strategy Studio — non-Pro user (identity-dependent)", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("non-Pro user is denied Strategy Studio API access", async ({ page }) => {
        const signedIn = await maybeSignIn(page, FREE_EMAIL, FREE_PASSWORD);
        if (!signedIn) {
            test.skip(true, "SMOKE_FREE_EMAIL/SMOKE_FREE_PASSWORD not configured — non-Pro denial NOT VERIFIED");
            return;
        }

        const denied = collectBotStudio401s(page);
        await page.goto(`${BASE_URL}/account/strategy-studio`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        expect(denied.length, "non-Pro /api/bot-studio/* calls must return 401").toBeGreaterThan(0);
    });
});

test.describe("Strategy Studio — admin access (optional)", () => {
    const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
    const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;

    test("admin can access all Strategy Studio routes", async ({ page }) => {
        if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
            test.skip(true, "SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD not configured — admin access NOT VERIFIED");
            return;
        }

        await maybeSignIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        for (const route of ROUTES) {
            await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
            await expect(page).toHaveURL(new RegExp(`${route}$|${route}/`));
        }
    });
});
