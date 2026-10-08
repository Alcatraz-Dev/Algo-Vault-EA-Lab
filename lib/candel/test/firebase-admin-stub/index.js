// Combined stub entry point. `firebase-admin` resolves here when the harness
// puts this directory on the module resolution path.
import { database } from "./database.js";
import { getAuth } from "./auth.js";

// The Candel codebase does `import { getAuth } from "firebase-admin/auth"`
// then `getAuth(adminApp)` (lib/firebase-admin.ts). getAuth() returns the
// fake auth service, so adminAuth = getAuth(...).

export const adminAuth = getAuth;
export const adminDatabase = database;
export const initializeApp = () => ({ name: "[candel-test-fixture]" });
export const getApps = () => [{ name: "[candel-test-fixture]" }];
export const cert = () => ({ });
export const getApp = () => ({ name: "[candel-test-fixture]" });
export const deleteApp = () => {};
export const applicationDefault = () => ({ getAccessToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });
export const refreshToken = () => ({ getToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });

console.log("[candel-test] firebase-admin stub loaded (no credentials, no network)");
