/**
 * The public Firebase client env contract, in one place.
 *
 * Kept free of the Firebase SDK so server startup (`instrumentation.ts`) can
 * validate the environment without pulling the client library into the boot
 * path. `lib/firebase.ts` builds its config object against this same key set,
 * so the two cannot disagree.
 */

export const FIREBASE_CLIENT_ENV = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    databaseURL: "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
} as const;

export type FirebaseClientConfigKey = keyof typeof FIREBASE_CLIENT_ENV;

/**
 * Env var names for the config values that are missing. Returns real names
 * (`NEXT_PUBLIC_FIREBASE_DATABASE_URL`), not mechanically derived ones.
 */
export function missingFirebaseEnvNames(
    config: Record<FirebaseClientConfigKey, string | undefined>
): string[] {
    return (Object.keys(FIREBASE_CLIENT_ENV) as FirebaseClientConfigKey[])
        .filter((key) => !config[key])
        .map((key) => FIREBASE_CLIENT_ENV[key]);
}
