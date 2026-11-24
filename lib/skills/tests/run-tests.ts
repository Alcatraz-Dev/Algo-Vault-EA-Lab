// ─────────────────────────────────────────────────────────────────────────────
// Skills Registry tests.
//
// Proves: only verified capabilities are seeded · external methodology cannot
// hold broker/credential/execution access · disable is enforced through the
// central policy engine, not by an ad-hoc check · registration rejects
// incomplete records.
//
// Run: npm run test:skills
// ─────────────────────────────────────────────────────────────────────────────

import { createDefaultSkillsRegistry, SkillRegistrationError, type SkillRecord } from "../registry";
import { evaluatePolicy } from "@/lib/agent/policies/permission-engine";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function section(name: string): void {
    console.log(`\n${name}`);
}
function throws(fn: () => void, code?: string): boolean {
    try {
        fn();
        return false;
    } catch (error) {
        return error instanceof SkillRegistrationError && (code === undefined || error.message.includes(code));
    }
}

const NOW = 1_780_000_000_000;

// ── Seed data ─────────────────────────────────────────────────────────────
section("seed registry");
const registry = createDefaultSkillsRegistry();
const all = registry.list();
check(all.length > 0, "default registry is populated", all.length);
check(all.every((s) => s.enabled), "every seeded skill is enabled");
check(all.every((s) => s.verification === "VERIFIED_INTERNAL" || s.verification === "APPROVED_EXTERNAL_METHODOLOGY"), "no unverified seed entries");
check(all.every((s) => s.testEvidence.length > 0), "every skill links test evidence");

const riskEngine = registry.get("risk.engine");
check(!!riskEngine && riskEngine.category === "risk", "internal risk engine registered");
const dsr = registry.get("validation.deflated-sharpe");
check(!!dsr && dsr.source.kind === "internal", "DSR skill is an internal implementation");
const pboMethod = registry.get("methodology.pbo-cscv");
check(!!pboMethod && pboMethod.source.kind === "external-methodology", "PBO methodology registered as external");
check(pboMethod?.source.codeImported === false, "external methodology imports no code");
check(pboMethod?.security.brokerAccess === "none" && pboMethod?.security.credentialsAccess === "none", "external methodology has no broker/credential access");

// ── Policy integration ────────────────────────────────────────────────────
section("policy integration");
const declaration = registry.declarationFor("validation.deflated-sharpe");
check(declaration.disabled === false, "enabled skill declaration is not disabled");
const askState = { mode: "ask" as const, rootVerified: false, grantedConfirmations: new Set<string>() };
const allowed = evaluatePolicy({ toolId: "skill.validation.deflated-sharpe", declaration, state: askState, args: {} });
check(allowed.allowed === true, "enabled skill passes evaluatePolicy in ask mode", allowed);

const execDecl = registry.declarationFor("execution.order-fingerprint");
const engineer = evaluatePolicy({
    toolId: "skill.execution.order-fingerprint",
    declaration: execDecl,
    state: { mode: "engineer", rootVerified: true, grantedConfirmations: new Set<string>() },
    args: {},
});
check(engineer.allowed === false && engineer.code === "mode_lacks_permission", "execution skill needs an explicit trade override", engineer);

registry.setEnabled("validation.deflated-sharpe", false, "ops-user");
const disabled = registry.declarationFor("validation.deflated-sharpe");
check(disabled.disabled === true, "disable flips the declaration");
const denied = evaluatePolicy({ toolId: "skill.validation.deflated-sharpe", declaration: disabled, state: askState, args: {} });
check(denied.allowed === false && denied.code === "tool_disabled", "disabled skill is denied by evaluatePolicy", denied);

registry.setEnabled("validation.deflated-sharpe", true, "ops-user");
check(registry.declarationFor("validation.deflated-sharpe").disabled === false, "re-enable restores the declaration");
const trail = registry.auditTrail();
check(trail.some((t) => t.action === "disable" && t.actor === "ops-user"), "disable decision is audited", trail);
check(throws(() => registry.setEnabled("validation.deflated-sharpe", false, " "), "actor"), "enable/disable requires an actor");

// ── Registration guards ───────────────────────────────────────────────────
section("registration guards");
const base: SkillRecord = {
    id: "test.skill",
    version: "1.0.0",
    description: "test",
    category: "validation",
    source: { kind: "internal", reference: "lib/test.ts", license: "Proprietary (AlgoVault)", codeImported: false },
    verification: "VERIFIED_INTERNAL",
    testEvidence: [{ suite: "t", path: "x.test.ts", command: "npm test", result: "NOT_RUN" }],
    security: {
        brokerAccess: "none",
        credentialsAccess: "none",
        networkAccess: false,
        codeExecution: false,
        riskLevel: "low",
        findings: [],
        reviewedBy: "reviewer",
        reviewedAt: NOW,
    },
    permissions: { requires: ["memory_read"], requiresConfirmation: false },
    compatibility: { engine: "test", minVersion: "1.0.0", contracts: [] },
    enabled: true,
};

const fresh = createDefaultSkillsRegistry();
check(throws(() => fresh.register({ ...base, id: "validation.deflated-sharpe" }), "already registered"), "duplicate id rejected");
check(throws(() => fresh.register({ ...base, id: "test.badver", version: "1" }), "semver"), "non-semver version rejected");
check(throws(() => fresh.register({ ...base, id: "test.license", source: { ...base.source, license: "" } }), "licence"), "missing licence rejected");
check(throws(() => fresh.register({ ...base, id: "test.evidence", testEvidence: [] }), "test"), "missing test evidence rejected");

const external: SkillRecord = {
    ...base,
    id: "test.external",
    source: { kind: "external-methodology", reference: "paper", license: "public methodology", codeImported: false },
    verification: "APPROVED_EXTERNAL_METHODOLOGY",
};
check(throws(() => fresh.register({ ...external, id: "test.ext.broker", security: { ...base.security, brokerAccess: "execute" } }), "broker"), "external methodology with broker access rejected");
check(throws(() => fresh.register({ ...external, id: "test.ext.creds", security: { ...base.security, credentialsAccess: "scoped" } }), "credentials"), "external methodology with credentials rejected");
check(throws(() => fresh.register({ ...external, id: "test.ext.exec", permissions: { requires: ["trade_execute_demo"], requiresConfirmation: true } }), "execution"), "external methodology with execution permission rejected");
check(throws(() => fresh.register({ ...external, id: "test.ext.code", source: { ...external.source, codeImported: true } }), "code"), "external methodology importing code rejected");

check(throws(() => fresh.register({ ...external, id: "test.ext.ok" }), "") === false, "valid external methodology registers");
check(!!fresh.get("test.ext.ok"), "registered external methodology is retrievable");

check(throws(() => registry.declarationFor("does.not.exist"), "not registered"), "declaration for an unknown skill throws instead of inventing one");

console.log(`\n${failures === 0 ? "🎉 ALL SKILLS-REGISTRY TESTS PASSED" : `❌ ${failures} SKILLS TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
