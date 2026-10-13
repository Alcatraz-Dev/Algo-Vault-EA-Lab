/**
 * AlgoVault desktop — shared auth session surface.
 *
 * Shared by the main process, preload bridge and (future) renderer. Pure data
 * + predicates; no Electron or Firebase imports here so it compiles under the
 * main-process `tsc --noEmit` project.
 */
/**
 * Decision rule: a "valid" session is signed-in AND alive. `expired` is a
 * terminal state the user must re-sign in through /login — it is NOT a
 * transient blank that falls through to defaults.
 */
export function isValidSession(state) {
    return state.state === "signed-in";
}
export function isExpiredSession(state) {
    return state.state === "expired";
}
export function isSignedOutSession(state) {
    return state.state === "signed-out";
}
