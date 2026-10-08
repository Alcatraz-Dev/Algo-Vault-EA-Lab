// Stub firebase-admin/auth surface (in-memory pretend identities only).
// No real credentials, no network. Server-side identity is simulated by the
// test harness; the Candel authorization logic is the real application code.
export const auth = {
  getUid: () => null,
  verifyIdToken: async () => ({ uid: "test-user", email: "test@example.com" }),
};
export const getAuth = () => auth;
