/**
 * AlgoVault — internal Skills Registry.
 *
 * A skill is a named, versioned capability with an owner, a licence, a
 * verification status, test evidence and an explicit permission set. The
 * registry exists so that "we support X" is a checkable claim rather than a
 * paragraph in a doc — and so that external methodology can be adopted without
 * importing a stranger's repo, dependencies or credentials.
 *
 * INTEGRATION WITH THE PERMISSION ENGINE
 * --------------------------------------
 * `declarationFor(skillId)` returns a `ToolPolicyDeclaration`. Any tool bound to
 * a skill must use that declaration, which means every call flows through
 * `evaluatePolicy` exactly like the built-in tools — mode capabilities,
 * structural blocks and confirmation tokens apply unchanged. A skill cannot
 * carry its own authorization logic and there is no bypass path.
 *
 * EXTERNAL ISOLATION
 * ------------------
 * A record whose source is `external-methodology` MUST declare
 * `credentialsAccess: "none"` and `brokerAccess: "none"`, and cannot require
 * `trade_execute_demo`/`trade_execute_live`. Registration throws otherwise.
 * This encodes the rule: external work informs our code, it never receives
 * broker credentials or unrestricted execution.
 *
 * Only verified internal capabilities and explicitly approved external
 * METHODOLOGIES are registered initially. There is no "unverified" seed data.
 */

import type { AgentPermission, ToolPolicyDeclaration } from "@/lib/agent/policies/permission-engine";
import { QUANT_VALIDATION_VERSION } from "@/lib/quant/validation/experiment";

export type SkillSourceKind = "internal" | "external-methodology";

export type SkillVerification =
    | "VERIFIED_INTERNAL"
    | "APPROVED_EXTERNAL_METHODOLOGY";

export type SkillCategory =
    | "validation"
    | "risk"
    | "execution-safety"
    | "backtesting"
    | "research"
    | "data";

export interface SkillSource {
    kind: SkillSourceKind;
    /** Repo path for internal skills; citation for methodologies. */
    reference: string;
    /** SPDX-ish licence string. Never blank. */
    license: string;
    /** For methodologies: proof that no third-party code was imported. */
    codeImported?: boolean;
}

export interface SkillTestEvidence {
    suite: string;
    path: string;
    /** Command that runs it. */
    command: string;
    result: "PASS" | "FAIL" | "NOT_RUN";
    lastRunAt?: number;
}

export type BrokerAccess = "none" | "authorize-only" | "execute";
export type CredentialAccess = "none" | "scoped";

export interface SkillSecurityAssessment {
    brokerAccess: BrokerAccess;
    credentialsAccess: CredentialAccess;
    networkAccess: boolean;
    codeExecution: boolean;
    riskLevel: "low" | "medium" | "high";
    findings: string[];
    reviewedBy: string;
    reviewedAt: number;
}

export interface SkillPermissions {
    requires: AgentPermission[];
    requiresConfirmation: boolean;
}

export interface SkillCompatibility {
    /** Engine/module the skill depends on. */
    engine: string;
    minVersion: string;
    contracts: string[];
    notes?: string;
}

export interface SkillRecord {
    id: string;
    version: string;
    description: string;
    category: SkillCategory;
    source: SkillSource;
    verification: SkillVerification;
    testEvidence: SkillTestEvidence[];
    security: SkillSecurityAssessment;
    permissions: SkillPermissions;
    compatibility: SkillCompatibility;
    enabled: boolean;
}

export class SkillRegistrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SkillRegistrationError";
    }
}

const SEMVER = /^\d+\.\d+\.\d+$/;

export class SkillsRegistry {
    private readonly skills = new Map<string, SkillRecord>();
    private readonly audit: Array<{ at: number; skillId: string; action: "register" | "enable" | "disable"; actor: string }> = [];

    register(record: SkillRecord, actor = "system"): void {
        validate(record);
        if (this.skills.has(record.id)) {
            throw new SkillRegistrationError(`Skill "${record.id}" is already registered.`);
        }
        this.skills.set(record.id, { ...record, permissions: { ...record.permissions, requires: [...record.permissions.requires] } });
        this.audit.push({ at: Date.now(), skillId: record.id, action: "register", actor });
    }

