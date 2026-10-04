#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Sieve live smoke check — one real run against a small public page.
//
//   npm run sieve:smoke
//
// Verifies 202 acceptance, polling to "done", and the file download. This
// SPENDS A FEW SIEVE CREDITS. Requires SIEVE_API_KEY (run `npm run sieve:login`
// first). The API key is never printed.
// ─────────────────────────────────────────────────────────────────────────────

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = (process.env.SIEVE_BASE_URL || "https://scrape.usesieve.com").replace(/\/+$/, "");
const API_KEY = (process.env.SIEVE_API_KEY || "").trim();
const TARGET = process.env.SIEVE_SMOKE_URL || "https://quotes.toscrape.com";
const INSTRUCTION = process.env.SIEVE_SMOKE_INSTRUCTION || "Extract the text and author of each quote";
const INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 30000;
const MAX_POLLS = 120;

if (!API_KEY) {
  console.error("✖ SIEVE_API_KEY is not set. Run `npm run sieve:login` first.");
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getRun(sessionId) {
  const res = await fetch(`${BASE_URL}/api/scrapes/${encodeURIComponent(sessionId)}`, {
    headers: authHeaders,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET /api/scrapes/${sessionId} → HTTP ${res.status}`);
  return res.json();
}

function report(run) {
  console.log(`\nstatus: ${run.status}`);
  if (run.summary) console.log(`summary: ${run.summary}`);
  if (run.turns !== undefined) console.log(`turns: ${run.turns}`);
  const conformance = run.schema_conformance?.status;
  if (conformance) {
    const clean = conformance === "pass";
    console.log(`schema_conformance: ${conformance}${clean ? "" : "  ⚠ not clean data"}`);
  }
  if (Array.isArray(run.files) && run.files.length > 0) {
    console.log(`files (${run.files.length}):`);
    for (const file of run.files) {
      console.log(`  - ${file.name} (${file.ext}, ${file.size} bytes)`);
      console.log(`    ${file.url.startsWith("http") ? file.url : BASE_URL + file.url}`);
    }
  }
}

async function main() {
  console.log(`Starting a live Sieve run (this spends a few credits) ...`);
  console.log(`  target: ${TARGET}`);
  console.log(`  instruction: ${INSTRUCTION}\n`);

  const startRes = await fetch(`${BASE_URL}/api/scrapes`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: INSTRUCTION,
      target_urls: [TARGET],
      fields: ["text", "author"],
      compliance_mode: "regular",
    }),
  });

  const started = await startRes.json().catch(() => ({}));
  console.log(`POST /api/scrapes → HTTP ${startRes.status}`);
  if (startRes.status !== 202 || !started.session_id) {
    console.error(`✖ Expected 202 with a session_id. ${JSON.stringify(started)}`);
    process.exit(1);
  }
  const sessionId = started.session_id;
  console.log(`session_id: ${sessionId}\n`);

  let delay = INTERVAL_MS;
  let run;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    await sleep(delay);
    run = await getRun(sessionId);
    console.log(`  poll ${poll + 1}: ${run.status}`);
    if (run.status === "done") break;
    if (run.status === "refused") {
      console.error(`\n✖ Refused: ${run.refusal?.code ?? "unknown"}. ${run.refusal?.message ?? ""}`);
      process.exit(1);
    }
    if (run.status !== "running" && run.status !== "queued") {
      console.error(`\n✖ Unrecognized status: ${run.status}`);
      process.exit(1);
    }
    delay = Math.min(MAX_INTERVAL_MS, Math.round(delay * 1.5));
  }

  if (!run || run.status !== "done") {
    console.error("\n✖ Run did not finish within the poll budget.");
    process.exit(1);
  }

  report(run);

  const firstFile = Array.isArray(run.files) ? run.files[0] : undefined;
  if (firstFile) {
    const url = firstFile.url.startsWith("http") ? firstFile.url : `${BASE_URL}${firstFile.url}`;
    const fileRes = await fetch(url, { headers: authHeaders, cache: "no-store" });
    console.log(`\nfile download: HTTP ${fileRes.status} (${fileRes.headers.get("content-type") ?? "?"})`);
    if (!fileRes.ok) process.exit(1);
    console.log("✅ live run reached done and the file downloaded.");
  } else {
    console.log("✅ live run reached done (no files were delivered).");
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
