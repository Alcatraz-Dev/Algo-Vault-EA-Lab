/**
 * AlgoVault Pro Signal Intelligence - Signal Normalizer & Safety Validator
 */

import { DEFAULT_EXPIRATION_MINUTES } from "../config";
import { ParsedSignalResult } from "../parser/fast-parser";
import { computeSignalFingerprint } from "../signals/duplicate-detector";
import type {
    ProSignal,
    SignalStatus,
    SourceMetadata,
    LatencyMetadata,
} from "../types";

export interface NormalizationInput {
    rawMessageId: string;
    rawText: string;
    sourceMetadata: SourceMetadata;
    parsed: ParsedSignalResult;
    receivedAt: number;
    parsedAt: number;
    expirationMinutesOverride?: number;
}

export function normalizeAndValidateSignal(input: NormalizationInput): ProSignal {
    const normalizedAt = Date.now();
    const { parsed, receivedAt, parsedAt, sourceMetadata, rawMessageId } = input;

    const symbol = parsed.symbol || "UNKNOWN";
    const direction = parsed.direction || "BUY";
    const entryMin = parsed.entryMin ?? 0;
    const entryMax = parsed.entryMax ?? entryMin;
    const entry = Number(((entryMin + entryMax) / 2).toFixed(4));
    const stopLoss = parsed.stopLoss ?? 0;
    const takeProfits = parsed.takeProfits || [];
    const openTarget = parsed.openTarget ?? takeProfits.some((t) => t.type === "OPEN");
    const style = parsed.style && parsed.style !== "UNKNOWN" ? parsed.style : "INTRADAY";
    const timeframe = parsed.timeframe && parsed.timeframe !== "UNKNOWN" ? parsed.timeframe : "H1";

    const warnings = [...(parsed.warnings || [])];
    const errors = [...(parsed.errors || [])];

    // 1. Safety Validation Rules (§40)
    let status: SignalStatus = "CREATED";

    if (parsed.errors.length > 0) {
        status = "INVALID";
    } else if (direction === "BUY") {
        if (stopLoss >= entryMin && stopLoss > 0) {
            errors.push(`BUY Stop Loss (${stopLoss}) is higher than or equal to Entry (${entryMin})`);
            status = "INVALID";
        }
        for (const tp of takeProfits) {
            if (tp.type === "PRICE" && tp.price !== null && tp.price <= entryMax) {
                warnings.push(`BUY TP${tp.index} (${tp.price}) is below or equal to Entry (${entryMax})`);
            }
        }
    } else if (direction === "SELL") {
        if (stopLoss <= entryMax && stopLoss > 0) {
            errors.push(`SELL Stop Loss (${stopLoss}) is lower than or equal to Entry (${entryMax})`);
            status = "INVALID";
        }
        for (const tp of takeProfits) {
            if (tp.type === "PRICE" && tp.price !== null && tp.price >= entryMin) {
                warnings.push(`SELL TP${tp.index} (${tp.price}) is above or equal to Entry (${entryMin})`);
            }
        }
    }

    if (status !== "INVALID" && (warnings.length > 0 || parsed.confidence < 70)) {
        status = "NEEDS_REVIEW";
    }

    // 2. Compute Deterministic Fingerprint (§14)
    const tpPrices = takeProfits.map((t) => t.price);
    const fingerprint = computeSignalFingerprint(
        symbol,
        direction,
        entryMin,
        entryMax,
        stopLoss,
        tpPrices,
        sourceMetadata.sourceId,
        receivedAt
    );

    // 3. Expiration Time Calculation (§14)
    const expirationMinutes =
        input.expirationMinutesOverride ||
        DEFAULT_EXPIRATION_MINUTES[style] ||
        DEFAULT_EXPIRATION_MINUTES.UNKNOWN;

    const expirationAt = normalizedAt + expirationMinutes * 60 * 1000;

    // 4. Latency Metadata (§6)
    const latency: LatencyMetadata = {
        receivedAt,
        parsedAt,
        normalizedAt,
    };

    const signalId = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return {
        id: signalId,
        fingerprint,
        symbol,
        direction,
        entryType: parsed.entryType || "MARKET",
        entry,
        entryMin,
        entryMax,
        stopLoss,
        takeProfits,
        openTarget,
        style,
        timeframe,
        createdAt: normalizedAt,
        receivedAt,
        expirationAt,
        status,
        sourceMetadata,
        parserMetadata: {
            fastParsed: !parsed.errors.length,
            confidence: parsed.confidence,
            warnings,
            errors,
            aiUsed: false,
            detectedLanguage: parsed.detectedLanguage,
        },
        latency,
        rawMessageId,
        events: [
            {
                id: `evt_${Date.now()}_1`,
                signalId,
                type: "CREATED",
                timestamp: normalizedAt,
                metadata: { initialStatus: status },
            },
        ],
        lastUpdateAt: normalizedAt,
    };
}
