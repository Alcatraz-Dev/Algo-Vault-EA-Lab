/**
 * Version helpers for agents and teams (spec §40).
 * Kept free of I/O so they can be unit-tested and reused by the database
 * layer, the admin API and the UI alike.
 */

/** Increments a dotted version's patch segment: "1.0.0" → "1.0.1". */
export function nextVersion(version: string): string {
    const parts = String(version || "1.0.0").split(".");
    const major = parts[0] || "1";
    const minor = parts[1] || "0";
    const patch = parseInt(parts[2] || "0", 10);
    return `${major}.${minor}.${Number.isFinite(patch) ? patch + 1 : 1}`;
}

/** True when `candidate` is a syntactically valid dotted version. */
export function isVersionString(candidate: string): boolean {
    return /^\d+(\.\d+){0,2}$/.test(String(candidate || ""));
}
