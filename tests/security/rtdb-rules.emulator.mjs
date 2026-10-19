#!/usr/bin/env node
/**
 * RUNTIME RTDB SECURITY-RULE PROBE (Firebase Emulator).
 *
 * The Bot Studio / entitlement boundaries in `database.rules.json` are only
 * meaningful if the ruleset actually compiles and behaves. This probe runs the
 * real Firebase Realtime Database emulator against the committed ruleset and
 * asserts the authorization boundaries that matter:
 *
 *   1. Bot Studio trees (bot_strategies / bot_deployments / bot_logs /
 *      bot_signals / bot_executions / bot_audit) are Admin-SDK only — clients
 *      can neither read nor write them, not even their own records.
 *   2. The owner-scoped index trees (bot_strategies_index / bot_deployments_index)
 *      are readable by their owner and invisible to anybody else.
 *   3. A user cannot read or write another user's `users/{uid}` record.
 *   4. A user CANNOT grant themselves Pro/Enterprise by writing
 *      `users/{uid}/subscription`, and cannot grant themselves a paid
 *      developer plan via `users/{uid}/developerSubscription`.
 *   5. A user CANNOT escalate their own `role` to "admin" (which would make
 *      `requireAdmin` — and therefore every admin API route — accept them).
 *   6. Legitimate client writes (register profile, account settings, notes,
 *      owner index reads) still work.
 *   7. Unauthenticated access is denied everywhere.
 *
 * Requirements (both are already present on the maintainer workstation):
 *   - `firebase` CLI (firebase-tools) on PATH
 *   - a JDK >= 21 (firebase-tools refuses to start the emulator on older JVMs)
 *
 * Usage:  npm run test:rtdb-rules
 * If the prerequisites are missing the probe SKIPS (exit 0) and says why, so
 * it can never be mistaken for a passing run.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const RULES_FILE = join(REPO, "database.rules.json");
const SELF = fileURLToPath(import.meta.url);
const PROJECT_ID = "demo-algovault";
const NAMESPACE = "algovault-4c564-default-rtdb";

// ─────────────────────────────────────────────────────────────────────────────
// Parent process: launch the emulator and run this file again as the child
// ─────────────────────────────────────────────────────────────────────────────
async function runParent() {
    if (!existsSync(RULES_FILE)) {
        console.error(`SKIP: rules file not found at ${RULES_FILE}`);
        process.exit(0);
    }

    if (!hasFirebaseCli()) {
        console.log("SKIP: the `firebase` CLI (firebase-tools) is not on PATH.");
        console.log("      Install it with: npm i -g firebase-tools");
        process.exit(0);
    }

    const javaHome = findJdk();
    if (!javaHome) {
        console.log("SKIP: no JDK >= 21 found (firebase-tools requires Java 21+).");
        console.log("      Set JAVA_HOME to a JDK 21+ installation and re-run.");
        process.exit(0);
    }

    const workdir = mkdtempSync(join(tmpdir(), "rtdb-rules-"));
    writeFileSync(
        join(workdir, "firebase.json"),
        JSON.stringify(
            {
                database: [{ instance: NAMESPACE, rules: RULES_FILE }],
                emulators: {
                    database: { host: "127.0.0.1", port: 9000 },
                    auth: { host: "127.0.0.1", port: 9099 },
                    ui: { enabled: false },
                    singleProjectMode: true,
                },
            },
            null,
            2
        )
    );
    writeFileSync(
        join(workdir, ".firebaserc"),
        JSON.stringify({ projects: { default: PROJECT_ID } }, null, 2)
    );

    console.log("RTDB rule probe — running against the Firebase emulator");
    console.log(`  rules:  ${RULES_FILE}`);
    console.log(`  workdir:${workdir}\n`);

    const child = spawn(
        "firebase",
        [
            "emulators:exec",
            "--only",
            "database,auth",
            "--project",
            PROJECT_ID,
            `node "${SELF}" --child`,
        ],
        {
            cwd: workdir,
            env: { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")}:${process.env.PATH ?? ""}` },
            stdio: "inherit",
        }
    );

    child.on("exit", (code) => process.exit(code ?? 1));
}

function hasFirebaseCli() {
    const probe = spawnSync("firebase", ["--version"], { stdio: "ignore" });
    return probe.status === 0;
}

/** Locate a JDK >= 21 (firebase-tools refuses older JVMs). */
function findJdk() {
    const candidates = [];
    if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
    for (const v of ["21", "24", "25"]) {
        candidates.push(`/opt/homebrew/opt/openjdk@${v}`);
        candidates.push(`/usr/libexec/java_home -v ${v}`);
    }

    for (const candidate of candidates) {
        if (candidate.includes(" ")) {
            const res = spawnSync(candidate, [], { stdio: "ignore" });
            const home = res.stdout?.toString().trim();
            if (home && isJdk21(home)) return home;
            continue;
        }
        if (existsSync(join(candidate, "bin", "java")) && isJdk21(candidate)) return candidate;
    }
    return null;
}