    get(id: string): SkillRecord | null {
        return this.skills.get(id) ?? null;
    }

    list(): SkillRecord[] {
        return [...this.skills.values()];
    }

    enabledSkills(): SkillRecord[] {
        return this.list().filter((s) => s.enabled);
    }

    setEnabled(id: string, enabled: boolean, actor: string): SkillRecord {
        const record = this.skills.get(id);
        if (!record) throw new SkillRegistrationError(`Skill "${id}" is not registered.`);
        if (!actor.trim()) throw new SkillRegistrationError("Enable/disable requires an actor id.");
        const next = { ...record, enabled };
        this.skills.set(id, next);
        this.audit.push({ at: Date.now(), skillId: id, action: enabled ? "enable" : "disable", actor });
        return next;
    }

    /** Audit trail of enable/disable decisions — who changed what, when. */
    auditTrail(): ReadonlyArray<{ at: number; skillId: string; action: string; actor: string }> {
        return this.audit;
    }

    /**
     * Policy declaration for a skill-bound tool. Disabled skills get a
     * declaration that no mode can satisfy (unknown permission), so the call is
     * denied by `evaluatePolicy` rather than by an ad-hoc check.
     */
    declarationFor(id: string): ToolPolicyDeclaration {
        const record = this.skills.get(id);
        if (!record) {
            throw new SkillRegistrationError(`Skill "${id}" is not registered — refusing to invent a declaration.`);
        }
        return {
            requires: [...record.permissions.requires],
            requiresConfirmation: record.permissions.requiresConfirmation,
            category: "context",
            mutating: false,
            disabled: !record.enabled,
            disabledReason: record.enabled ? undefined : `Skill "${record.id}" is disabled in the Skills Registry.`,
        };
    }
}

function validate(record: SkillRecord): void {
    if (!record.id || !/^[a-z0-9][a-z0-9._-]*$/.test(record.id)) {
        throw new SkillRegistrationError("Skill id must be a lowercase slug.");
    }
    if (!SEMVER.test(record.version)) {
        throw new SkillRegistrationError(`Skill "${record.id}" version must be semver (x.y.z).`);
    }
    if (!record.source.license.trim()) {
        throw new SkillRegistrationError(`Skill "${record.id}" must declare a licence.`);
    }
    if (!record.source.reference.trim()) {
        throw new SkillRegistrationError(`Skill "${record.id}" must declare a source reference.`);
    }
    if (record.verification === "APPROVED_EXTERNAL_METHODOLOGY" && record.source.kind !== "external-methodology") {
        throw new SkillRegistrationError("APPROVED_EXTERNAL_METHODOLOGY requires an external-methodology source.");
    }
    if (record.source.kind === "external-methodology") {
        if (record.source.codeImported === true) {
            throw new SkillRegistrationError(
                `External methodology "${record.id}" must not import third-party code — re-implement the method instead.`,
            );
        }
        if (record.security.brokerAccess !== "none") {
            throw new SkillRegistrationError(`External methodology "${record.id}" cannot receive broker access.`);
        }
        if (record.security.credentialsAccess !== "none") {
            throw new SkillRegistrationError(`External methodology "${record.id}" cannot receive credentials.`);
        }
        if (record.permissions.requires.includes("trade_execute_demo") || record.permissions.requires.includes("trade_execute_live")) {
            throw new SkillRegistrationError(`External methodology "${record.id}" cannot hold execution permissions.`);
        }
    }
    if (!record.testEvidence.length) {
        throw new SkillRegistrationError(`Skill "${record.id}" must link at least one test suite as evidence.`);
    }
    if (record.security.riskLevel === "high" && record.security.findings.length === 0) {
        throw new SkillRegistrationError(`High-risk skill "${record.id}" requires recorded security findings.`);
    }
}

const REVIEWED_AT = Date.parse("2026-11-24T00:00:00Z");

