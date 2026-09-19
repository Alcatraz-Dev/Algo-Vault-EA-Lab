/**
 * AlgoVault Pro Signal Intelligence - Multilingual Fast Parser
 * High-performance, deterministic parser supporting 11+ languages, open targets, and flexible layouts.
 */

import { DEFAULT_SYMBOL_ALIASES } from "../config";
import { normalizeMessageText, matchMultilingualKeyword, MULTILINGUAL_DICTIONARY } from "./multilingual-dictionary";
import type {
    SignalDirection,
    EntryType,
    TakeProfitTarget,
    SignalStyle,
    SignalTimeframe,
} from "../types";

export interface ParsedSignalResult {
    isSignal: boolean;
    isUpdate: boolean;
    updateType?:
        | "SL_MOVE"
        | "TP_HIT"
        | "MOVE_BE"
        | "CLOSE_SIGNAL"
        | "CLOSE_HALF";
    updateMetadata?: {
        newStopLoss?: number;
        tpHitIndex?: number;
        symbol?: string;
    };
    symbol?: string;
    direction?: SignalDirection;
    entryType?: EntryType;
    entryMin?: number;
    entryMax?: number;
    stopLoss?: number;
    takeProfits?: TakeProfitTarget[];
    openTarget?: boolean;
    style?: SignalStyle;
    timeframe?: SignalTimeframe;
    confidence: number;
    warnings: string[];
    errors: string[];
    detectedLanguage?: string;
    aiUsed?: boolean;
    aiConfidence?: number;
    aiInterpretation?: string;
}

