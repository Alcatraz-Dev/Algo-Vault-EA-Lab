/**
 * Minimal 5-field cron parser (UTC).
 *
 * Supports:
 *   *                every field
 *   *\/n              step
 *   a-b              ranges
 *   a,b,c            lists
 *   a-b/step         range with step
 *
 * Field order: minute hour day-of-month month day-of-week
 * (standard). No 6th second field. All math in UTC.
 */

export interface CronExpression {
    minutes: CronField;
    hours: CronField;
    days: CronField;
    months: CronField;
    weekdays: CronField;
}

type CronField = Map<number, true>;

const FIELD_RANGES: Array<[keyof CronExpression, number, number]> = [
    ["minutes", 0, 59],
    ["hours", 0, 23],
    ["days", 1, 31],
    ["months", 1, 12],
    ["weekdays", 0, 6], // 0 = Sunday
];

export function parseCron(expression: string): CronExpression {
    const parts = String(expression || "").trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression "${expression}": expected 5 fields (minute hour day month weekday).`);
    }

    const parsed: CronExpression = {
        minutes: new Map(),
        hours: new Map(),
        days: new Map(),
        months: new Map(),
        weekdays: new Map(),
    };

    for (let i = 0; i < parts.length; i++) {
        const [key, min, max] = FIELD_RANGES[i];
        parsed[key] = parseField(parts[i], min, max, key === "weekdays");
    }

    return parsed;
}

function parseField(raw: string, min: number, max: number, weekday = false): CronField {
    const out = new Map<number, true>();
    const tokens = raw.split(",");
    for (const token of tokens) {
        const t = token.trim();
        if (!t) throw new Error(`Empty cron field token in "${raw}".`);

        const stepMatch = t.match(/^(.*)\/(\d+)$/);
        const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
        const body = stepMatch ? stepMatch[1] : t;

        let low: number;
        let high: number;
        if (body === "*") {
            low = min;
            high = max;
        } else {
            const rangeMatch = body.match(/^(\d+)(?:-(\d+))?$/);
            if (!rangeMatch) {
                // Allow Sunday aliases for weekday field (7 → 0)
                if (weekday && body === "7") {
                    const first = min;
                    const last = max + 1; // include 7 → mapped into 0
                    for (let v = first; v <= last; v += step) {
                        const mapped = v % 7;
                        if (mapped >= min && mapped <= max) out.set(mapped, true);
                    }
                    continue;
                }
                throw new Error(`Invalid cron token "${t}".`);
            }
            low = parseInt(rangeMatch[1], 10);
            high = rangeMatch[2] !== undefined ? parseInt(rangeMatch[2], 10) : low;
        }

        if (low < min || high > max || low > high) {
            throw new Error(`Cron value out of range in "${t}" (${min}-${max}).`);
        }

        for (let v = low; v <= high; v += step) {
            const mapped = weekday && v > max ? v % 7 : v;
            if (mapped >= min && mapped <= max) out.set(mapped, true);
        }
    }
    return out;
}

function matchesDate(expr: CronExpression, d: Date): boolean {
    const minute = d.getUTCMinutes();
    const hour = d.getUTCHours();
    const dom = d.getUTCDate();
    const month = d.getUTCMonth() + 1;
    const dow = d.getUTCDay();

    // Day-of-month and day-of-week are OR'd when both are restricted (Vixie-cron).
    return (
        expr.minutes.has(minute) &&
        expr.hours.has(hour) &&
        expr.months.has(month) &&
        (domMatch(expr.days, dom) || domMatch(expr.weekdays, dow))
    );
}

function domMatch(field: CronField, value: number): boolean {
    // An unrestricted field ("*") is represented by having every value.
    return field.has(value);
}

const MAX_SCAN_MS = 366 * 24 * 3600 * 1000; // up to a year ahead

/**
 * Returns the next scheduled timestamp strictly after `fromMs`, or null when
 * no match exists within the scan horizon.
 */
export function nextRunAt(expression: string, fromMs: number): number | null {
    const expr = parseCron(expression);
    // Start scanning from the next minute boundary.
    const start = new Date(fromMs);
    start.setUTCSeconds(0, 0);
    const cursor = new Date(start.getTime() + 60_000);
    const horizon = fromMs + MAX_SCAN_MS;

    while (cursor.getTime() <= horizon) {
        if (matchesDate(expr, cursor)) return cursor.getTime();
        cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }
    return null;
}

export function isValidCron(expression: string): boolean {
    try {
        parseCron(expression);
        return true;
    } catch {
        return false;
    }
}

/** Human readable summary for positive cron values, e.g. "Every 5 minutes". */
export function describeCron(expression: string): string {
    try {
        const [minute, hour, dom, month, dow] = String(expression).trim().split(/\s+/);
        const isWild = (f: string) => f === "*";
        if (minute === "*/5" && isWild(hour) && isWild(dom) && isWild(month) && isWild(dow)) return "Every 5 minutes";
        if (isWild(minute) && isWild(hour) && isWild(dom) && isWild(month) && isWild(dow)) return "Every minute";
        if (minute === "0" && isWild(hour) && isWild(dom) && isWild(month) && isWild(dow)) return "Every hour";
        if (minute === "0" && hour === "0" && isWild(dom) && isWild(month) && isWild(dow)) return "Every day at 00:00 UTC";
        return expression;
    } catch {
        return expression;
    }
}