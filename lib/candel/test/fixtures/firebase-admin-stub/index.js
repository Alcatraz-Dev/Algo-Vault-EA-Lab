// Credential-free stub for the Firebase Admin SDK.
// The real firebase-admin package ships an initializer that throws without
// full credentials. We replace it so the Candel SDK code can be imported with
// NO real credentials and NO network. The Candel authorization + database
// logic is the REAL application code.
//
// Surface required by lib/candel:
//   adminAuth.getUser(uid) -> { uid, customClaims? }
//   adminDatabase.ref(path) -> { get(), set(), push(), remove(),
//     orderByChild().equalTo() }
//
// Import resolution: lib/firebase-admin.ts imports "firebase-admin/app",
// "firebase-admin/auth", "firebase-admin/database". This index.js is the
// resolved module for all three. We re-export the same surface from every
// entry so `firebase-admin/app` also provides adminAuth/adminDatabase.

import { database } from "./database.js";
import { auth } from "./auth.js";

const shared = {
  adminAuth: { getAuth: () => auth },
  adminDatabase: database,
  initializeApp: () => ({ name: "[candel-test-fixture]" }),
  getApps: () => [{ name: "[candel-test-fixture]" }],
  cert: () => ({}),
  getAuth: () => auth,
  getDatabase: (app) => database,
};

export const adminAuth = shared.adminAuth;
export const adminDatabase = shared.adminDatabase;
export const initializeApp = shared.initializeApp;
export const getApps = shared.getApps;
export const cert = shared.cert;

// firebase-admin/app entry
export { getApps as getApps } from "./index.js";
export const getApp = () => ({ name: "[candel-test-fixture]" });
export const deleteApp = () => {};
export const applicationDefault = () => ({ getAccessToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });
export const refreshToken = () => ({ getToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });

// firebase-admin/auth entry
export const getAuth = (app) => auth;

// firebase-admin/database entry
export { getDatabase } from "./database.js";

console.log("[candel-test] firebase-admin stub loaded (no credentials, no network)");