export function parseFastSignal(rawText: string): ParsedSignalResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    // 1. Multilingual Normalization (strips emojis, cleans separators, detects language)
    const { cleanText: text, detectedLanguage } = normalizeMessageText(rawText);

    if (!text) {
        return {
            isSignal: false,
            isUpdate: false,
            confidence: 0,
            warnings: [],
            errors: ["Empty message text"],
            detectedLanguage: "en",
        };
    }

    // 2. Check if message is a follow-up signal update (SL MOVE, TP HIT, MOVE BE, CLOSE)
    const updateResult = parseSignalUpdate(text);
    if (updateResult.isUpdate) {
        return { ...updateResult, detectedLanguage };
    }

    // 3. Identify Direction using Multilingual Dictionary
    let direction: SignalDirection | undefined;
    if (matchMultilingualKeyword(text, "BUY")) {
        direction = "BUY";
    } else if (matchMultilingualKeyword(text, "SELL")) {
        direction = "SELL";
    }

    if (!direction) {
        return {
            isSignal: false,
            isUpdate: false,
            confidence: 0,
            warnings,
            errors: ["No valid trade direction (BUY/LONG or SELL/SHORT) found"],
            detectedLanguage,
        };
    }

    // 4. Identify Symbol using Extensible Map & Regex
    let symbol: string | undefined;
    const upperText = text.toUpperCase();

    // Check aliases in text
    for (const [alias, canonical] of Object.entries(DEFAULT_SYMBOL_ALIASES)) {
        const regex = new RegExp(`\\b${alias.replace("/", "\\/")}\\b`, "i");
        if (regex.test(text)) {
            symbol = canonical;
            break;
        }
    }

    // Fallback: match standard currency pairs / indices (e.g. SP500, US30, NAS100, EURUSD)
    if (!symbol) {
        const match = upperText.match(/\b([A-Z]{6}|[A-Z]{3,6}USD|[A-Z]{2,4}\d{2,4})\b/);
        if (match) {
            symbol = match[1];
        }
    }

    if (!symbol) {
        errors.push("Could not resolve market symbol");
    }

    // 5. Identify Entry Type & Entry Zone
    let entryType: EntryType = "MARKET";
    let entryMin: number | undefined;
    let entryMax: number | undefined;

    if (/\b(limit|pending)\b/i.test(text)) {
        entryType = "LIMIT";
    } else if (/\b(stop)\b/i.test(text) && !matchMultilingualKeyword(text, "STOP_LOSS")) {
        entryType = "STOP";
    } else if (/\b(now|at|market|cmp|instant|buy now|sell now|jetzt)\b/i.test(text)) {
        entryType = "MARKET";
    }

    const numbersInEntrySection = extractEntryNumbers(text);
    if (numbersInEntrySection.length >= 2) {
        const n1 = numbersInEntrySection[0];
        const n2 = numbersInEntrySection[1];
        entryMin = Math.min(n1, n2);
        entryMax = Math.max(n1, n2);
    } else if (numbersInEntrySection.length === 1) {
        entryMin = numbersInEntrySection[0];
        entryMax = numbersInEntrySection[0];
    } else {
        warnings.push("Entry range/price ambiguous or missing");
    }

    // 6. Extract Stop Loss (SL)
    let stopLoss: number | undefined;
    const slMatch = text.match(/(?:SL|Stop\s*Loss|Stop|Stopp|Zararkes|وقف)[:\.\s]*([0-9]+(?:\.[0-9]+)?)/i);
    if (slMatch) {
        stopLoss = parseFloat(slMatch[1]);
    } else {
        errors.push("Stop Loss (SL) is missing");
    }

    // 7. Extract Take Profits (TPs) & Open Runner Target (§8)
    const takeProfits: TakeProfitTarget[] = [];
    let openTarget = false;
    const tpLines = text.split("\n");

    let tpIndexCounter = 1;
    for (const line of tpLines) {
        // Check for Open Target in line (e.g. öppen, ouvert, offen, OPEN, ∞)
        if (matchMultilingualKeyword(line, "OPEN_TARGET") || /TP\d*[:\.\s]*(open|runner|öppen|öppet|ouvert|offen|abierto|aperto|مفتوح|∞)/i.test(line)) {
            takeProfits.push({
                index: tpIndexCounter++,
                type: "OPEN",
                price: null,
            });
            openTarget = true;
            continue;
        }

        // Match TP line with price (e.g. TP: 7604, TP1: 7604, Target 1: 7604, TP1 7604)
        const tpMatch = line.match(/(?:TP\s*\d*|Take\s*Profit\s*\d*|Target\s*\d*|Ziel\s*\d*|Objectif\s*\d*|Objetivo\s*\d*|Hedef\s*\d*)[:\.\s]*([0-9]+(?:\.[0-9]+)?)/i);
        if (tpMatch) {
            const val = parseFloat(tpMatch[1]);
            if (!matchMultilingualKeyword(line, "STOP_LOSS")) {
                takeProfits.push({
                    index: tpIndexCounter++,
                    type: "PRICE",
                    price: val,
                });
            }
        }
    }

    // Inline TP Fallback e.g. "TP1 7604 TP2 7598 TP3 öppen"
    if (takeProfits.length === 0) {
        const globalTpMatches = Array.from(
            text.matchAll(/(?:TP\d*|Target\d*)[:\.\s]*([0-9]+(?:\.[0-9]+)?|open|öppen|ouvert|offen|∞)/gi)
        );
        for (const match of globalTpMatches) {
            const rawVal = match[1];
            if (matchMultilingualKeyword(rawVal, "OPEN_TARGET") || /open|öppen|ouvert|offen|∞/i.test(rawVal)) {
                takeProfits.push({
                    index: tpIndexCounter++,
                    type: "OPEN",
                    price: null,
                });
                openTarget = true;
            } else {
                const val = parseFloat(rawVal);
                takeProfits.push({
                    index: tpIndexCounter++,
                    type: "PRICE",
                    price: val,
                });
            }
        }
    }

    if (takeProfits.length === 0) {
        warnings.push("No Take Profit (TP) targets detected");
    }

    // 8. Extract Timeframe & Style
    let timeframe: SignalTimeframe = "UNKNOWN";
    const tfMatch = text.match(/\b(M1|M5|M15|M30|H1|H4|D1)\b/i);
    if (tfMatch) {
        timeframe = tfMatch[1].toUpperCase() as SignalTimeframe;
    }

    let style: SignalStyle = "UNKNOWN";
    if (timeframe === "M1" || timeframe === "M5") style = "SCALPING";
    else if (timeframe === "M15" || timeframe === "M30" || timeframe === "H1") style = "INTRADAY";
    else if (timeframe === "H4" || timeframe === "D1") style = "SWING";

    // 9. Calculate Parser Confidence (§12)
    let confidence = 0;
    if (direction) confidence += 20;
    if (symbol) confidence += 20;
    if (entryMin !== undefined) confidence += 20;
    if (stopLoss) confidence += 20;
    if (takeProfits.length > 0) confidence += 20;

    const isSignal = errors.length === 0 && symbol !== undefined && direction !== undefined;

    return {
        isSignal,
        isUpdate: false,
        symbol,
        direction,
        entryType,
        entryMin: entryMin ?? 0,
        entryMax: entryMax ?? (entryMin ?? 0),
        stopLoss: stopLoss ?? 0,
        takeProfits,
        openTarget,
        style,
        timeframe,
        confidence,
        warnings,
        errors,
        detectedLanguage,
    };
}

