import { initializeApp, getApps } from "firebase/app";
import type { Auth } from "firebase/auth";
import { getAuth } from "firebase/auth";
import type { Database } from "firebase/database";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfig = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
] as const;

function getClientApp() {
    if (typeof window === "undefined") {
        throw new Error("Firebase client services cannot be accessed during server rendering.");
    }

    const missing = requiredConfig.filter((key) => !firebaseConfig[key]);
    if (missing.length > 0) {
        const envNames = missing.map((key) => `NEXT_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`);
        throw new Error(`Firebase client configuration is missing: ${envNames.join(", ")}.`);
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
