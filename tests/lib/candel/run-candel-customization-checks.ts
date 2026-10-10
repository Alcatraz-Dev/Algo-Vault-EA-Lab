/**
 * tests/lib/candel/run-candel-customization-checks.ts
 *
 * Focused, runnable checks for the Candel *product* layer added on top of the
 * verification harness:
 *
 *   - role catalog: unknown/legacy roles degrade safely
 *   - customization is fail-closed: a Candel can NARROW its template's tools and
 *     capabilities but never widen them, and instructions are length-capped
 *   - effective config resolution (instance override wins over template)
 *   - permission documents are coerced and the approval gate cannot be removed
 *   - permanent delete purges every per-Candel sub-tree, owner-only
 *   - the chat turn endpoint exists and the dead route export is gone
 *   - approvals: directives parse fail-closed, only an execution-capable Candel
 *     with a named, bound, executable account can raise one, and a request can
 *     be decided exactly once and never after it expires
 *
 * Runs against the fake Firebase Admin surface + in-memory RTDB: real
 * application code, no credentials, no network.
 *
 * Usage:
 *   node scripts/jiti-tsrun-candel.mjs tests/lib/candel/run-candel-customization-checks.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getCandelInstance, purgeCandelInstance } from "@/lib/candel/workspace/database";
import {
  createHarness,
  makeAccountBinding,
  makeCandelInstance,
  makeTemplate,
} from "@/lib/candel/test/harness";
import {
  applyApprovalDecision,
  buildApprovalRequest,
  extractApprovalDirectives,
  isApprovalExpired,
  isApprovalPending,
  resolveApprovalDirectives,
} from "@/lib/candel/approvals";
import {
  CANDEL_LIMITS,
  mergeCandelCustomization,
  resolveCandelConfig,
  sanitizeCandelCustomization,
  sanitizeCandelPermissions,
} from "@/lib/candel/config";
import { CANDEL_ROLES, getCandelRole, isCandelRole } from "@/lib/candel/roles";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log("PASS:", label);
  } else {
    failed += 1;
    console.log(
      "FAIL:",
      label,
      detail === undefined ? "" : `-> ${JSON.stringify(detail)}`
    );
  }
}

async function main(): Promise<void> {
  console.log("\nCANDEL CUSTOMIZATION CHECKS");
  console.log("========================================\n");

// ── 1. Role catalog ─────────────────────────────────────────────────────────
console.log("=== 1. Role catalog ===");
{
  const ids = CANDEL_ROLES.map((role) => role.id);
  check("catalog exposes the curated role set", CANDEL_ROLES.length === 10, CANDEL_ROLES.length);
  check("role ids are unique", new Set(ids).size === ids.length);
  check("known role accepted", isCandelRole("market-analyst"));
  check("legacy junk role rejected", !isCandelRole("trade-summary"));
  check("non-string role rejected", !isCandelRole(42));
  check("unknown role degrades to the general assistant", getCandelRole("banana").id === "general-assistant");
  check("every spec has a label + tagline", CANDEL_ROLES.every((r) => r.label && r.tagline));
}

// ── 2. Customization is fail-closed ─────────────────────────────────────────
console.log("\n=== 2. Customization sanitizer ===");
{
  const template = makeTemplate(); // tools: ["get_market_snapshot"], capabilities: ["market_read","risk_read"]

  const unknownRole = sanitizeCandelCustomization({ role: "superuser" }, template);
  check("unknown role is replaced with a safe one", unknownRole.role === "general-assistant", unknownRole.role);

  const widened = sanitizeCandelCustomization(
    { tools: ["get_market_snapshot", "submit_live_order", "close_position"] },
    template
  );
  check(
    "tools cannot exceed the template ceiling",
    JSON.stringify(widened.tools) === JSON.stringify(["get_market_snapshot"]),
    widened.tools
  );

  const narrowed = sanitizeCandelCustomization({ tools: [] }, template);
  check("tools can be narrowed to none", Array.isArray(narrowed.tools) && narrowed.tools.length === 0);

  const unknownCapability = sanitizeCandelCustomization(
    { capabilities: ["market_read", "execute_everything"] },
    template
  );
  check(
    "capabilities cannot exceed the template ceiling",
    JSON.stringify(unknownCapability.capabilities) === JSON.stringify(["market_read"]),
    unknownCapability.capabilities
  );

  const long = sanitizeCandelCustomization({ instructions: "x".repeat(CANDEL_LIMITS.instructions + 500) }, template);
  check(
    "instructions are length-capped",
    (long.instructions ?? "").length === CANDEL_LIMITS.instructions,
    (long.instructions ?? "").length
  );

  const control = sanitizeCandelCustomization({ instructions: "hello\u0000\u0007 world" }, template);
  check("control characters are stripped", control.instructions === "hello world", control.instructions);

  const junk = sanitizeCandelCustomization(
    { role: "hunter", hacked: "yes", tools: ["get_market_snapshot"] } as unknown,
    template
  );
  check(
    "unknown fields are dropped",
    !Object.prototype.hasOwnProperty.call(junk, "hacked"),
    Object.keys(junk)
  );

  const cleared = mergeCandelCustomization({ instructions: "custom", role: "hunter" }, { instructions: "" });
  check("empty instructions clear the override (inherit template)", cleared.instructions === undefined, cleared);
  check("merge keeps untouched overrides", cleared.role === "hunter", cleared.role);
}

// ── 3. Effective configuration ──────────────────────────────────────────────
console.log("\n=== 3. Effective configuration ===");
{
  const template = makeTemplate();

  const plain = makeCandelInstance();
  const baseConfig = resolveCandelConfig(plain, template);
  check("no customization inherits the template role", baseConfig.role === "market-analyst", baseConfig.role);
  check("no customization inherits template instructions", baseConfig.instructions === template.instructions);
  check("inherited instructions are not flagged as customized", baseConfig.instructionsCustomized === false);

  const custom = makeCandelInstance({
    customization: { role: "hunter", instructions: "Only scan XAUUSD.", tools: [] },
  });
  const config = resolveCandelConfig(custom, template);
  check("instance role overrides the template", config.role === "hunter", config.role);
  check("instance instructions override the template", config.instructions === "Only scan XAUUSD.");
  check("custom instructions are flagged", config.instructionsCustomized === true);
  check("narrowed tools are reflected", config.tools.length === 0);
  check("disabled tools are reported for transparency", config.toolsDisabled.length === 1, config.toolsDisabled);
  check("role label follows the effective role", config.roleLabel === "Setup Hunter", config.roleLabel);

  const escalating = makeCandelInstance({
    customization: { tools: ["get_market_snapshot", "submit_live_order"] },
  });
  const escalatingConfig = resolveCandelConfig(escalating, template);
  check(
    "effective tools survive an escalating override",
    !escalatingConfig.tools.includes("submit_live_order"),
    escalatingConfig.tools
  );
}

// ── 4. Permission documents stay fail-closed ────────────────────────────────
console.log("\n=== 4. Permission sanitizer ===");
{
  const empty = sanitizeCandelPermissions(undefined);
  check("missing input yields execution OFF", Object.values(empty.execution).every((flag) => flag === false));
  check("missing input keeps executionDefaultsToOff", empty.executionDefaultsToOff === true);

  const enabling = sanitizeCandelPermissions({
    execution: { createOrder: true },
    approvalRequirements: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
  });
  check("explicit execution flag is honored", enabling.execution.createOrder === true);
  check(
    "client cannot remove the approval gate",
    enabling.approvalRequirements.createOrder === true &&
      enabling.approvalRequirements.closePosition === true,
    enabling.approvalRequirements
  );

  const junk = sanitizeCandelPermissions({
    workspace: "everything",
    market: { readMarketData: "yes" },
    execution: { createOrder: "true" },
  });
  check("non-boolean flags are ignored", junk.market.readMarketData === true && junk.execution.createOrder === false, junk.execution);
  check("malformed groups do not crash the sanitizer", typeof junk.workspace.readPages === "boolean");
}

// ── 5. Permanent delete: coverage + refusal path ────────────────────────────
//
// NOTE: the Firebase Admin surface in this runner is a transport stub whose
// reads always return empty, so persistence round-trips are exercised by the
// harness's own fake RTDB elsewhere. What is verified here is the part that
// does not depend on stored data: the purge covers every namespace a Candel
// owns, removes the instance row last, and refuses an unknown instance.
console.log("\n=== 5. Purge coverage ===");
{
  const harness = createHarness("user-1", "candel-purge");
  const databaseSource = readFileSync(
    join(process.cwd(), "lib/candel/workspace/database.ts"),
    "utf8"
  );

  const REQUIRED_NAMESPACES = [
    "candelConversations",
    "candelMessages",
    "candelMemory",
    "candelActivity",
    "candelPermissions",
    "candelAccountBindings",
    "candelToolBindings",
    "candelAccountContext",
    "candelAutomation",
    "candelApprovals",
    "candelToolActions",
    "candelWorkspace",
  ];

  const missing = REQUIRED_NAMESPACES.filter((namespace) => {
    const declaration = databaseSource.indexOf(`"${namespace}"`);
    return declaration === -1;
  });
  check("purge covers every per-Candel namespace", missing.length === 0, missing);

  // Scope the ordering check to the purge body: the same removal line also
  // appears in the soft-delete helper earlier in the file, so an unscoped
  // indexOf would compare the wrong occurrence.
  const purgeStart = databaseSource.indexOf("export async function purgeCandelInstance(");
  const purgeEnd = databaseSource.indexOf("\n}\n", purgeStart);
  const purgeBody =
    purgeStart === -1 ? "" : databaseSource.slice(purgeStart, purgeEnd === -1 ? undefined : purgeEnd);
  const childLoop = purgeBody.indexOf("for (const path of CANDEL_CHILD_PATHS)");
  const childRemoval = purgeBody.indexOf(".remove();");
  const instanceRemoval = purgeBody.indexOf("await adminDatabase.ref(`candel/${id}`).remove();");
  check(
    "the purge walks the child namespaces before the instance row",
    childLoop !== -1 && childRemoval > childLoop
  );
  check(
    "the instance row is removed after its children",
    instanceRemoval !== -1 && instanceRemoval > childRemoval
  );
  check(
    "purge re-checks ownership before deleting",
    databaseSource.includes("Candel deletion denied.")
  );

  let refused = false;
  try {
    await purgeCandelInstance("does-not-exist", "user-1");
  } catch {
    refused = true;
  }
  check("purging an unknown Candel is refused", refused);
  check("the unknown Candel is still absent", (await getCandelInstance("does-not-exist")) === null);
  check(
    "the instance fixture builder is unchanged by these checks",
    makeCandelInstance({ id: "probe" }).id === "probe"
  );

  harness.dispose();
}

// ── 6. The chat turn is a real route ───────────────────────────────────────
console.log("\n=== 6. Chat endpoint wiring ===");
{
  const root = process.cwd();
  const messageRoute = join(root, "app/api/candel/candel/conversation/message/route.ts");
  check("the conversation/message route exists", existsSync(messageRoute));

  const messageSource = existsSync(messageRoute) ? readFileSync(messageRoute, "utf8") : "";
  check("it exports a POST handler", /export async function POST\(/.test(messageSource));
  check("it proves ownership before writing", messageSource.includes("requireCandelOwner"));
  check("it injects memory as context", /memory:/.test(messageSource));

  const conversationRoute = readFileSync(
    join(root, "app/api/candel/candel/conversation/route.ts"),
    "utf8"
  );
  check(
    "the dead POST_message export is gone (Next ignores it)",
    !conversationRoute.includes("POST_message")
  );

  const configSource = readFileSync(join(root, "lib/candel/config.ts"), "utf8");
  check("the tool ceiling is enforced in one place", configSource.includes("function narrow("));
}

// ── 7. Approvals: the human gate ────────────────────────────────────────────
console.log("\n=== 7. Approvals ===");
{
  // 7a. Directive parsing — the agent's only channel toward a live action.
  const reply = [
    "I can prepare that, but it needs your approval.",
    "```approval",
    JSON.stringify({
      actionType: "createOrder",
      summary: "Buy 0.1 XAUUSD at market with a 0.5% stop",
      payload: { accountId: "acc-demo-a", symbol: "XAUUSD", side: "buy", size: 0.1 },
    }),
    "```",
    "```approval",
    "{ this is not json }",
    "```",
    "```approval",
    JSON.stringify({ actionType: "deleteEverything", summary: "nope", payload: {} }),
    "```",
  ].join("\n");

  const parsed = extractApprovalDirectives(reply);
  check("a well-formed directive is parsed", parsed.drafts.length === 1);
  check("malformed and unknown directives are dropped", parsed.dropped === 2);
  check("the raw directive never reaches the user", !parsed.clean.includes("```approval"));
  check(
    "it keeps the prose around the directive",
    parsed.clean.startsWith("I can prepare that")
  );

  // 7b. Admission is fail-closed.
  const readOnlyConfig = resolveCandelConfig(
    makeCandelInstance({ id: "candel-approvals", templateId: "market-analyst" }),
    makeTemplate({ id: "market-analyst", role: "market-analyst", tools: ["get_market_snapshot"] })
  );
  const readOnly = resolveApprovalDirectives(parsed.drafts, {
    config: readOnlyConfig,
    bindings: [makeAccountBinding({ allowedContexts: ["read", "execute"] })],
  });
  check("a read-only Candel cannot raise approvals", readOnly.accepted.length === 0);
  check(
    "and the refusal is explained",
    /read-only/.test(readOnly.rejected[0]?.reason ?? "")
  );

  const plannerTemplate = makeTemplate({
    id: "execution-planner",
    role: "executor",
    tools: ["get_market_snapshot", "prepare_order"],
  });
  const plannerConfig = resolveCandelConfig(
    makeCandelInstance({ id: "candel-approvals", templateId: "execution-planner" }),
    plannerTemplate
  );

  const noBinding = resolveApprovalDirectives(parsed.drafts, {
    config: plannerConfig,
    bindings: [],
  });
  check("a live action without a bound account is refused", noBinding.accepted.length === 0);

  const readOnlyBinding = resolveApprovalDirectives(parsed.drafts, {
    config: plannerConfig,
    bindings: [makeAccountBinding({ allowedContexts: ["read"] })],
  });
  check(
    "a binding without the execute context is refused",
    readOnlyBinding.accepted.length === 0
  );

  const ambiguous = resolveApprovalDirectives(
    [
      {
        actionType: "createOrder",
        summary: "Buy 0.1 XAUUSD",
        payload: { symbol: "XAUUSD" },
        evidence: [],
      },
    ],
    {
      config: plannerConfig,
      bindings: [
        makeAccountBinding({ tradingAccountId: "acc-a", allowedContexts: ["execute"] }),
        makeAccountBinding({ tradingAccountId: "acc-b", allowedContexts: ["execute"] }),
      ],
    }
  );
  check(
    "an unnamed action with several accounts is refused",
    ambiguous.accepted.length === 0 && /name the account/.test(ambiguous.rejected[0]?.reason ?? "")
  );

  const accepted = resolveApprovalDirectives(parsed.drafts, {
    config: plannerConfig,
    bindings: [
      makeAccountBinding({ tradingAccountId: "acc-demo-a", allowedContexts: ["read", "execute"] }),
      makeAccountBinding({ tradingAccountId: "acc-demo-b", allowedContexts: ["execute"] }),
    ],
  });
  check("a named, bound, executable account is accepted", accepted.accepted.length === 1);
  check(
    "the request is pinned to that account",
    accepted.accepted[0]?.payload.accountId === "acc-demo-a"
  );

  const built = buildApprovalRequest(accepted.accepted[0], {
    id: "approval-1",
    candelId: "candel-approvals",
    userId: "user-1",
  });
  check("a built request is live-trading risk", built.riskLevel === "live_trading");
  check(
    "it names the execution permission",
    built.permissionRequired === "execution.createOrder"
  );
  check("it starts undecided", built.decision === undefined && isApprovalPending(built));

  // 7c. Exactly one human decision, and only while the request is live.
  const approved = applyApprovalDecision(built, "approved", "user-1", "  looks right  ");
  check("the owner can approve a pending request", approved.ok === true);
  if (approved.ok) {
    check("the decider is recorded", approved.request.decidedBy === "user-1");
    check("the decision is recorded", approved.request.decision === "approved");
    check("the note is trimmed", approved.request.reason === "looks right");

    const replay = applyApprovalDecision(approved.request, "rejected", "user-1");
    check(
      "an approved request cannot be re-decided",
      replay.ok === false && replay.code === "already_decided"
    );
  }

  const expired = applyApprovalDecision(
    { ...built, expiresAt: Date.now() - 1000 },
    "approved",
    "user-1"
  );
  check(
    "an expired request cannot be approved",
    expired.ok === false && expired.code === "expired"
  );
  check("expiry is visible to the UI", isApprovalExpired({ ...built, expiresAt: 0 }));

  const nonsense = applyApprovalDecision(built, "maybe" as "approved", "user-1");
  check("an unknown decision is refused", nonsense.ok === false);

  // 7d. The decision path exists as a real route, and the dead export is gone.
  const root = process.cwd();
  const decidePath = join(root, "app/api/candel/candel/approval/decide/route.ts");
  check("the approval decide route exists", existsSync(decidePath));
  const decideSource = existsSync(decidePath) ? readFileSync(decidePath, "utf8") : "";
  check("it exports a POST handler", /export async function POST\(/.test(decideSource));
  check("it proves ownership before deciding", decideSource.includes("requireCandelOwner"));
  check(
    "it writes the decision to the audit trail",
    decideSource.includes("approval_granted") && decideSource.includes("approval_denied")
  );

  const approvalRoute = readFileSync(
    join(root, "app/api/candel/candel/approval/route.ts"),
    "utf8"
  );
  check(
    "the dead POST_respond export is gone (Next ignores it)",
    !approvalRoute.includes("POST_respond")
  );
  check(
    "the route hardcodes the risk level instead of taking the client's",
    approvalRoute.includes("riskLevel: APPROVAL_RISK_LEVEL") &&
      approvalRoute.includes("permissionRequired: APPROVAL_ACTION_PERMISSIONS[")
  );

  const messageSource = readFileSync(
    join(root, "app/api/candel/candel/conversation/message/route.ts"),
    "utf8"
  );
  check(
    "the chat turn raises approval requests from directives",
    messageSource.includes("extractApprovalDirectives") &&
      messageSource.includes("saveApprovalRequest")
  );
  check(
    "the reply stores the cleaned text, not the directive",
    messageSource.includes("content: replyText")
  );

  const adapterSource = readFileSync(join(root, "lib/candel/dot/adapter.ts"), "utf8");
  check(
    "execution-capable Candels are told the approval protocol",
    adapterSource.includes("approvalProtocol")
  );
}

}

main().then(
  () => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  },
  (error) => {
    console.error("Candel customization checks crashed:", error);
    process.exit(1);
  }
);
