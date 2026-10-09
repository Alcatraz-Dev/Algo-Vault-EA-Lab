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

// Dummy env vars so lib/firebase-admin.ts passes its own environment check
// WITHOUT touching any real credentials. The transform below replaces the
// actual firebase-admin family with an in-memory test-only surface.
process.env.FIREBASE_PROJECT_ID = "test";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "REDACTED_PRIVATE_KEY_PLACEHOLDER";
process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "https://test.firebaseio.com";
process.env.FIREBASE_DATABASE_URL = "https://test.firebaseio.com";

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
  alias: {
    "firebase-admin": "/tmp/firebase-stub/index.ts",
    "firebase-admin/app": "/tmp/firebase-stub/index.ts",
    "firebase-admin/auth": "/tmp/firebase-stub/index.ts",
    "firebase-admin/database": "/tmp/firebase-stub/index.ts",
  },
});

function loadTestModule() {
  return jiti.import(resolve(cwd, script)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

loadTestModule();

