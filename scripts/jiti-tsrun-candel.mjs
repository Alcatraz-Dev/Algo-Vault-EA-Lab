/**
 * scripts/jiti-tsrun-candel.mjs
 *
 * Custom jiti runner for the Candel SDK verification harness.
 *
 * Intercepts the firebase-admin family of modules so the Candel code can be
 * imported with NO real Firebase credentials and NO network. Only the Firebase
 * transport is stubbed; the Candel SDK logic is the real application code.
 */

import { createJiti } from "jiti";
import { resolve } from "node:path";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/jiti-tsrun-candel.mjs <test-file.ts>");
  process.exit(1);
}

const cwd = process.cwd();

// Simulated server-side identity surface used by the real Candel authorization
// logic. Everything from lib/candel/authorization.ts resolves to these.
const fakeAuth = {
  getUid: () => "test-user",
  verifyIdToken: async () => ({ uid: "test-user", email: "test@example.com" }),
};
const fakeDatabase = {
  ref: () => ({
    get: () => ({ val: () => ({}) }),
    set: async () => {},
    push: async () => ({ key: "test-key" }),
    remove: async () => {},
    orderByChild: () => ({ equalTo: () => ({ val: () => [] }) }),
  }),
};

const jiti = createJiti(cwd, {
  tsconfigPaths: true,
  jsx: true,
  moduleCache: false,
  transform(filename, code) {
    // Intercept the entire firebase-admin family BEFORE real credentials are
    // touched: every sibling module (app, auth, database, ...) imports
    // firebase-admin directly, so we replace it at the package root.
    if (
      filename.includes("firebase-admin") ||
      filename.includes("node_modules/firebase-admin") ||
      // lib/firebase-admin.ts re-exports firebase-admin surface.
      filename.endsWith("lib/firebase-admin.ts")
    ) {
      return {
        code: `
          // ── fake firebase-admin surface (test-only) ──────────────────────
          const fakeAuth = {
            getAuth: () => ({
              getUid: () => "test-user",
              verifyIdToken: async () => ({ uid: "test-user", email: "test@example.com" })
            })
          };
          const fakeDatabase = {
            ref: () => ({
              get: () => ({ val: () => ({}) }),
              set: async () => {},
              push: async () => ({ key: "test-key" }),
              remove: async () => {},
              orderByChild: () => ({ equalTo: () => ({ val: () => [] }) })
            }))
          };
          const fakeApp = {};
          export const adminAuth = fakeAuth;
          export const adminDatabase = fakeDatabase;
          export const adminApp = fakeApp;
          export const getApps = () => [{ name: "[candel-test-fixture]", ...fakeApp }];
          export const getApp = () => ({ name: "[candel-test-fixture]", ...fakeApp });
          export const initializeApp = () => ({ name: "[candel-test-fixture]", ...fakeApp });
          export const cert = () => ({ projectId: "test", clientEmail: "test@example.com", privateKey: "test" });
          export const deleteApp = () => {};
          export const applicationDefault = () => ({ getAccessToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });
          export const refreshToken = () => ({ getToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }) });
          export const getAuth = (app) => fakeAuth;
          export const getDatabase = (app) => fakeDatabase;
          export const deleteApp = () => {};
        `,
      };
    }
    return code;
  },
});

function loadTestModule() {
  return jiti.import(resolve(cwd, script)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

loadTestModule();

