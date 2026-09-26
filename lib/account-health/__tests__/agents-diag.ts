import { readFileSync, appendFileSync } from "node:fs";

const LOG = "agents-diag.log";
function say(line: string) {
    appendFileSync(LOG, line + "\n");
    process.stdout.write(line + "\n");
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
    const app = getApps().length ? getApps()[0] : initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    });
    const db = getDatabase(app);

    const snap = await db.ref("agents").get();
    say(`agents exists=${snap.exists()}`);
    if (snap.exists()) {
        const val = snap.val() || {};
        say(`keys count=${Object.keys(val).length}`);
        const firstKeys = Object.keys(val).slice(0, 5);
        say(`first keys=${firstKeys.join(", ")}`);
        for (const k of firstKeys) {
            say(`  ${k}: ${JSON.stringify(val[k]).slice(0, 200)}`);
        }
    } else {
        say("No 'agents' node in RTDB. Checking deeper paths...");
        const allSnap = await db.ref("/").get();
        const allKeys = Object.keys(allSnap.exists() ? (allSnap.val() || {}) : {});
        say(`root nodes: ${allKeys.join(", ")}`);
    }
    process.exit(0);
}
main().catch((e) => { say(`ERROR: ${e}`); process.exit(1); });
