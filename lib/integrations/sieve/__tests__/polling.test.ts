// Sieve polling — status handling, backoff, follow-up turn gating.

import { createSuite } from "./harness";
import {
    interpretRunStatus,
    nextPollDelay,
    hasTurnAdvanced,
    describeSchemaConformance,
    pollScrapeUntilSettled,
    followUpUntilAdvanced,
} from "../polling";
import { SieveError } from "../errors";
import type { SieveRun } from "../types";

function scriptedRun(states: SieveRun[]): () => Promise<SieveRun> {
    let i = 0;
    return async () => {
        const value = states[Math.min(i, states.length - 1)];
        i += 1;
        return value;
    };
}

export async function runPollingTests(): Promise<boolean> {
    const s = createSuite("sieve/polling");
    const noSleep = async (): Promise<void> => {};

    s.section("interpretRunStatus");
    s.check(interpretRunStatus("queued") === "running", "queued → running");
    s.check(interpretRunStatus("running") === "running", "running → running");
    s.check(interpretRunStatus("done") === "done", "done → done");
    s.check(interpretRunStatus("refused") === "refused", "refused → refused");
    s.check(interpretRunStatus("weird") === "unknown", "unknown string → unknown");
    s.check(interpretRunStatus(undefined) === "unknown", "undefined → unknown");
    s.check(interpretRunStatus("RUNNING") === "running", "case-insensitive");

    s.section("nextPollDelay (5s → 30s backoff)");
    s.check(nextPollDelay(0, 5000, 30000) === 5000, "first delay is 5s");
    s.check(nextPollDelay(5000, 5000, 30000) === 7500, "grows ×1.5");
    s.check(nextPollDelay(20000, 5000, 30000) === 30000, "caps at 30s");
    s.check(nextPollDelay(30000, 5000, 30000) === 30000, "stays capped");

    s.section("hasTurnAdvanced");
    s.check(hasTurnAdvanced(0, 1) === true, "0 → 1 advanced");
    s.check(hasTurnAdvanced(2, 2) === false, "same turn not advanced");
    s.check(hasTurnAdvanced(2, undefined) === false, "missing turns not advanced");
    s.check(hasTurnAdvanced(0, 0) === false, "0 → 0 not advanced");

    s.section("schema conformance is never clean on fail");
    s.check(describeSchemaConformance({ status: "pass" }).clean === true, "pass is clean");
    s.check(describeSchemaConformance({ status: "partial" }).clean === false, "partial is not clean");
    const fail = describeSchemaConformance({ status: "fail" });
    s.check(fail.clean === false, "fail is not clean");
    s.check(/not treat it as clean/i.test(fail.note), "fail note warns against clean presentation");
    s.check(describeSchemaConformance({ status: "not_checkable" }).clean === false, "not_checkable not clean");
    s.check(describeSchemaConformance({ status: "no_artifact" }).clean === false, "no_artifact not clean");
    s.check(describeSchemaConformance(undefined).clean === false, "missing conformance not clean");

    s.section("pollScrapeUntilSettled keeps polling then returns done");
    {
        const run = await pollScrapeUntilSettled("s1", {
            getScrape: scriptedRun([
                { session_id: "s1", status: "running", turns: 0 },
                { session_id: "s1", status: "running", turns: 0 },
                { session_id: "s1", status: "done", turns: 0, summary: "ok" },
            ]),
            sleep: noSleep,
            initialDelayMs: 5000,
            maxDelayMs: 30000,
        });
        s.check(run.status === "done" && run.summary === "ok", "returns the done run");
    }

    s.section("pollScrapeUntilSettled throws RUN_REFUSED");
    {
        let error: SieveError | undefined;
        try {
            await pollScrapeUntilSettled("s2", {
                getScrape: scriptedRun([{ session_id: "s2", status: "refused", refusal: { code: "quota" } } as SieveRun]),
                sleep: noSleep,
            });
        } catch (err) {
            error = err as SieveError;
        }
        s.check(error?.code === "RUN_REFUSED", "refused is terminal");
        s.check(Boolean(error?.message?.includes("quota")), "refusal code surfaced");
    }

    s.section("pollScrapeUntilSettled throws INVALID_STATUS");
    {
        let error: SieveError | undefined;
        try {
            await pollScrapeUntilSettled("s3", {
                getScrape: scriptedRun([{ session_id: "s3", status: "banana" }]),
                sleep: noSleep,
            });
        } catch (err) {
            error = err as SieveError;
        }
        s.check(error?.code === "INVALID_STATUS", "unrecognized status is an error, not success");
    }

    s.section("pollScrapeUntilSettled maxPolls guard");
    {
        let error: SieveError | undefined;
        try {
            await pollScrapeUntilSettled("s4", {
                getScrape: scriptedRun([{ session_id: "s4", status: "running" }]),
                sleep: noSleep,
                maxPolls: 3,
            });
        } catch (err) {
            error = err as SieveError;
        }
        s.check(error?.code === "TIMEOUT", "unbounded running stopped by maxPolls");
    }

    s.section("followUp waits for turns to advance");
    {
        let sendCount = 0;
        const run = await followUpUntilAdvanced(
            "s5",
            1,
            async () => {
                sendCount += 1;
            },
            {
                sleep: noSleep,
                getScrape: scriptedRun([
                    // done but the previous turn is still what's readable
                    { session_id: "s5", status: "done", turns: 1, summary: "old" },
                    { session_id: "s5", status: "done", turns: 2, summary: "new" },
                ]),
            },
        );
        s.check(sendCount === 1, "follow-up turn recorded once");
        s.check(run.turns === 2 && run.summary === "new", "reads the NEW answer only after turns advance");
    }

    s.section("followUp retries on 409 (turn in flight)");
    {
        let sendCount = 0;
        let sleeps = 0;
        const run = await followUpUntilAdvanced(
            "s6",
            0,
            async () => {
                sendCount += 1;
                if (sendCount === 1) throw new SieveError("TURN_IN_FLIGHT", "in flight");
            },
            {
                sleep: async () => {
                    sleeps += 1;
                },
                conflictRetryDelayMs: 5000,
                getScrape: scriptedRun([{ session_id: "s6", status: "done", turns: 1 }]),
            },
        );
        s.check(sendCount === 2, "resent after 409");
        s.check(sleeps >= 1, "waited before resending");
        s.check(run.status === "done", "settled after resend");
    }

    return s.finish();
}
