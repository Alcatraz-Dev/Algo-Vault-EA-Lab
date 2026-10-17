/**
 * GROWTH JOB RETRY SUITE.
 *
 * Regression coverage for the Growth Job claim lifecycle in
 * lib/growth/jobs/index.ts and lib/growth/database.ts:
 *  - a failed execution releases its claim so a legitimate retry can run,
 *  - a successful execution keeps its claim so the job never runs twice,
 *  - concurrent duplicates are blocked while a claim is live,
 *  - claim release is compare-and-release and never removes a newer claim.
 *
 * Handlers are local test doubles; no growth job touches real data.
 * Runs under the firebase-admin stub (scripts/jiti-tsrun.mjs).
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { acquireJobClaim, releaseJobClaim } from "@/lib/growth/database";
import { runGrowthJob, type JobHandlerResult } from "@/lib/growth/jobs";
import { rtDbStore } from "./firebase-admin-stub";

const s = createSuite("growth-job-retry");

const TTL_MS = 6 * 60 * 60 * 1000;
let keySeq = 0;

function freshKey(label: string): string {
    keySeq += 1;
    return `test:retry:${label}:${keySeq}`;
}

function claimPath(jobKey: string): string {
    return `${GROWTH_COLLECTIONS.jobs}/_claims/${jobKey}`;
}

function hasClaim(jobKey: string): boolean {
    const value = rtDbStore.get(claimPath(jobKey));
    return value !== undefined && value !== null;
}

function counterHandler(
    outcome: "ok" | "throw",
    counter: { calls: number }
): () => Promise<JobHandlerResult> {
    return async () => {
        counter.calls += 1;
        if (outcome === "throw") throw new Error("handler exploded");
        return { summary: "done" };
    };
}

async function runGrowthJobRegression(): Promise<boolean> {
    s.section("1. Failure followed by retry");
    {
        const key = freshKey("fail-retry");
        const first = { calls: 0 };
        const failed = await runGrowthJob({
            type: "test_job",
            jobKey: key,
            handler: counterHandler("throw", first),
        });
        s.check(
            !failed.ok && !failed.duplicate && failed.error === "handler exploded",
            "failed run returns ok:false, duplicate:false with the handler error"
        );
        s.check(first.calls === 1, "failed handler ran exactly once");
        s.check(!hasClaim(key), "failed run released its claim");

        const retry = { calls: 0 };
        const retried = await runGrowthJob({
            type: "test_job",
            jobKey: key,
            handler: counterHandler("ok", retry),
        });
        s.check(retried.ok && !retried.duplicate, "retry after failure runs (not deduplicated)");
        s.check(retry.calls === 1, "retry handler ran exactly once");
        s.check(hasClaim(key), "successful retry keeps its claim");
    }

    s.section("2. Successful job is deduplicated");
    {
        const key = freshKey("success-dedupe");
        const first = { calls: 0 };
        const ok = await runGrowthJob({ type: "test_job", jobKey: key, handler: counterHandler("ok", first) });
        s.check(ok.ok && !ok.duplicate && first.calls === 1, "first success runs the handler once");

        const again = { calls: 0 };
        const dup = await runGrowthJob({ type: "test_job", jobKey: key, handler: counterHandler("ok", again) });
        s.check(!dup.ok && dup.duplicate === true, "second request for a succeeded key is reported as duplicate");
        s.check(again.calls === 0, "duplicate request never runs the handler");
    }

    s.section("3. Concurrent duplicates are blocked while the claim is live");
    {
        const key = freshKey("concurrent");
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const counter = { calls: 0 };
        const slow = async (): Promise<JobHandlerResult> => {
            counter.calls += 1;
            await gate;
            return { summary: "slow done" };
        };

        const inFlight = runGrowthJob({ type: "test_job", jobKey: key, handler: slow });
        const concurrent = await runGrowthJob({
            type: "test_job",
            jobKey: key,
            handler: counterHandler("ok", { calls: 0 }),
        });
        s.check(concurrent.duplicate === true && !concurrent.ok, "concurrent request is reported as duplicate");

        release();
        const winner = await inFlight;
        s.check(winner.ok && counter.calls === 1, "only the original execution ran the handler");
    }

    s.section("4. Expired claims can be re-acquired");
    {
        const key = freshKey("expired");
        rtDbStore.set(claimPath(key), { claimedAt: Date.now() - TTL_MS - 1000, claimId: "claim-stale" });
        const claimId = await acquireJobClaim(key, TTL_MS);
        s.check(claimId !== null, "expired claim is taken over by a new acquire");
    }

    s.section("5. Claim cleanup is compare-and-release");
    {
        const key = freshKey("cas-release");
        const ownClaim = await acquireJobClaim(key, TTL_MS);
        s.check(ownClaim !== null, "acquire returns a claim token for the winner");

        const blocked = await acquireJobClaim(key, TTL_MS);
        s.check(blocked === null, "second acquire on a live claim returns null");

        const foreignRelease = await releaseJobClaim(key, "claim-from-another-execution");
        s.check(foreignRelease === false && hasClaim(key), "release with a foreign token leaves the claim in place");

        const ownRelease = await releaseJobClaim(key, ownClaim as string);
        s.check(ownRelease === true && !hasClaim(key), "release with the owning token removes the claim");
    }

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runGrowthJobRegression();
    process.exit(ok ? 0 : 1);
})();
