# AlgoVault Agent IDE — Developer Documentation

A secure, AlgoVault-specialized engineering agent. Its only purpose is to
develop, debug, test, inspect, document and verify the AlgoVault platform. It
is **not** a general-purpose assistant, and it refuses out-of-scope requests in
code — not just via prompts.

---

## Architecture

```
lib/agent/
  core/
    types.ts            Shared types: modes, tools, events, plans, limits, run records
    runtime.ts          Orchestrator: lifecycle loop, planner, executor, verifier
    scope-guard.ts      Mission boundary classifier (in/out of scope, refuse in code)
    rtdb-store.ts       RTDB-only persistence (deepClean REF wrapper + sanitization)
  policies/
    path-sandbox.ts     Canonical path resolution, traversal+symlink containment, denylist
    redaction.ts        Secret redaction (strings, deep objects, persistence scrubbing)
    command-policy.ts   Command classifier: safe / restricted / blocked
    permission-engine.ts Mode capability matrix, structural blocks, confirmations
  tools/
    fs-tools.ts         search / read / write / edit / rename / delete (sandboxed)
    git-tools.ts        status / diff / log / branch / commit (no push surface exists)
    terminal-tools.ts   Bounded command runner + terminal.run tool
    test-tools.ts       typecheck / lint / build / suite:<name> via jiti runners
    knowledge-tools.ts  memory + docs search + project profile
    registry.ts         The single choke point: every call passes evaluatePolicy
  context/
    project-profile.ts  AlgoVault specialization data (stack, constraints, rules)
    rule-engine.ts      Codified architecture rules with pure detect functions
    repo-map.ts         Cached, denylist-aware structural map
    context-builder.ts  Targeted, budgeted context assembly
  models/
    model-client.ts     AI Router integration (source="agent", fail-closed budget)
  __tests__/            Security + lifecycle suite (jiti runner)

app/agent/              Admin-guarded UI route
app/api/agent/          run / runs / policy routes (requireAdmin)
components/agent/       AgentIDE cockpit
docs/agent-ide.md       This file
```

### Lifecycle

```
request → scope guard → context build → AI plan (via defaultRouter)
        → project-rule gate → step execution through the tool registry
        → confirmations (await human approval when required)
        → verification (typecheck / targeted suites)
        → git diff capture → sanitized RTDB record + final report
```

Cancellation (`AbortController`) is honored by every bounded command; the stop
button in the UI aborts the run. Limits (iterations, files, commands, runtime,
AI requests, retries) are enforced in `core/types.ts` (`isLimitReached`) and
inside the registry on every call.

---

## Security boundary

### Path sandbox (`policies/path-sandbox.ts`)
- Project root = `AGENT_PROJECT_ROOT` (tests) or `process.cwd()`, verified via
  `realpathSync` as a real directory. **If it cannot be verified, every
  filesystem/terminal operation is denied (fail closed).**
- Lexical containment (`path.resolve` + relative check) catches `../` and
  absolute external paths before any I/O.
- Real-chain resolution catches symlinks: each path is realpath-resolved as far
  as it exists; any component resolving outside the root is denied. Dangling
  tails under real directories are re-joined and re-checked.
- NUL/control bytes are rejected outright.
- Sensitive denylist: `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
  `service-account.json`, `credentials.json`, `secrets*`, `id_rsa`,
  `id_ed25519`, `known_hosts`, `.npmrc`, `.netrc`, `.git-credentials`,
  `private-files/`, plus contains-matching for `service-account`,
  `credentials`, `secrets`. Reads return only
  `"Sensitive file detected and intentionally excluded from Agent context."`
  Existence may be reported; contents never leave the sandbox.

### Secret redaction (`policies/redaction.ts`)
- `redactSecrets` applies ordered, broad rules (JWT, Bearer, OpenAI/Stripe/
  AWS/Google keys, bot tokens, connection strings, private-key and certificate
  blocks, Authorization/Cookie headers, service-account emails) to every tool
  output, AI prompt and persisted string.
- `sanitizeForPersistence` additionally **drops** forbidden key names
  (`private_key`, `password`, `apiKey`, `cookie`, `authorization`, …) entirely
  before any RTDB write.

### Command policy (`policies/command-policy.ts`)
Every command is split into pipeline segments and classified per segment:
- **safe** — project scripts (`npm run lint|build|test|typecheck…`), read-only
  git, read-only shell, toolchain binaries (`tsc`, `eslint`, `next`, `node`).
- **restricted** — needs an explicit, per-target human confirmation: `git
  commit`, package install, plain `rm`, anything unclassifiable (fail closed).
- **blocked** — `rm -rf`, git push/reset/rebase/clean, deploys (`vercel`,
  `firebase deploy`, …), `curl|ssh` network, credential access (`cat .env`,
  keychains), sudo/system admin, process kill, command substitution (`` ` ``,
  `$()` — unclassifiable), `node -e`.
Compound commands inherit the worst segment.

### Permission engine (`policies/permission-engine.ts`)
- Mode capability matrix: ASK is read-only; ASSIST adds writes; ENGINEER adds
  deletes/terminal-restricted/commit; AUTONOMOUS equals ENGINEER with tighter
  loop limits.
- `STRUCTURALLY_BLOCKED` — `git_push`, `deployment`, `production_access`,
  `external_filesystem`, `terminal_destructive` are refused in **every** mode
  even with overrides.
