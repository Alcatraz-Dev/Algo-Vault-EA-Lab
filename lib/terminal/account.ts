/**
 * Account mode derivation (Phase 5 — paper/live separation).
 *
 * Pure so the labelling rule can be unit-tested without mounting the data
 * provider: this badge gates every live action in the terminal, so getting it
 * backwards is the failure mode that costs money.
 */

/**
 * Account mode from the connected gateway record.
 *
 * Deliberately asymmetric: an account is only called PAPER when the record
 * itself says so (demo/trial server, explicit demo flag). Otherwise it is
 * treated as LIVE, because mislabelling a real account as simulated is the
 * failure mode that costs money.
 */
export function deriveAccountMode(acc: Record<string, unknown>): "paper" | "live" {
    const haystack = [acc.server, acc.broker, acc.type, acc.environment, acc.mt5Account, acc.account_id]
        .map((v) => String(v ?? ""))
        .join(" ");
    if (acc.demo === true || /\b(demo|trial|practice|simulation)\b/i.test(haystack)) return "paper";
    return "live";
}
