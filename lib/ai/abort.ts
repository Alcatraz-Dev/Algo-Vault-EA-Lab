/**
 * Combine an optional caller signal with a provider timeout.
 *
 * The returned flags matter for error reporting: a user cancellation is not a
 * provider timeout, even though both abort the same underlying request.
 */
export function createAbortHandle(parent: AbortSignal | undefined, timeoutMs: number) {
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onAbort = () => {
        cancelled = true;
        controller.abort();
    };
    if (parent) {
        if (parent.aborted) onAbort();
        else parent.addEventListener("abort", onAbort, { once: true });
    }
    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        cancelled: () => cancelled,
        clear: () => {
            clearTimeout(timer);
            parent?.removeEventListener("abort", onAbort);
        },
    };
}
