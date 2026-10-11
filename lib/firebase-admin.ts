import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";

function getAdminApp(): App {
    if (getApps().length > 0) {
        return getApps()[0];
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const rawKey = process.env.FIREBASE_PRIVATE_KEY;
    const databaseURL =
        process.env.FIREBASE_DATABASE_URL ||
        process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
        (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);

    const missing: string[] = [];
    if (!projectId) missing.push("FIREBASE_PROJECT_ID");
    if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!rawKey) missing.push("FIREBASE_PRIVATE_KEY");
    if (!databaseURL) missing.push("NEXT_PUBLIC_FIREBASE_DATABASE_URL");

    if (missing.length > 0) {
        throw new Error(
            `Missing Firebase Admin environment variables: ${missing.join(", ")}. Please configure them in your server environment.`
        );
    }

    let privateKey = rawKey!.trim();
    if (
        (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
        (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
        privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n").replace(/\r/g, "");

    return initializeApp({
        credential: cert({
            projectId: projectId!,
            clientEmail: clientEmail!,
            privateKey,
        }),
        databaseURL,
    });
}

let _auth: Auth | null = null;
let _db: Database | null = null;

export const adminAuth = new Proxy({} as Auth, {
    get(_target, prop) {
        if (!_auth) {
            _auth = getAuth(getAdminApp());
        }
        const val = (_auth as any)[prop];
        return typeof val === "function" ? val.bind(_auth) : val;
    },
});

export const adminDatabase = new Proxy({} as Database, {
    get(_target, prop) {
        if (!_db) {
            _db = getDatabase(getAdminApp());
        }
        const val = (_db as any)[prop];
        return typeof val === "function" ? val.bind(_db) : val;
    },
});