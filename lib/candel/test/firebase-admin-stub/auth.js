// Stub firebase-admin/auth surface (in-memory pretend identities only).
// No real credentials, no network. Server-side identity is simulated by the
// test harness via globalThis._candelHarness; the Candel authorization logic
// is the real application code.
//
// The Candel codebase imports `getAuth` from `firebase-admin/auth` and calls
// `getAuth(adminApp)` (lib/firebase-admin.ts). So this module exports
// `getAuth` as a function (real firebase-admin/auth semantics) that returns
// the fake auth service. The fake service exposes .getUser(uid) which the
// real Candel code calls.
//
// Also re-export the auth service object directly so the stub index.js can
// bind `adminAuth = getAuth()`.

let _service = null;

export function getAuth(app) {
  if (!_service) _service = fakeAuth;
  return _service;
}

const fakeAuth = {
  getUid: () => null,
  verifyIdToken: async () => ({ uid: "test-user", email: "test@example.com" }),
  getAuth: () => fakeAuth,
  getUser: (uid) => {
    const harness = globalThis._candelHarness;
    if (!harness || !harness.auth) {
      return Promise.reject(new Error("[candel-test] no test harness injected; cannot authenticate"));
    }
    const fake = harness.auth;
    if (uid === "unauthorized") throw new Error("[candel-test] unauthorized identity");
    return Promise.resolve({
      uid: fake.uid,
      customClaims: fake.uid === "admin-user" ? { admin: true } : undefined,
    });
  },
};

console.log("[candel-test] firebase-admin/auth stub loaded (no credentials, no network)");
