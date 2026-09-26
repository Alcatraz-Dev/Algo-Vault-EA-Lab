// TEMPORARY diagnostic 2: what real data is available for the health report.
import { readFileSync, appendFileSync } from "node:fs";

const LOG = "diagnose2.log";
function say(line: string) {
    appendFileSync(LOG, line + "\n");
}

async function main() {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (!m) continue;
        let value = m[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = value.replace(/\\n/g, "\n");
    }
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
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
    const db = getDatabase(app);

    // Full trading_accounts record, pretty printed.
    const accSnap = await db.ref("trading_accounts").get();
    const accounts = (accSnap.val() ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    say("\n=== FULL trading_accounts ===");
    say(JSON.stringify(accounts, null, 2).slice(0, 2500));

    say("\n=== FULL trading_positions ===");
    const posSnap = await db.ref("trading_positions").get();
    say(JSON.stringify(posSnap.val() ?? {}, null, 2).slice(0, 2000));

    say("\n=== live_accounts (peakEquity / drawdown source) ===");
    const liveSnap = await db.ref("live_accounts").get();
    const live = (liveSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
    say(`keys: [${Object.keys(live).join(", ")}]`);
    for (const [id, rec] of Object.entries(live).slice(0, 3)) {
        say(`  ${id}: balance=${rec.balance} equity=${rec.equity} peakEquity=${rec.peakEquity} drawdown=${rec.drawdown} mt5Account=${rec.mt5Account}`);
    }

    say("\n=== users/{uid} full keys ===");
    const usersSnap = await db.ref("users").get();
    const users = (usersSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
    for (const [uid, rec] of Object.entries(users)) {
        say(`  ${uid}: ${JSON.stringify(rec).slice(0, 400)}`);
    }

    say("\n=== aiSignals shape (sample) ===");
    const sigSnap = await db.ref("aiSignals").get();
    const sigs = (sigSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
    const ids = Object.keys(sigs);
    say(`count=${ids.length}`);
    const withResult = ids.filter((id) => sigs[id].result);
    say(`with result: ${withResult.length}`);
    for (const id of withResult.slice(0, 5)) {
        say(`  ${id}: ${JSON.stringify(sigs[id]).slice(0, 300)}`);
    }
    const results: Record<string, number> = {};
    for (const id of withResult) {
        const r = String(sigs[id].result ?? "").toLowerCase();
        results[r] = (results[r] ?? 0) + 1;
    }
    say(`result distribution: ${JSON.stringify(results)}`);

    process.exit(0);
}

main().catch((e) => {
    say(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(1);
});
