/**
 * Privacy-consent gate for extension sign-in.
 *
 * Chrome Web Store User Data policy requires prominent in-product disclosure
 * AND explicit consent before handling user data — a privacy-policy link
 * alone is not enough. Both sign-in entry paths (popup `LoginView` and the
 * side-panel login) collect this consent with an unchecked-by-default
 * checkbox and must refuse to attempt sign-in until it is given.
 *
 * This module is intentionally dependency-free so the gating rule stays a
 * single pure function shared by every entry path — and unit-verifiable
 * without a component test harness.
 */

/** Path of the public Privacy Policy on the AlgoVault website. */
export const PRIVACY_POLICY_PATH = "/privacy";

export interface SignInGate {
  email: string;
  password: string;
  consentGiven: boolean;
  loading: boolean;
}

/**
 * True only when a sign-in attempt may proceed: credentials present,
 * explicit data-handling consent given, and no request already in flight.
 * Clicking the Privacy Policy link must never count as consent — only the
 * checkbox state passed as `consentGiven` does.
 */
export function canAttemptSignIn(gate: SignInGate): boolean {
  if (gate.loading) return false;
  if (!gate.consentGiven) return false;
  if (gate.email.length === 0 || gate.password.length === 0) return false;
  return true;
}
