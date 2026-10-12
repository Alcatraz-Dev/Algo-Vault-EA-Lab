/**
 * AlgoVault desktop — shared auth session surface.
 *
 * Shared by the main process, preload bridge and (future) renderer. Pure data
 * + predicates; no Electron or Firebase imports here so it compiles under the
 * main-process `tsc --noEmit` project.
 */

/** Result of a Firebase session restore attempt. */
export type SessionState =
  | { state: "signed-in"; uid: string; email: string | null; isAdmin: boolean }
  | { state: "expired" }
  | { state: "signed-out"; error?: string };

/** Scope of a session: what the embedded web app may do. */
export interface SessionScope {
  uid: string;
  email: string | null;
  isAdmin: boolean;
  /** Nonce used to stamp a per-session credential so the next server can
   *  re-attribute requests without re-verifying. */
  nonce: string;
}

/**
 * Decision rule: a "valid" session is signed-in AND alive. `expired` is a
 * terminal state the user must re-sign in through /login — it is NOT a
 * transient blank that falls through to defaults.
 */
export function isValidSession(state: SessionState): boolean {
  return state.state === "signed-in";
}

export function isExpiredSession(state: SessionState): boolean {
  return state.state === "expired";
}

export function isSignedOutSession(state: SessionState): boolean {
  return state.state === "signed-out";
}
