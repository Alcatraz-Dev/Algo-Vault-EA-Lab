/** Memory repository reference — uses existing Firebase RTDB conventions. Not a new DB. */
export const MEMORY_PATHS = {
  userSetups: (uid: string) => `monitoring/setups/${uid}`,
  setupEvents: (uid: string, setupId: string) => `monitoring/setupEvents/${uid}/${setupId}`,
  setupHistory: (uid: string, setupId: string) => `monitoring/setupHistory/${uid}/${setupId}`,
};
export function validateSetupId(id: string): boolean {
  return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id) && id.length <= 64;
}
