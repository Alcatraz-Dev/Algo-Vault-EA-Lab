/**
 * Startup diagnostics.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle when Next starts,
 * so adding them while a dev server is running has no effect until it restarts.
 * Reporting the gap once at boot makes that obvious, instead of leaving the
 * browser to fail later with a Firebase configuration error.
 */

import { FIREBASE_CLIENT_ENV } from "@/lib/firebase-env";

export function register() {
    const missing = Object.values(FIREBASE_CLIENT_ENV).filter(
        (name) => !process.env[name]
    );

    if (missing.length === 0) return;

    console.warn(
        [
            "",
            "[env] Firebase client configuration is incomplete.",
            "[env] Missing from this process:",
            ...missing.map((name) => `  - ${name}`),
            "[env] Add them to .env.local in this directory, then restart the server",
            "[env] (NEXT_PUBLIC_* values are inlined at startup).",
            "",
        ].join("\n")
    );
}
