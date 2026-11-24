import { initializeApp, getApps } from "firebase/app";
import type { Auth } from "firebase/auth";
import { getAuth } from "firebase/auth";
import type { Database } from "firebase/database";
import { getDatabase } from "firebase/database";
import { missingFirebaseEnvNames } from "./firebase-env";

// Keep these as static `process.env.NEXT_PUBLIC_*` references. Next.js only
// inlines public env values into the client bundle for literal member access;
// dynamic lookup (process.env[name]) is undefined in the browser and causes
// the server and client to disagree about whether Firebase is configured.
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True when every public Firebase client env value is present. */
export function isFirebaseClientConfigured(): boolean {
    return missingFirebaseEnvNames(firebaseConfig).length === 0;
}

function getClientApp() {
    if (typeof window === "undefined") {
        throw new Error("Firebase client services cannot be accessed during server rendering.");
    }

    const missing = missingFirebaseEnvNames(firebaseConfig);
    if (missing.length > 0) {
        throw new Error(`Firebase client configuration is missing: ${missing.join(", ")}.`);
    }

    return getApps()[0] ?? initializeApp(firebaseConfig);
}

function lazyBrowserService<T extends object>(getService: () => T): T {
    return new Proxy({} as T, {
        get(_target, property) {
            const service = getService();
            const value = Reflect.get(service, property, service);
            return typeof value === "function" ? value.bind(service) : value;
        },
        getPrototypeOf() {
            return Object.getPrototypeOf(getService());
        },
        set(_target, property, value) {
            const service = getService();
            return Reflect.set(service, property, value, service);
        },
        has(_target, property) {
            return property in getService();
        },
    });
}

let authInstance: Auth | undefined;
let databaseInstance: Database | undefined;

export const auth = lazyBrowserService(
    () => (authInstance ??= getAuth(getClientApp())),
);
export const database = lazyBrowserService(
    () => (databaseInstance ??= getDatabase(getClientApp())),
);
