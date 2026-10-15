import "server-only";

import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Database } from "firebase-admin/database";
import { getFirebaseAdminConfig } from "./firebase-admin-config";

function getAdminApp(): App {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getApps, initializeApp, cert } = require("firebase-admin/app");

    if (getApps().length > 0) {
        return getApps()[0];
    }

    const { projectId, clientEmail, rawPrivateKey, databaseURL } = getFirebaseAdminConfig();

    let privateKey = rawPrivateKey.trim();
    if (
        (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
        (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
        privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n").replace(/\r/g, "");

    return initializeApp({
        credential: cert({
            projectId,
            clientEmail,
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
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getAuth } = require("firebase-admin/auth");
            _auth = getAuth(getAdminApp());
        }
        const val = (_auth as any)[prop];
        return typeof val === "function" ? val.bind(_auth) : val;
    },
});

export const adminDatabase = new Proxy({} as Database, {
    get(_target, prop) {
        if (!_db) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getDatabase } = require("firebase-admin/database");
            _db = getDatabase(getAdminApp());
        }
        const val = (_db as any)[prop];
        return typeof val === "function" ? val.bind(_db) : val;
    },
});