- Confirmations are bound to tool + target (`fs.delete:<path>`,
  `terminal.run:<command>`, `git.commit:<message>`) so a grant cannot be
  replayed for a different action.
- Unverified project root denies all workspace-touching tools.

### Scope guard (`core/scope-guard.ts`)
Classifies every request before planning. Credential harvesting, personal
files, unrelated projects/repos, OS administration, production infrastructure
and hacking requests are refused in code with a generic refusal message.

### Budget (AI)
`models/model-client.ts` calls `defaultRouter.chat(..., { source: "agent",
sourceId, userId })` — the existing pre-flight budget guard
(`evaluateBudgetSafely`) is therefore authoritative. A `budgetBlocked`
response stops the run safely (recorded as a `budget_exceeded` event); the
agent never retries around the budget. A per-run AI-request cap is enforced on
top.

---

## Tool system

Tools are declared twice, deliberately: executable metadata
(`defineTool` in each tool file) and a policy declaration in
`tools/registry.ts` (`TOOL_DECLARATIONS`). The registry is the **only**
execution path used by the runtime:

```
registry.execute(toolId, args, ctx, policyState)
  → isLimitReached check → evaluatePolicy → tool.execute → accounting/events
```

Current tools: `fs.search|read|write|edit|rename|delete`, `git.status|diff|
log|branch|commit`, `terminal.run`, `tests.run`, `memory.write|list|search|
delete`, `docs.search`, `profile.get`.

There is no `git.push` tool and no deployment tool — the capability does not
exist to be misconfigured.

### Adding a new safe tool
1. Implement it in a `tools/*.ts` file with `defineTool`, enforcing the path
   sandbox / redaction inside the executor.
2. Add its policy declaration to `TOOL_DECLARATIONS` (never requiring a
   structurally blocked permission).
3. Register it in `createDefaultRegistry()`.
4. Add tests to `lib/agent/__tests__/agent-ide.test.ts`.

### Adding a new project rule
Append an entry to `PROJECT_RULES` in `context/rule-engine.ts` with a pure
`detect(input)` returning a conflict string or `null`, and a severity
(`block` stops the run; `warn` emits an event). Add a test.

### Testing security boundaries
```
node scripts/jiti-tsrun.mjs lib/agent/__tests__/run-agent-ide-tests.ts
```
The suite covers traversal/absolute/symlink escapes, the sensitive denylist,
secret redaction + persistence scrubbing, command blocks/restrictions/safe
allowlist, structural policy blocks, mode enforcement, confirmation binding,
scope refusals, run limits, rule conflicts and tool-surface integrity
(no push/deploy tool exists). Filesystem tests run in a temp sandbox via
`AGENT_PROJECT_ROOT`.

---

## Integrations (existing systems, not duplicates)

| System | Integration |
| --- | --- |
| AI Router | `defaultRouter.chat` with `source:"agent"` (`lib/ai/usage-events.ts` source enum) |
| AI Budget | Enforced inside the router; agent fails closed on `budgetBlocked` |
| Auth | `requireAdmin` on every `/api/agent/*` route; UI behind `AdminGuard` |
| RTDB | Own tree (`agentRuns/`, `agentMemory/`, `agentProjectProfile`) with the shared deepClean REF pattern — never Firestore |
| Tests | Repo-canonical jiti runners (`node scripts/jiti-tsrun.mjs …`) |
| Git | Read-only + confirmation-gated commit; never touches remotes |

### Workflow Logic & Workspace
The runtime's plan is a structured execution graph (steps with tool intents)
and the UI renders execution state — the same shape the existing Workflow
Automation and Workspace surfaces visualize. Deeper bridge (e.g. rendering an
agent run as a workflow DAG in the workspace canvas) is intentionally **not**
built yet to avoid coupling the agent to `lib/workflows` internals; the plan
type is designed to make that a small adapter later.

### Market Intelligence
The rule engine enforces MI's evidence-driven constraint in code (fabricated
signal/price/evidence patterns are flagged), and the profile instructs the
agent to integrate with existing MI modules. The agent creates no second MI
engine.

---

## Operating the IDE

1. Sign in as an admin and open `/agent`.
2. Pick a mode (ASK/ASSIST/ENGINEER/AUTONOMOUS) — the permission panel always
   shows what the current mode allows and what is always blocked.
3. Describe an AlgoVault engineering task and press **Run agent**.
4. Watch the activity feed; approve or deny confirmations in the Approvals
   panel; **Stop** aborts the run at the next command boundary.
5. Run records (request, mode, status, files changed, verification, stats,
   summary) persist to `agentRuns/{uid}/{runId}` — sanitized, no secrets.

## Known limitations

- The executor runs one tool call per plan step per iteration (bounded); it is
  not a free-form loop by design.
- Confirmations are process-local: they live in the server process that
  started the run. A server restart drops pending confirmations (fail closed —
  the run must be restarted).
- Browser/UI verification is not implemented: the platform has no existing
  safe browser-automation capability to integrate, and creating unrestricted
  browser access is forbidden. Verification currently = typecheck + targeted
  suites + diff review.
- `tests.run suite:agentIde` refers to this subsystem's suite; add other
  suites to `KNOWN_SUITES` in `tools/test-tools.ts` as needed.
- Lint deltas repo-wide belong to pre-existing in-flight work outside
  `lib/agent`/`app/agent`; the agent tree itself lints clean.