function parseSignalUpdate(text: string): ParsedSignalResult {
    // Move SL to Breakeven
    if (/\b(MOVE\s*SL\s*TO\s*BE|SL\s*TO\s*BE|BREAKEVEN|BE\s*NOW)\b/i.test(text)) {
        return {
            isSignal: false,
            isUpdate: true,
            updateType: "MOVE_BE",
            confidence: 95,
            warnings: [],
            errors: [],
        };
    }

    // SL Move e.g. "SL MOVE 4334"
    const slMoveMatch = text.match(/(?:SL\s*MOVE|MOVE\s*SL|NEW\s*SL)[:\.\s]*([0-9]+(?:\.[0-9]+)?)/i);
    if (slMoveMatch) {
        return {
            isSignal: false,
            isUpdate: true,
            updateType: "SL_MOVE",
            updateMetadata: { newStopLoss: parseFloat(slMoveMatch[1]) },
            confidence: 95,
            warnings: [],
            errors: [],
        };
    }

    // TP Hit e.g. "TP1 HIT", "TP2 HIT"
    const tpHitMatch = text.match(/TP\s*(\d+)\s*(?:HIT|DONE|REACHED|CHECK)/i);
    if (tpHitMatch) {
        return {
            isSignal: false,
            isUpdate: true,
            updateType: "TP_HIT",
            updateMetadata: { tpHitIndex: parseInt(tpHitMatch[1], 10) },
            confidence: 95,
            warnings: [],
            errors: [],
        };
    }

    // Close signal
    if (/\b(CLOSE\s*GOLD|CLOSE\s*ALL|CLOSE\s*NOW|BUY\s*CLOSED|SELL\s*CLOSED)\b/i.test(text)) {
        return {
            isSignal: false,
            isUpdate: true,
            updateType: "CLOSE_SIGNAL",
            confidence: 95,
            warnings: [],
            errors: [],
        };
    }

    return {
        isSignal: false,
        isUpdate: false,
        confidence: 0,
        warnings: [],
        errors: [],
    };
}

function extractEntryNumbers(text: string): number[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const numbers: number[] = [];

    for (const line of lines) {
        const cleanedLine = line
            .replace(/(?:\b(?:SL|Stop\s*Loss|Stop|Stopp|Zararkes|وقف)\b)[:\.\s]*[0-9]+(?:\.[0-9]+)?/gi, "")
            .replace(/(?:\b(?:TP\d*|Take\s*Profit\d*|Target\d*|Ziel\d*)\b)[:\.\s]*[0-9]+(?:\.[0-9]+)?/gi, "")
            .replace(/\b(?:TP|Target|Ziel|Objectif|Hedef)\s*\d*\b[:\.\s]*(?:open|öppen|ouvert|offen|∞)?/gi, "");

        const matches = Array.from(cleanedLine.matchAll(/\b([0-9]+(?:\.[0-9]+)?)\b/g));
        for (const m of matches) {
            const val = parseFloat(m[1]);
            if (!isNaN(val)) {
                numbers.push(val);
            }
        }

        if (numbers.length >= 1) break;
    }

    return numbers;
}
