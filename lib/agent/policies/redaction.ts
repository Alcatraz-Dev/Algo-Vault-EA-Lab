// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Central Secret Redaction
//
// Every string that leaves the agent boundary (tool output → model, tool output
// → log, AI prompt, AI response → persisted metadata) passes through
// `redactSecrets`. This is the executable form of the "never expose secrets to
// the model" rule: redaction happens in code, before any downstream consumer,
// not via prompt instructions.
//
// Design rules:
//  • Patterns are intentionally BROAD. A false positive (redacting something
//    that was not a secret) is acceptable; a false negative is not.
//  • The replacement never contains any fragment of the original value beyond
//    a fixed short prefix, so even a partial regex match cannot be reassembled.
//  • `deepRedact` walks objects/arrays so structured tool output is covered.
//  • Nothing here throws — redaction must never be able to break a request.
// ─────────────────────────────────────────────────────────────────────────────

/** A named redaction rule: `pattern` is replaced globally by `replacement`. */
interface RedactionRule {
    name: string;
    pattern: RegExp;
    replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
    {
        name: "bearer_token",
        // Runs FIRST so a JWT/opaque token after "Bearer"/"token" is cut here
        // with a clean marker instead of being partially consumed by later rules.
        pattern: /\b(Bearer|bearer|token|Token|TOKEN)\s+[A-Za-z0-9_\-./=+]{16,}\b/g,
        replacement: "$1 [REDACTED_TOKEN]",
    },
    {
        name: "jwt",
        // JWT: header.payload.signature (base64url segments) — catches bare JWTs.
        pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
        replacement: "[REDACTED_JWT]",
    },
    {
        name: "openai_style_key",
        pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
        replacement: "[REDACTED_API_KEY]",
    },
    {
        name: "stripe_key",
        pattern: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}\b/g,
        replacement: "[REDACTED_STRIPE_KEY]",
    },
    {
        name: "bot_token",
        // Telegram / Discord / Slack style bot tokens: 123456789:AAxxxx…
        pattern: /\b\d{6,}:[A-Za-z0-9_-]{25,}\b/g,
        replacement: "[REDACTED_BOT_TOKEN]",
    },
    {
        name: "firebase_stripe_etc_key",
        // Long opaque assignment-style keys, e.g. sk_live_..., AIza..., firebase
        // tokens, stripe keys, hex/base64 secrets assigned to a *secretish* name.
        pattern:
            /\b((?:api|secret|private|access|auth|client|refresh|session|sig|signature|webhook|service)[-_.]?key|password|passwd|pwd|secret|token|credential[s]?|firebase[-_.]?token|stripe[-_.]?key|telegram[-_.]?bot[-_.]?token|oauth[-_.]?client[-_.]?secret|sk_(?:live|test)_[A-Za-z0-9]+|rk_(?:live|test)_[A-Za-z0-9]+)\b[\s"'=:]{1,3}([^\s"'&,;\\)]{8,})/gi,
        replacement: "$1=[REDACTED]",
    },
    {
        name: "private_key_block",
        // PEM-ish blocks — match the header so the whole blob is cut at the start.
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        replacement: "[REDACTED_PRIVATE_KEY]",
    },
    {
        name: "certificate_block",
        pattern: /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        replacement: "[REDACTED_CERTIFICATE]",
    },
    {
        name: "aws_access_key",
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
        replacement: "[REDACTED_AWS_KEY]",
    },
    {
        name: "google_api_key",
        pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
        replacement: "[REDACTED_GOOGLE_KEY]",
    },
    {
        name: "firebase_database_secret",
        pattern: /\b[A-Za-z0-9_]{40,}(?=\s*(?:["']?databaseURL|["']?service_account))/gi,
        replacement: "[REDACTED]",
    },
    {
        name: "connection_string",
        // postgres://user:pass@host…, mongodb+srv://…, mysql://…, redis://…
        pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|ftp):\/\/[^\s"'<>@/]+:[^\s"'<>@/]+@[^\s"'<>]+/g,
        replacement: "$1://[REDACTED]@[host]",
    },
    {
        name: "authorization_header",
        pattern: /\b(Authorization|authorization)\s*:\s*[^\n\r]+/g,
        replacement: "$1: [REDACTED]",
    },
    {
        name: "cookie_header",
        pattern: /\b(Cookie|cookie|Set-Cookie|set-cookie)\s*:\s*[^\n\r]+/g,
        replacement: "$1: [REDACTED]",
    },
    {
        name: "github_token",
        pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
        replacement: "[REDACTED_GITHUB_TOKEN]",
    },
    {
        name: "npm_token",
        pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g,
        replacement: "[REDACTED_NPM_TOKEN]",
    },
    {
        name: "firebase_service_account_email",
        // firebase-admin-sdk@project.iam.gserviceaccount.com style identities
        pattern: /\b[\w.-]+@[\w.-]+\.iam\.gserviceaccount\.com\b/g,
        replacement: "[REDACTED_SERVICE_ACCOUNT]",
    },
];

/**
 * Redact secrets from a string. Applies every rule in order; later rules see
 * the already-redacted text, which is safe because replacements never re-match.
 */
export function redactSecrets(input: string): string {
    if (typeof input !== "string" || input === "") return input;
    let out = input;
    for (const rule of REDACTION_RULES) {
        try {
            out = out.replace(rule.pattern, rule.replacement);
        } catch {
            // A malformed rule must never break the caller — skip it.
        }
    }
    return out;
}

const MAX_DEEP_DEPTH = 12;

/**
 * Deep-redact an object/array in place-safe form: returns a new structure whose
 * string leaves have been scrubbed. Non-string scalars pass through untouched.
 */
export function deepRedact<T>(value: T, depth = 0): T {
    if (depth > MAX_DEEP_DEPTH) return value;
    if (typeof value === "string") return redactSecrets(value) as unknown as T;
    if (Array.isArray(value)) {
        return value.map((item) => deepRedact(item, depth + 1)) as unknown as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            // Redact the key name itself too (keys can leak intent, rarely values).
            out[redactSecrets(key)] = deepRedact(val, depth + 1);
        }
        return out as unknown as T;
    }
    return value;
}

/** Redact an error into a safe, single-line message. */
export function redactErrorForLog(error: unknown): string {
    const raw =
        error instanceof Error
            ? `${error.name}: ${error.message}`
            : typeof error === "string"
              ? error
              : "Unknown error";
    return redactSecrets(raw.replace(/\s+/g, " ").slice(0, 500));
}

/**
 * Keys that must be fully removed (not just value-redacted) from persisted
 * structures — their PRESENCE is the leak (e.g. a field literally carrying a
 * credential object). Used before writing run records to RTDB.
 */
const FORBIDDEN_KEYS: string[] = [
    "privatekey",
    "private_key",
    "secretaccesskey",
    "serviceaccount",
    "clientsecret",
    "apikey",
    "api_key",
    "password",
    "passwd",
    "cookie",
    "cookies",
    "authorization",
];

/** True when a key name is forbidden from persistence regardless of its value. */
export function isForbiddenKeyName(key: string): boolean {
    return FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[\s_-]/g, ""));
}

/**
 * Strip forbidden-key entries entirely, redact everything else.
 * The executable version of "Do not persist secrets" for RTDB-bound records.
 */
export function sanitizeForPersistence<T>(value: T, depth = 0): T {
    if (depth > MAX_DEEP_DEPTH) return value;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForPersistence(item, depth + 1)) as unknown as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (isForbiddenKeyName(key)) continue; // dropped, not redacted
            out[key] = sanitizeForPersistence(val, depth + 1);
        }
        return out as unknown as T;
    }
    return typeof value === "string" ? (redactSecrets(value) as unknown as T) : value;
}
