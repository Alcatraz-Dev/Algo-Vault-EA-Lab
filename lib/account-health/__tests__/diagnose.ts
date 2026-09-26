// TEMPORARY diagnostic: mint a real Firebase ID token and exercise the live
// account-health endpoints end to end, so the 401 and the data shape can both be
// observed rather than guessed at.
import { readFileSync, appendFileSync } from "node:fs";

const LOG = "diagnose.log";
function say(line: string) {
    appendFileSync(LOG, line + "\n");
    process.stdout.write(line + "\n");
}

async function main() {
    // Load .env.local the way Next does, including the escaped newlines in the
    // service-account private key (sourcing it in a shell mangles them).
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (!m) continue;
        let value = m[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = value.replace(/\\n/g, "\n");
    }

    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getDatabase } = await import("firebase-admin/database");

    const app = getApps().length
        ? getApps()[0]
        : initializeApp({
              credential: cert({
                  projectId: process.env.FIREBASE_PROJECT_ID,
                  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
              }),
              databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
          });
    const auth = getAuth(app);
    const db = getDatabase(app);

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    // ── Who exists, and who is an admin? ─────────────────────────────────────
    const usersSnap = await db.ref("users").get();
    const users = (usersSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
    const uids = Object.keys(users);
    say(`users: ${uids.length}`);

    let adminUid: string | null = null;
    for (const uid of uids) {
        if (users[uid]?.role === "admin") {
            adminUid = uid;
            break;
        }
    }
    say(`admin uid: ${adminUid ?? "(none found)"}`);
    for (const uid of uids.slice(0, 8)) {
        say(`  ${uid}  role=${users[uid]?.role ?? "-"}  email=${users[uid]?.email ?? "-"}`);
    }

    // ── The real data shape, straight from RTDB ──────────────────────────────
    say("\n--- trading_accounts / trading_positions shape (first 3 users) ---");
    for (const uid of uids.slice(0, 3)) {
        const snap = await db.ref(`trading_accounts/${uid}`).get();
        const accounts = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;
        say(`  ${uid}: accountIds = [${Object.keys(accounts).join(", ")}]`);
        for (const [id, rec] of Object.entries(accounts).slice(0, 2)) {
            say(`     ${id}: ${JSON.stringify(rec).slice(0, 300)}`);
        }
        const pos = await db.ref(`trading_positions/${uid}`).get();
        const byAccount = (pos.val() ?? {}) as Record<string, Record<string, unknown>>;
        say(`     positions grouped by accountId: [${Object.keys(byAccount).join(", ")}]`);
        for (const [id, tickets] of Object.entries(byAccount).slice(0, 1)) {
            const first = Object.entries(tickets)[0];
            if (first) say(`       ${id}/${first[0]}: ${JSON.stringify(first[1]).slice(0, 300)}`);
        }
    }

    say("\nusers/{uid} scalar fields:");
    for (const uid of uids.slice(0, 3)) {
        const u = users[uid];
        say(`  ${uid}: balance=${u?.balance ?? "-"} equity=${u?.equity ?? "-"} maxDrawdown=${u?.maxDrawdown ?? "-"}`);
    }

    // ── Mint a real ID token and call the live endpoints ─────────────────────
    if (!adminUid) {
        say("\nNo admin user found; stopping before token mint.");
        return;
    }

    const custom = await auth.createCustomToken(adminUid);
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: custom, returnSecureToken: true }),
        },
    );
    const body = (await res.json()) as { idToken?: string; error?: { message?: string } };
    if (!body.idToken) {
        say(`\nToken exchange failed: ${res.status} ${JSON.stringify(body.error)}`);
        return;
    }
    const claims = JSON.parse(Buffer.from(body.idToken.split(".")[1], "base64").toString());
    say(`\nminted ID token OK  aud=${claims.aud}  exp=${claims.exp}`);

    try {
        const decoded = await auth.verifyIdToken(body.idToken);
        say(`verifyIdToken OK -> uid ${decoded.uid}`);
    } catch (e) {
        say(`verifyIdToken FAILED -> ${e instanceof Error ? e.message : String(e)}`);
    }

    for (const path of ["/api/account-health", "/api/admin/account-health"]) {
        const r = await fetch(`http://localhost:3000${path}`, {
            headers: { Authorization: `Bearer ${body.idToken}` },
        });
        const text = await r.text();
        say(`\n${path} -> ${r.status}`);
        say("  " + text.slice(0, 900).replace(/\n/g, "\n  "));
    }

    process.exit(0);
}

main().catch((e) => {
    say(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(1);
});
