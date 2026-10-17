/**
 * Response shape returned by the growth cron job endpoints (`runGrowthJob`
 * via the cron dispatcher). Only an explicit `ok: true` is a success.
 */
export type GrowthJobResponse = {
    ok?: boolean;
    duplicate?: boolean;
    result?: { summary?: string };
    error?: string;
};

export type GrowthJobOutcome = {
    kind: "ok" | "info" | "error";
    message: string;
};

export type GrowthJobMessages = {
    success: string;
    duplicate: string;
    failure: string;
};

/**
 * Interprets a job response. Order matters: an explicit success wins, a
 * deduplicated request is reported as "nothing re-run" (never as success), and
 * everything else (ok: false, a failed job, a missing or malformed body) is an error.
 */
export function describeGrowthJobOutcome(
    response: GrowthJobResponse | null | undefined,
    messages: GrowthJobMessages,
): GrowthJobOutcome {
    const res = response ?? {};
    if (res.ok === true) {
        return { kind: "ok", message: res.result?.summary || messages.success };
    }
    if (res.duplicate === true) {
        return { kind: "info", message: messages.duplicate };
    }
    return { kind: "error", message: res.error || messages.failure };
}