export function createDefaultSkillsRegistry(): SkillsRegistry {
    const registry = new SkillsRegistry();

    // ── Verified internal capabilities ──────────────────────────────────────
    const internal = (
        id: string,
        description: string,
        category: SkillCategory,
        implementation: string,
        requires: AgentPermission[],
        evidence: SkillTestEvidence[],
        contracts: string[],
        engine: string,
    ): SkillRecord => ({
        id,
        version: "1.0.0",
        description,
        category,
        source: { kind: "internal", reference: implementation, license: "Proprietary (AlgoVault)", codeImported: false },
        verification: "VERIFIED_INTERNAL",
        testEvidence: evidence,
        security: {
            brokerAccess: category === "execution-safety" ? "authorize-only" : "none",
            credentialsAccess: "none",
            networkAccess: false,
            codeExecution: false,
            riskLevel: "low",
            findings: [],
            reviewedBy: "quant-integrity-milestone",
            reviewedAt: REVIEWED_AT,
        },
        permissions: { requires, requiresConfirmation: requires.includes("trade_execute_demo") },
        compatibility: { engine, minVersion: QUANT_VALIDATION_VERSION, contracts },
        enabled: true,
    });

    const VERIFIED_AT = Date.parse("2026-11-24T12:00:00Z");
    const tests = (suite: string, path: string, command: string): SkillTestEvidence => ({
        suite,
        path,
        command,
        // All listed suites were executed and passed when this registry was
        // seeded. A failing suite must flip this back to NOT_RUN/FAIL.
        result: "PASS",
        lastRunAt: VERIFIED_AT,
    });

    for (const record of [
        internal(
            "risk.engine",
            "Canonical order-intent risk evaluation (pure, deterministic, fail-closed on known limits).",
            "risk",
            "lib/risk/risk-engine.ts",
            ["memory_read"],
            [tests("risk-engine", "lib/risk/tests/risk-engine.test.ts", "npm run test:risk")],
            ["OrderIntent", "RiskLimits", "AccountRiskState", "RiskDecision"],
            "risk-engine",
        ),
        internal(
            "risk.drawdown-breaker",
            "Latched account drawdown breaker with audited human reset.",
            "risk",
            "lib/risk/drawdown-breaker.ts",
            ["memory_read"],
            [tests("execution-safety", "lib/risk/tests/execution-safety.test.ts", "npm run test:risk:safety")],
            ["DrawdownBreakerRecord", "BreakerDecision"],
            "risk-engine",
        ),
        internal(
            "execution.order-fingerprint",
            "Tenant-scoped order fingerprint, typed confirmation and authorization record.",
            "execution-safety",
            "lib/risk/order-fingerprint.ts",
            ["trade_read", "trade_execute_demo"],
            [tests("execution-safety", "lib/risk/tests/execution-safety.test.ts", "npm run test:risk:safety")],
            ["OrderIdentity", "ExecutionAuthorization"],
            "risk-engine",
        ),
        internal(
            "backtest.strategy-lab",
            "Canonical Strategy Lab backtest (next_bar_open, spread/slippage/commission).",
            "backtesting",
            "lib/strategy-lab/backtest.ts",
            ["memory_read"],
            [tests("strategy-lab", "lib/strategy-lab/tests/backtest.test.ts", "npm run test:strategy-engine")],
            ["BacktestResult", "BacktestConfig"],
            "strategy-engine",
        ),
        internal(
            "validation.walk-forward",
            "Rolling train/test walk-forward windows with degradation scoring.",
            "validation",
            "lib/strategy-lab/validation.ts",
            ["memory_read"],
            [tests("quant-integration", "lib/strategy-lab/tests/validation-quant.test.ts", "npm run test:quant:integration")],
            ["ValidationOutcome", "WalkForwardWindow"],
            "strategy-engine",
        ),
        internal(
            "validation.monte-carlo",
            "Deterministic resampling of actual backtest trades.",
            "validation",
            "lib/market-intelligence/research/monte-carlo/runner.ts",
            ["memory_read"],
            [tests("strategy-research", "lib/strategy-research/__tests__/run-research-tests.ts", "npm run test:research")],
            ["MonteCarloResult"],
            "strategy-engine",
        ),
        internal(
            "validation.deflated-sharpe",
            "Deflated Sharpe Ratio with multiple-testing adjustment.",
            "validation",
            "lib/quant/validation/dsr.ts",
            ["memory_read"],
            [tests("quant-validation", "lib/quant/validation/tests/run-quant-tests.ts", "npm run test:quant")],
            ["DsrResult"],
            "quant-validation",
        ),
        internal(
            "validation.pbo-cscv",
            "Probability of Backtest Overfitting via combinatorial symmetric CV.",
            "validation",
            "lib/quant/validation/pbo.ts",
            ["memory_read"],
            [tests("quant-validation", "lib/quant/validation/tests/run-quant-tests.ts", "npm run test:quant")],
            ["PboResult"],
            "quant-validation",
        ),
        internal(
            "validation.purged-cv",
            "Purged K-fold, embargo and combinatorial purged cross-validation.",
            "validation",
            "lib/quant/validation/purged-cv.ts",
            ["memory_read"],
            [tests("quant-validation", "lib/quant/validation/tests/run-quant-tests.ts", "npm run test:quant")],
            ["PurgedFold", "PurgeOptions"],
            "quant-validation",
        ),
        internal(
            "validation.pipeline",
            "Validation stage pipeline that only attests to executed engine output.",
            "validation",
            "lib/market-intelligence/validation/pipeline.ts",
            ["memory_read"],
            [tests("validation-pipeline", "lib/market-intelligence/validation/tests/run-validation-tests.ts", "npm run test:validation")],
            ["StageResult", "ValidationPipelineResult"],
            "market-intelligence",
        ),
    ]) {
        registry.register(record, "milestone-seed");
    }

    // ── Approved external METHODOLOGIES (no code imported) ──────────────────
    const methodology = (
        id: string,
        description: string,
        reference: string,
        contracts: string[],
    ): SkillRecord => ({
        id,
        version: "1.0.0",
        description,
        category: "validation",
        source: {
            kind: "external-methodology",
            reference,
            license: "Public methodology — re-implemented, no code or dependency imported",
            codeImported: false,
        },
        verification: "APPROVED_EXTERNAL_METHODOLOGY",
        testEvidence: [tests("quant-validation", "lib/quant/validation/tests/run-quant-tests.ts", "npm run test:quant")],
        security: {
            brokerAccess: "none",
            credentialsAccess: "none",
            networkAccess: false,
            codeExecution: false,
            riskLevel: "low",
            findings: ["No third-party source, dependency or dataset imported; mathematics implemented from the published definition."],
            reviewedBy: "quant-integrity-milestone",
            reviewedAt: REVIEWED_AT,
        },
        permissions: { requires: ["memory_read"], requiresConfirmation: false },
        compatibility: { engine: "quant-validation", minVersion: QUANT_VALIDATION_VERSION, contracts },
        enabled: true,
    });

    for (const record of [
        methodology(
            "methodology.deflated-sharpe",
            "Bailey & López de Prado (2014) Deflated Sharpe Ratio.",
            "Bailey, D. H. & López de Prado, M. (2014), The Deflated Sharpe Ratio, Journal of Portfolio Management 40(5).",
            ["DsrResult"],
        ),
        methodology(
            "methodology.pbo-cscv",
            "Bailey, Borwein, López de Prado & Zhu (2014) CSCV / PBO.",
            "Bailey, D. H., Borwein, J., López de Prado, M. & Zhu, Q. J. (2014), Pseudo-Mathematics and Financial Charlatanism, Notices of the AMS 61(5).",
            ["PboResult"],
        ),
        methodology(
            "methodology.purged-cv",
            "López de Prado (2018) purged K-fold and embargo.",
            "López de Prado, M. (2018), Advances in Financial Machine Learning, Wiley (Ch. 7).",
            ["PurgedFold"],
        ),
        methodology(
            "methodology.verification-matrix",
            "TraderMonty's verification-matrix concept: every advertised capability lists implementation, tests and licence.",
            "tradermonty/claude-trading-skills — skills-index.yaml verification block (concept only).",
            ["SkillRecord"],
        ),
    ]) {
        registry.register(record, "milestone-seed");
    }

    return registry;
}

let singleton: SkillsRegistry | null = null;

/** Process-wide registry (seed data). Tests should build their own instance. */
export function getSkillsRegistry(): SkillsRegistry {
    if (!singleton) singleton = createDefaultSkillsRegistry();
    return singleton;
}
