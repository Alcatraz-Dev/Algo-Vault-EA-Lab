/**
 * AlgoVault — MT5 position-accounting mode.
 *
 * MT5 accounts differ in how positions on one symbol are accounted:
 *
 *   • HEDGING  — opposing LONG and SHORT positions can exist independently on
 *                the same symbol. Two bots (or two lanes of one bot) may hold
 *                opposite positions at the same time.
 *   • NETTING  — all exposure on a symbol is one net position. An opposing
 *                order does not open a second position; it REDUCES or
 *                REVERSES the existing one.
 *   • EXCHANGE — exchange-style accounting; AlgoVault does not model it.
 *
 * The distinction is safety-critical: submitting what the user believes is a
 * hedge on a netting account silently closes their existing position. This
 * module never guesses. The mode comes from authoritative MT5 account
 * metadata (`ACCOUNT_TRADE_MODE` / `ACCOUNT_MARGIN_MODE`), is normalised here,
 * and anything unrecognised becomes UNKNOWN — which fails closed.
 *
 * No I/O in this module: it is pure so every rule can be unit-tested.
 */

/**
 * Normalised accounting mode.
 *
 * UNKNOWN is a first-class value, not an error fallback: an account whose mode
 * has not been reported must not be traded as if it were hedging.
 */
export type TradingPositionMode = "HEDGING" | "NETTING" | "EXCHANGE" | "UNKNOWN";

/**
 * MT5 `ENUM_ACCOUNT_MARGIN_MODE` values as reported by `AccountInfoInteger`.
 * Kept as numbers so the gateway can send the raw terminal value.
 */
export const MT5_MARGIN_MODE = {
    RETAIL_NETTING: 0,
    EXCHANGE: 1,
    RETAIL_HEDGING: 2,
} as const;

/** MT5 `ENUM_ACCOUNT_TRADE_MODE` values (demo/contest/real). Not the margin mode. */
export const MT5_TRADE_MODE = {
    DEMO: 0,
    CONTEST: 1,
    REAL: 2,
} as const;

/**
 * Parse a position mode from whatever the gateway reported.
 *
 * Accepts the raw MT5 margin-mode number, a numeric string, or an
 * already-normalised name. Returns UNKNOWN for anything else — including the
 * MT5 *trade* mode values, which are frequently confused with margin mode.
 */
export function normalizePositionMode(input: unknown): TradingPositionMode {
    if (input === null || input === undefined || input === "") return "UNKNOWN";

    if (typeof input === "number" && Number.isFinite(input)) {
        switch (input) {
            case MT5_MARGIN_MODE.RETAIL_HEDGING:
                return "HEDGING";
            case MT5_MARGIN_MODE.RETAIL_NETTING:
                return "NETTING";
            case MT5_MARGIN_MODE.EXCHANGE:
                return "EXCHANGE";
            default:
                return "UNKNOWN";
        }
    }

    const text = String(input).trim().toUpperCase();
    if (!text) return "UNKNOWN";

    if (/^\d+$/.test(text)) return normalizePositionMode(Number(text));

    if (text === "HEDGING" || text === "HEDGED" || text === "RETAIL_HEDGING") return "HEDGING";
    if (text === "NETTING" || text === "RETAIL_NETTING") return "NETTING";
    if (text === "EXCHANGE") return "EXCHANGE";

    return "UNKNOWN";
}

/**
 * True only for modes where two independent opposing positions may be open on
 * the same symbol at the same time.
 *
 * EXCHANGE and UNKNOWN are deliberately false: an unmodelled or unreported
 * account must never be treated as hedge-capable.
 */
export function supportsIndependentOpposingPositions(mode: TradingPositionMode): boolean {
    return mode === "HEDGING";
}

/** Short, honest explanation for the Trading Terminal / bot UI. */
export function describePositionMode(mode: TradingPositionMode): string {
    switch (mode) {
        case "HEDGING":
            return "Hedging account — long and short positions can be open independently on the same symbol.";
        case "NETTING":
            return "Netting account — one net position per symbol. An opposing order reduces or reverses the existing position, so simultaneous long and short entries are blocked.";
        case "EXCHANGE":
            return "Exchange-style position accounting — not supported for independent opposing positions.";
        default:
            return "Position accounting mode has not been reported by the terminal. Simultaneous opposing entries are blocked until it is known.";
    }
}

export interface OpposingEntryRequest {
    /** Account mode reported by MT5 (authoritative). */
    mode: TradingPositionMode;
    /** Side the strategy wants to open. */
    side: "long" | "short";
    /** Open positions on this symbol, by side, according to the gateway. */
    openLong: number;
    openShort: number;
}

export type OpposingEntryPolicy =
    /** Mode supports independent opposing positions; the entry may proceed. */
    | "independent"
    /** Correct or harmless: there is no opposite exposure to collide with. */
    | "no_conflict"
    /** Netting: any existing position on the symbol would be reduced/reversed. */
    | "netting_blocked"
    /** Unmodelled or unknown accounting: fail closed. */
    | "unknown_blocked";

export interface OpposingEntryDecision {
    allowed: boolean;
    policy: OpposingEntryPolicy;
    reason: string;
}

/**
 * Decide whether an entry may be submitted without colliding with existing
 * exposure on the same symbol.
 *
 * The rule is intentionally conservative:
 *   • HEDGING with opposite exposure → allowed (that is the point of hedging).
 *   • No exposure at all             → allowed in every mode.
 *   • Any exposure in a non-hedging mode → blocked, because the broker would
 *     net it against the open position instead of opening a second one.
 *
 * Callers must treat `allowed: false` as "do not submit", never as "submit the
 * opposite order to net out".
 */
export function decideOpposingEntry(request: OpposingEntryRequest): OpposingEntryDecision {
    const { mode, side, openLong, openShort } = request;
    const openSameSide = side === "long" ? openLong : openShort;
    const openOpposite = side === "long" ? openShort : openLong;
    const totalOpen = openLong + openShort;

    if (supportsIndependentOpposingPositions(mode)) {
        return openOpposite > 0
            ? {
                  allowed: true,
                  policy: "independent",
                  reason: describePositionMode(mode),
              }
            : {
                  allowed: true,
                  policy: "no_conflict",
                  reason: describePositionMode(mode),
              };
    }

    // Non-hedging: a flat symbol is safe in any mode.
    if (totalOpen === 0) {
        return {
            allowed: true,
            policy: "no_conflict",
            reason: "No open position on this symbol, so the entry cannot reduce or reverse one.",
        };
    }

    if (mode === "NETTING") {
        return {
            allowed: false,
            policy: "netting_blocked",
            reason:
                openOpposite > 0
                    ? `Netting account: the open ${side === "long" ? "short" : "long"} position would be reduced or reversed, not hedged.`
                    : `Netting account: a ${side} entry would net against the existing ${openSameSide} position on this symbol.`,
        };
    }

    return {
        allowed: false,
        policy: "unknown_blocked",
        reason: describePositionMode(mode),
    };
}

/**
 * True when the account cannot express the requested behaviour and the UI must
 * explain the restriction instead of showing an independent-positions claim.
 */
export function positionModeRestrictsDirection(mode: TradingPositionMode): boolean {
    return !supportsIndependentOpposingPositions(mode);
}
