// Credential-free stub for the Firebase Admin SDK `app` entry point.
// Re-exports the complete stub surface (no circular dependency).

export * from "./index.js";

// firebase-admin/app needs getApp too
export const getApp = () => ({ name: "[candel-test-fixture]" });
export const deleteApp = () => {};
export const applicationDefault = () => ({
  getAccessToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }),
});
export const refreshToken = () => ({
  getToken: () => Promise.resolve({ access_token: "fake", expires_in: 3600 }),
});
