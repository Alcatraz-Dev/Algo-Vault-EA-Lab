/**
 * TradePlan schema validation — deterministic, pure.
 *
 * The AI never writes a plan straight to RTDB: every plan passes through
 * `validateTradePlan` first. Anything malformed is rejected with a reason and
 * never reaches the risk engine or the gateway.
 */

import type { EvidenceItem, TradePlan } from "./types";
import { TERMINAL_PLAN_STATUSES } from "./types";

export interface PlanSchemaResult {
    valid: boolean;
    errors: string[];
}

const MIN_RISK_PERCENT = 0.05;
const MAX_RISK_PERCENT = 2; // mirrors AUTOMATION_HARD_CEILINGS; schema-level bound
const MAX_TPS = 5;
const MAX_EVIDENCE_ITEMS = 40;
const MAX_TEXT_LENGTH = 4000;

function finitePositive(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function validateTradePlan(
    plan: TradePlan,
    opts?: { maxRiskPercent?: number }
): PlanSchemaResult {
    const errors: string[] = [];
    const maxRisk = Math.min(opts?.maxRiskPercent ?? MAX_RISK_PERCENT, MAX_RISK_PERCENT);

    if (!plan || typeof plan !== "object") {
        return { valid: false, errors: ["Plan is not an object."] };
    }

    // Identity
    if (typeof plan.id !== "string" || plan.id.length < 4 || plan.id.length > 128) errors.push("Plan id is missing or malformed.");
    if (typeof plan.userId !== "string" || plan.userId.length < 1) errors.push("Plan userId is missing.");

    // Instrument
    if (typeof plan.instrument !== "string" || !/^[A-Z0-9]{3,12}$/.test(plan.instrument)) {
        errors.push("Instrument must be an uppercase symbol of 3–12 alphanumeric characters.");
    }

    // Direction
    if (plan.direction !== "BUY" && plan.direction !== "SELL") errors.push("Direction must be BUY or SELL.");

    // Prices
    if (!finitePositive(plan.entry)) errors.push("Entry must be a positive finite number.");
    if (!finitePositive(plan.stopLoss)) errors.push("StopLoss must be a positive finite number.");
    if (!Array.isArray(plan.takeProfits)) {
        errors.push("takeProfits must be an array.");
    } else {
        if (plan.takeProfits.length === 0) errors.push("At least one take-profit is required.");
        if (plan.takeProfits.length > MAX_TPS) errors.push(`At most ${MAX_TPS} take-profits are allowed.`);
        if (plan.takeProfits.some((t) => !t || !Number.isInteger(t.index) || t.index < 1 || !finitePositive(t.price))) {
            errors.push("Every take-profit needs a positive integer index and positive price.");
        }
    }

    // Geometry (only when prices are valid numbers)
    if (finitePositive(plan.entry) && finitePositive(plan.stopLoss)) {
        if (plan.direction === "BUY" && plan.stopLoss >= plan.entry) errors.push("BUY: stopLoss must be below entry.");
        if (plan.direction === "SELL" && plan.stopLoss <= plan.entry) errors.push("SELL: stopLoss must be above entry.");
        if (Array.isArray(plan.takeProfits) && finitePositive(plan.entry)) {
            for (const tp of plan.takeProfits) {
                if (!finitePositive(tp.price)) continue;
                if (plan.direction === "BUY" && tp.price <= plan.entry) errors.push(`TP${tp.index} must be above entry for BUY.`);
                if (plan.direction === "SELL" && tp.price >= plan.entry) errors.push(`TP${tp.index} must be below entry for SELL.`);
            }
        }
    }

    // Risk
    if (!finitePositive(plan.riskPercent) || plan.riskPercent < MIN_RISK_PERCENT || plan.riskPercent > maxRisk) {
        errors.push(`riskPercent must be between ${MIN_RISK_PERCENT} and ${maxRisk}.`);
    }

    // Evidence
    if (!Array.isArray(plan.evidence)) {
        errors.push("evidence must be an array.");
    } else {
        if (plan.evidence.length > MAX_EVIDENCE_ITEMS) errors.push(`Too many evidence items (max ${MAX_EVIDENCE_ITEMS}).`);
        for (const item of plan.evidence) {
            const err = validateEvidenceItem(item);
            if (err) errors.push(err);
        }
        const nonAi = plan.evidence.filter(
            (e) => e && e.evidenceClass !== "AI_INTERPRETATION" && e.evidenceClass !== "UNAVAILABLE"
        );
        if (nonAi.length === 0) {
            errors.push("At least one non-AI evidence item (OBSERVED/DERIVED/HISTORICAL) is required — a plan can never rest on AI interpretation alone.");
        }
    }

    // Expiry + lifecycle
    if (!finitePositive(plan.expiresAt)) errors.push("expiresAt must be a positive timestamp.");
    if (typeof plan.generatedAt !== "number" || !Number.isFinite(plan.generatedAt)) errors.push("generatedAt must be a timestamp.");
    if (plan.expiresAt <= plan.generatedAt) errors.push("expiresAt must be after generatedAt.");
    if (TERMINAL_PLAN_STATUSES.includes(plan.status)) {
        errors.push(`Status ${plan.status} is terminal and cannot be set at generation time.`);
    }

    // Textual fields bounded (no payloads smuggled through narratives)
    if (plan.aiInterpretation !== undefined && (typeof plan.aiInterpretation !== "string" || plan.aiInterpretation.length > MAX_TEXT_LENGTH)) {
        errors.push("aiInterpretation must be a string under 4000 characters.");
    }
    if (!Array.isArray(plan.invalidationConditions)) errors.push("invalidationConditions must be an array.");
    else if (plan.invalidationConditions.some((c) => typeof c !== "string" || c.length > 500)) {
        errors.push("Every invalidation condition must be a string under 500 characters.");
    }

    return { valid: errors.length === 0, errors };
}

/** One evidence item must be self-describing and honest. */
export function validateEvidenceItem(item: EvidenceItem): string | null {
    if (!item || typeof item !== "object") return "Evidence item is not an object.";
    if (typeof item.id !== "string" || item.id.length === 0) return "Evidence item lacks an id.";
    if (typeof item.sourceId !== "string" || item.sourceId.length === 0) return `Evidence item "${item.id}" lacks a sourceId.`;
    if (typeof item.label !== "string" || item.label.length === 0) return `Evidence item "${item.id}" lacks a label.`;

    if (item.evidenceClass === "UNAVAILABLE") {
        if (typeof item.reason !== "string" || item.reason.length === 0) {
            return `UNAVAILABLE evidence "${item.id}" must carry a reason.`;
        }
        if (item.value !== undefined) {
            return `UNAVAILABLE evidence "${item.id}" must not carry a value.`;
        }
    } else if (!["OBSERVED", "DERIVED", "HISTORICAL", "AI_INTERPRETATION"].includes(item.evidenceClass)) {
        return `Evidence item "${item.id}" has an unknown evidence class.`;
    } else if (item.value === undefined) {
        return `Evidence item "${item.id}" of class ${item.evidenceClass} must carry a value.`;
    }
    return null;
}

/** True when every invalidation condition string is non-empty (used by the gate). */
export function hasInvalidationConditions(plan: TradePlan): boolean {
    return plan.invalidationConditions.length > 0 && plan.invalidationConditions.every((c) => c.trim().length > 0);
}
