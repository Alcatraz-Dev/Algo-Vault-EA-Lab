/**
 * GROWTH ADMIN JOB OUTCOME SUITE.
 *
 * Verifies that the Admin Analysis and Affiliates pages only report success
 * when the cron job response explicitly says ok: true, and that failed and
 * deduplicated responses are described accurately.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { describeGrowthJobOutcome } from "@/components/growth/admin/job-outcome";

const s = createSuite("growth-admin-job-outcome");

const MESSAGES = {
    success: "Recorded.",
    duplicate: "Already completed; nothing re-run.",
    failure: "Did not complete.",
};

function runSuite(): boolean {
    s.section("1. Explicit success is the only success");
    const ok = describeGrowthJobOutcome({ ok: true, result: { summary: "Built 3 rows." } }, MESSAGES);
    s.check(ok.kind === "ok" && ok.message === "Built 3 rows.", "ok: true uses the job summary");
    const okNoSummary = describeGrowthJobOutcome({ ok: true }, MESSAGES);
    s.check(okNoSummary.kind === "ok" && okNoSummary.message === "Recorded.", "ok: true without summary uses the success message");

    s.section("2. Deduplicated requests are never reported as success");
    const dup = describeGrowthJobOutcome({ ok: false, duplicate: true }, MESSAGES);
    s.check(dup.kind === "info" && dup.message === MESSAGES.duplicate, "duplicate: true -> info, not ok");

    s.section("3. Failures and malformed bodies are errors");
    const failed = describeGrowthJobOutcome({ ok: false, error: "Handler exploded." }, MESSAGES);
    s.check(failed.kind === "error" && failed.message === "Handler exploded.", "ok: false with error -> error with that message");
    const bare = describeGrowthJobOutcome({ ok: false }, MESSAGES);
    s.check(bare.kind === "error" && bare.message === MESSAGES.failure, "ok: false without error -> failure message");
    const missing = describeGrowthJobOutcome(undefined, MESSAGES);
    s.check(missing.kind === "error", "missing body -> error");
    const empty = describeGrowthJobOutcome({}, MESSAGES);
    s.check(empty.kind === "error", "body without ok -> error (fail closed)");
    const stringOk = describeGrowthJobOutcome({ ok: "true" as unknown as boolean }, MESSAGES);
    s.check(stringOk.kind === "error", "non-boolean ok is not treated as success");

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = runSuite();
    process.exit(ok ? 0 : 1);
})();