function isJdk21(javaHome) {
    const res = spawnSync(join(javaHome, "bin", "java"), ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
    const version = `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}`;
    const match = version.match(/version "(\d+)/);
    if (!match) return false;
    return Number(match[1]) >= 21;
}

// ─────────────────────────────────────────────────────────────────────────────
// Child process: the assertions themselves
// ─────────────────────────────────────────────────────────────────────────────
async function runChild() {
    const { initializeApp } = await import("firebase/app");
    const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
    const { getDatabase, connectDatabaseEmulator, ref, get, set, update, remove } = await import("firebase/database");

    const dbHost = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000").split(":")[0];
    const dbPort = Number((process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000").split(":")[1] ?? 9000);
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

    const app = initializeApp({
        projectId: PROJECT_ID,
        apiKey: "fake-api-key",
        databaseURL: `http://${dbHost}:${dbPort}?ns=${NAMESPACE}`,
    });
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const db = getDatabase(app);
    connectDatabaseEmulator(db, dbHost, dbPort);

    const results = [];
    const record = (name, expected, actual, detail = "") => {
        const pass = expected === actual;
        results.push({ name, expected, actual, pass, detail });
        console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (expected=${expected} actual=${actual})${detail ? "  " + detail : ""}`);
    };

    async function expectDenied(label, fn) {
        try {
            await fn();
            record(label, "denied", "allowed", "");
        } catch (e) {
            record(label, "denied", "denied", String((e && e.message) || e).slice(0, 80));
        }
    }
    async function expectAllowed(label, fn) {
        try {
            await fn();
            record(label, "allowed", "allowed", "");
        } catch (e) {
            record(label, "allowed", "denied", String((e && e.message) || e).slice(0, 120));
        }
    }

    /** Admin (rule-bypassing) seed/read against the emulator. */
    async function adminFetch(path, init = {}) {
        return fetch(`http://${dbHost}:${dbPort}/${path}.json?ns=${NAMESPACE}`, {
            ...init,
            headers: { "Content-Type": "application/json", Authorization: "Bearer owner", ...(init.headers ?? {}) },
        });
    }
    async function seed(path, value) {
        const res = await adminFetch(path, { method: "PUT", body: JSON.stringify(value) });
        if (!res.ok) throw new Error(`seed ${path} failed: ${res.status} ${await res.text()}`);
    }
    async function readAdmin(path) {
        const res = await adminFetch(path);
        return res.json();
    }

    /** Sign in as a specific emulator account (deterministic identity per group). */
    async function signInAs(uid) {
        const cred = await signInWithEmailAndPassword(auth, `${uid}@test.local`, "Password123!");
        if (cred.user.uid !== uid) throw new Error(`uid mismatch: ${cred.user.uid} != ${uid}`);
        return cred.user;
    }

    /** Create an emulator account with an EXPLICIT uid (the emulator otherwise randomises it). */
    async function mkUser(uid) {
        const res = await fetch(
            `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts?key=fake-api-key`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
                body: JSON.stringify({ localId: uid, email: `${uid}@test.local`, password: "Password123!" }),
            }
        );
        if (!res.ok) throw new Error(`createUser ${uid} failed: ${res.status} ${await res.text()}`);
        const cred = await signInWithEmailAndPassword(auth, `${uid}@test.local`, "Password123!");
        if (cred.user.uid !== uid) throw new Error(`uid mismatch: ${cred.user.uid} != ${uid}`);
        return cred.user;
    }

    try {
        // ── Fixtures (authoritative server-side state) ─────────────────────
        await seed("users/ownerA", { uid: "ownerA", role: "customer", email: "ownerA@test.local", subscription: { plan: "pro", status: "active" } });
        await seed("users/ownerB", { uid: "ownerB", role: "customer", email: "ownerB@test.local", subscription: { plan: "pro", status: "active" } });
        await seed("users/freeC", { uid: "freeC", role: "customer", email: "freeC@test.local" });

        await seed("bot_strategies/STRAT_1", { id: "STRAT_1", authorId: "ownerA", name: "Private A" });
        await seed("bot_strategies/STRAT_2", { id: "STRAT_2", authorId: "ownerB", name: "Private B" });
        await seed("bot_deployments/BOT_1", { id: "BOT_1", ownerId: "ownerA", strategyId: "STRAT_1", runtimeState: "running", mt5Account: "acct-A" });
        await seed("bot_deployments/BOT_2", { id: "BOT_2", ownerId: "ownerB", strategyId: "STRAT_2", runtimeState: "running", mt5Account: "acct-B" });
        await seed("bot_logs/BOT_1/LOG_1", { id: "LOG_1", botId: "BOT_1", level: "info", message: "secret-A" });
        await seed("bot_executions/BOT_1/BEXEC_1", { id: "BEXEC_1", botId: "BOT_1", status: "running" });
        await seed("bot_signals/BOT_1/SIG_1", { id: "SIG_1", botId: "BOT_1" });
        await seed("bot_audit/BOT_1/AUD_1", { id: "AUD_1", botId: "BOT_1" });
        await seed("bot_strategies_index/ownerA/STRAT_1", true);
        await seed("bot_strategies_index/ownerB/STRAT_2", true);
        await seed("bot_deployments_index/ownerA/BOT_1", true);
        await seed("bot_deployments_index/ownerB/BOT_2", true);
        await seed("subscriptions/ownerA/sub_1", { status: "active", plan: "pro" });
        await seed("candelSubscriptionEntitlements/ownerA", { pro: true });

        await mkUser("ownerA");
        await mkUser("ownerB");
        await mkUser("freeC");
        await signInAs("ownerA");

        // ── 1. Bot Studio trees are Admin-SDK only ─────────────────────────
        await expectDenied("ownerA cannot read bot_strategies/STRAT_1 (own strategy)", () => get(ref(db, "bot_strategies/STRAT_1")));
        await expectDenied("ownerA cannot read bot_strategies collection", () => get(ref(db, "bot_strategies")));
        await expectDenied("ownerA cannot write bot_strategies/STRAT_1", () => set(ref(db, "bot_strategies/STRAT_1"), { authorId: "ownerA", name: "hijack" }));
        await expectDenied("ownerA cannot read bot_deployments/BOT_1 (own deployment)", () => get(ref(db, "bot_deployments/BOT_1")));
        await expectDenied("ownerA cannot write bot_deployments/BOT_1", () => update(ref(db, "bot_deployments/BOT_1"), { runtimeState: "stopped" }));
        await expectDenied("ownerA cannot read bot_executions/BOT_1/BEXEC_1", () => get(ref(db, "bot_executions/BOT_1/BEXEC_1")));
        await expectDenied("ownerA cannot write bot_executions/BOT_1/BEXEC_1 (command injection)", () => set(ref(db, "bot_executions/BOT_1/BEXEC_1"), { status: "injected" }));
        await expectDenied("ownerA cannot read bot_logs/BOT_1/LOG_1", () => get(ref(db, "bot_logs/BOT_1/LOG_1")));
        await expectDenied("ownerA cannot write bot_logs/BOT_1/LOG_1", () => set(ref(db, "bot_logs/BOT_1/LOG_1"), { message: "spoof" }));
        await expectDenied("ownerA cannot read bot_signals/BOT_1/SIG_1", () => get(ref(db, "bot_signals/BOT_1/SIG_1")));
        await expectDenied("ownerA cannot read bot_audit/BOT_1/AUD_1", () => get(ref(db, "bot_audit/BOT_1/AUD_1")));

        // ── 2. Owner-scoped index trees ────────────────────────────────────
        await expectAllowed("ownerA can read bot_strategies_index/ownerA", () => get(ref(db, "bot_strategies_index/ownerA")));
        await expectDenied("ownerA cannot read bot_strategies_index/ownerB", () => get(ref(db, "bot_strategies_index/ownerB")));
        await expectDenied("ownerA cannot write bot_strategies_index/ownerA/STRAT_9", () => set(ref(db, "bot_strategies_index/ownerA/STRAT_9"), true));
        await expectAllowed("ownerA can read bot_deployments_index/ownerA", () => get(ref(db, "bot_deployments_index/ownerA")));
        await expectDenied("ownerA cannot read bot_deployments_index/ownerB", () => get(ref(db, "bot_deployments_index/ownerB")));
        await expectDenied("ownerA cannot write bot_deployments_index/ownerA/BOT_9", () => set(ref(db, "bot_deployments_index/ownerA/BOT_9"), true));

        // ── 3. Cross-user isolation on the users tree ───────────────────────
        await expectDenied("ownerA cannot read users/ownerB", () => get(ref(db, "users/ownerB")));
        await expectDenied("ownerA cannot write users/ownerB", () => update(ref(db, "users/ownerB"), { displayName: "pwn" }));
        await expectAllowed("ownerA can read own users/ownerA", () => get(ref(db, "users/ownerA")));

        // ── 4. Entitlement self-grant ──────────────────────────────────────
        await expectDenied("ownerA cannot write own users/ownerA/subscription (self Pro grant)", () =>
            update(ref(db, "users/ownerA/subscription"), { plan: "enterprise", status: "active" })
        );
        await expectDenied("ownerA cannot delete own users/ownerA/subscription", () =>
            remove(ref(db, "users/ownerA/subscription"))
        );
        await expectDenied("ownerA cannot write own users/ownerA/developerSubscription", () =>
            set(ref(db, "users/ownerA/developerSubscription"), { plan: "dev_pro", status: "active" })
        );
        await expectDenied("ownerA cannot write own users/ownerA/developerPlan (paid plan)", () =>
            set(ref(db, "users/ownerA/developerPlan"), "dev_pro")
        );
        await expectAllowed("ownerA can claim the FREE developer plan (developer subscription page)", () =>
            set(ref(db, "users/ownerA/developerPlan"), "dev_starter")
        );
        await expectDenied("ownerA cannot drop the server-authored subscription by replacing the whole user node", () =>
            set(ref(db, "users/ownerA"), {
                uid: "ownerA",
                email: "ownerA@test.local",
                displayName: "Owner A",
                role: "customer",
                createdAt: Date.now(),
            })
        );
        await mkUser("newbieD");
        await signInAs("newbieD");
        await expectAllowed("a brand new user can register a profile with a full node write (register page)", () =>
            set(ref(db, "users/newbieD"), {
                uid: "newbieD",
                email: "newbieD@test.local",
                displayName: "Newbie D",
                role: "customer",
                createdAt: Date.now(),
            })
        );
        await signInAs("ownerA");

        // ── 5. Privilege escalation via role ────────────────────────────────
        await expectDenied("ownerA cannot set own role to admin", () => set(ref(db, "users/ownerA/role"), "admin"));
        await expectDenied("ownerA cannot set own role to admin via parent write", () =>
            set(ref(db, "users/ownerA"), { uid: "ownerA", role: "admin", subscription: { plan: "enterprise", status: "active" } })
        );

        // ── 6. Legitimate client writes still work ─────────────────────────
        await expectAllowed("ownerA can set own role to customer (register page)", () => set(ref(db, "users/ownerA/role"), "customer"));
        await expectAllowed("ownerA can update own risk settings (account settings page)", () =>
            update(ref(db, "users/ownerA"), { riskPerTrade: 1.5, maxDrawdownAlert: 10 })
        );
        await expectAllowed("ownerA can write own notes (account tools page)", () => set(ref(db, "users/ownerA/notes/n1"), { text: "hello" }));
        await expectAllowed("ownerA can update own displayName (register page set)", () =>
            update(ref(db, "users/ownerA"), { displayName: "Owner A" })
        );

        // ── 7. Entitlement trees are server-only ───────────────────────────
        await expectDenied("ownerA cannot write subscriptions/ownerA", () =>
            set(ref(db, "subscriptions/ownerA/sub_1"), { status: "active", plan: "pro" })
        );
        await expectDenied("ownerA cannot write candelSubscriptionEntitlements/ownerA", () =>
            set(ref(db, "candelSubscriptionEntitlements/ownerA"), { pro: true })
        );

        // ── 8. Non-Pro user ────────────────────────────────────────────────
        await signInAs("freeC");
        await expectDenied("freeC cannot read bot_strategies", () => get(ref(db, "bot_strategies")));
        await expectDenied("freeC cannot write bot_strategies", () => set(ref(db, "bot_strategies/STRAT_3"), { authorId: "freeC" }));
        await expectDenied("freeC cannot read bot_deployments", () => get(ref(db, "bot_deployments")));
        await expectDenied("freeC cannot write bot_deployments", () => set(ref(db, "bot_deployments/BOT_3"), { ownerId: "freeC" }));
        await expectDenied("freeC cannot grant self Pro via subscription write", () =>
            update(ref(db, "users/freeC/subscription"), { plan: "pro", status: "active" })
        );
        await expectDenied("freeC cannot write own role to admin", () => set(ref(db, "users/freeC/role"), "admin"));

        // ── 9. Unauthenticated ─────────────────────────────────────────────
        await auth.signOut();
        await expectDenied("anonymous cannot read bot_strategies", () => get(ref(db, "bot_strategies")));
        await expectDenied("anonymous cannot read users/ownerA", () => get(ref(db, "users/ownerA")));
        await expectDenied("anonymous cannot write bot_deployments", () => set(ref(db, "bot_deployments/BOT_9"), {}));

        // ── 10. Authoritative state is unchanged by client attempts ────────
        const subA = await readAdmin("users/ownerA/subscription");
        const roleA = await readAdmin("users/ownerA/role");
        record(
            "users/ownerA/subscription unchanged by client attempts (server-authored only)",
            JSON.stringify({ plan: "pro", status: "active" }),
            JSON.stringify(subA)
        );
        record("users/ownerA/role not escalated to admin", "customer", String(roleA));
        const botA = await readAdmin("bot_deployments/BOT_1");
        record("bot_deployments/BOT_1 runtimeState not tampered by client", "running", String(botA && botA.runtimeState));

        const failed = results.filter((r) => !r.pass);
        console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
        if (failed.length) {
            console.log("FAILURES:");
            for (const f of failed) console.log(` - ${f.name}: expected ${f.expected}, got ${f.actual} ${f.detail}`);
        }
        process.exit(failed.length ? 1 : 0);
    } catch (error) {
        console.error("RTDB rule probe failed to run:", error);
        process.exit(2);
    }
}

if (process.argv.includes("--child")) {
    await runChild();
} else {
    await runParent();
}
