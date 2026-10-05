/* TEMPORARY diagnostic probe — live provider reachability + router behaviour. */
import { defaultRouter } from "../lib/ai/router";
import { getUnifiedRouter } from "../lib/intelligence/router";
import { getProviderRegistry } from "../lib/intelligence/provider-registry";

async function main() {
    console.log("=== ENV ===");
    console.log("AI_FREE_ONLY =", process.env.AI_FREE_ONLY);
    console.log("AI_DEFAULT_PROVIDER =", process.env.AI_DEFAULT_PROVIDER);
    console.log("AI_DEFAULT_MODEL =", process.env.AI_DEFAULT_MODEL);

    console.log("\n=== LEGACY GATEWAY PROVIDERS ===");
    for (const p of defaultRouter.getRegisteredProviders()) {
        const avail = await Promise.resolve(p.isAvailable()).catch((e) => `ERR:${String(e)}`);
        let models: string[] = [];
        let modelsErr = "";
        try {
            models = (await p.getModels()).map((m) => m.id);
        } catch (e) {
            modelsErr = String(e).slice(0, 120);
        }
        console.log(`\n-- ${p.id} available=${String(avail)} models=${models.length}${modelsErr ? " ERR=" + modelsErr : ""}`);
        console.log(`   ${models.slice(0, 25).join(", ")}`);

        try {
            const res = await p.chat({
                messages: [{ role: "user", content: "Reply with exactly: OK" }],
                maxTokens: 20,
                temperature: 0,
            });
            console.log(`   CHAT OK provider=${res.provider} model=${res.model} content=${JSON.stringify(String(res.content).slice(0, 120))}`);
        } catch (e) {
            const err = e as { code?: string; status?: number; message?: string };
            console.log(`   CHAT FAIL code=${err.code} status=${err.status} msg=${String(err.message).slice(0, 200)}`);
        }
    }

    console.log("\n=== UNIFIED ROUTER CANDIDATES (free tier) ===");
    const router = getUnifiedRouter();
    const cands = await router.candidateOrder({
        task: "SIGNAL_EXPLANATION",
        messages: [{ role: "user", content: "hi" }],
        userTier: "free",
    });
    console.log("candidates:", cands.map((c) => `${c.provider.id}/${c.model ?? "?"}`).join(", ") || "(none)");

    console.log("\n=== UNIFIED ROUTER EXECUTE ===");
    const res = await router.execute({
        task: "SIGNAL_EXPLANATION",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        userTier: "free",
    });
    console.log(JSON.stringify({ provider: res.provider, model: res.model, content: res.content.slice(0, 120), validationStatus: res.validationStatus, attempts: res.attempts, errors: res.errors }, null, 2));

    console.log("\n=== REGISTRY ===");
    for (const r of getProviderRegistry()) {
        console.log(`${r.id.padEnd(18)} enabled=${String(r.enabled).padEnd(5)} creds=${String(r.credentialsConfigured).padEnd(5)} verified=${String(r.verified).padEnd(5)} cost=${r.costClass}`);
    }
    process.exit(0);
}

main().catch((e) => {
    console.error("PROBE CRASH", e);
    process.exit(1);
});