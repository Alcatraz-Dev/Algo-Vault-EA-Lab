// Shared harness for Sieve tests (repo jiti-runner convention).

export function createSuite(name: string) {
    let passed = true;
    let count = 0;

    const check = (cond: boolean, label: string) => {
        count += 1;
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const section = (title: string) => {
        console.log(`\n--- ${title} ---`);
    };

    const finish = (): boolean => {
        console.log(`\n[${name}] ${count} checks`);
        return passed;
    };

    return { check, section, finish };
}

/** Temporarily replace global fetch (the HTTP boundary) and always restore it. */
export async function withFetch<T>(
    mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    fn: () => Promise<T>,
): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = mock as typeof fetch;
    try {
        return await fn();
    } finally {
        globalThis.fetch = original;
    }
}

/** Build a minimal Response-like object. */
export function jsonResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): Response {
    const text = body === undefined ? "" : JSON.stringify(body);
    return new Response(text, {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

export function abortError(): Error {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
}
