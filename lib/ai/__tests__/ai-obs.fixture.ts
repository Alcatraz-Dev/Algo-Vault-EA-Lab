// AI account observability fixture.
//
// Two modes:
//   1. A usage/budget dry run over configured providers (no live network
//      calls, no secrets) via the in-memory test seams.
//   2. A live router smoke run that resolves the fallback chain without
//      contacting a provider. Any live call would print only names and
//      booleans — never keys, tokens, prompts or payloads.
//
// Run with: node scripts/run-ai-obs.mjs
import { defaultRouter } from "../router";
import { AIConfig } from "../config";
import { getProviderRegistry } from "../../intelligence/provider-registry";

function shade(key: string, value: unknown): void {
  if (typeof value === "string" && /sk-|api[_-]?key|Bearer|sk-or|v1_|AIza/i.test(value)) {
    console.log(`  ${key} = <redacted>`);
    return;
  }
  console.log(`  ${key} = ${JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  console.log("=== AI account observability (dry run) ===");
  console.log(`AI_FREE_ONLY = ${AIConfig.freeOnly}`);
  console.log(`AI_DEFAULT_PROVIDER = ${AIConfig.defaultProvider}`);
  console.log(`AI_DEFAULT_MODEL = ${AIConfig.defaultModel}`);
  console.log(`maxAttempts = ${AIConfig.maxAttempts}`);

  // ── 1. What the registry knows (metadata only) ────────────────────────
  const registry = getProviderRegistry();
  console.log("Registered providers (metadata only):");
  for (const p of registry) {
    console.log(
      `  id=${p.id} enabled=${p.enabled} credConfigured=${p.credentialsConfigured} ` +
        `verified=${p.verified} priority=${p.priority} type=${p.type} cost=${p.costClass}`,
    );
  }

  // ── 2. Test-seam dry run over a couple of providers ───────────────────
  // Requires an in-memory budget reader + sink, which the router-touching
  // callers install via the runtime-guards test seams.
  // Here we hit a *budget-only* evaluation path — no provider is contacted.
  const { evaluateBudgetSafely } = await import("../runtime-guards");
  await import("../budget");

  console.log("Budget sanity (reload-safe cache: resolveAIBudgetConfig is cached 15s):");
  for (const provider of ["openrouter", "opencode", "codecraft"]) {
    const r = await evaluateBudgetSafely({ provider });
    console.log(`  provider=${provider} decision=${r.decision} stateAvailable=${r.stateAvailable}`);
  }

  // ── 3. Live-ish router chain resolution (no provider calls) ────────────
  // `getAvailableProviders` is the public wrapper over the router's private
  // `getAvailableCloudProviders`, which filters by `provider.isAvailable()`
  // and is the only place the gateway decides eligibility. Nothing below hits
  // the network — it only reads the configured keys and returns candidate order.
  const candidates = await defaultRouter.getAvailableProviders();
  console.log(`Candidate order (fallback chain, no provider call):`);
  for (const p of candidates) {
    shade(`provider ${p.id}`, { name: p.name, id: p.id });
  }
  console.log(`count = ${candidates.length}`);

  const models = await defaultRouter.getAllModels();
  console.log(`All models discovered: ${models.length}`);
  for (const m of models.slice(0, 20)) {
    shade(`model ${m.id}`, { provider: m.provider, free: m.free, confirmedFree: m.confirmedFree });
  }

  // ── 4. Synthetic chat (no live call — delivers a local heuristic result) ──
  const synthetic = await defaultRouter.chat({
    messages: [{ role: "user", content: "health check only, no real work" }],
  });
  console.log(`Synthetic chat -> provider=${synthetic.provider} content=${JSON.stringify(synthetic.content)}`);
}

main().catch((err) => {
  console.error("AI obs failed:", err);
  process.exit(1);
});
