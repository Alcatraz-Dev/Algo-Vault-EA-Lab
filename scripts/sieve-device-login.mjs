#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Sieve device login — one-time, user-approved credential bootstrap.
//
//   npm run sieve:login
//
// It asks the Sieve server for a device code, shows you the approval URL and
// the short code, and polls until you approve in the browser. On success it
// writes SIEVE_API_KEY into .env.local (the local secret store) and NEVER
// prints the key.
//
// Phishing safeguard (2026 device-code attacks): the approval page shows where
// the code was requested from next to YOUR location, labels the tool name as
// self-reported, and warns you to approve only a code you started yourself.
// Approve ONLY the code this script just showed you. This script never opens
// the link, signs in, or approves on your behalf.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = (process.env.SIEVE_BASE_URL || "https://scrape.usesieve.com").replace(/\/+$/, "");
const ENV_FILE = resolve(process.cwd(), ".env.local");
const CLIENT_NAME = process.env.SIEVE_CLIENT_NAME || "freebuff";

function die(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

async function postJson(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  let parsed;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed };
}

/** Upsert KEY=value in .env.local without echoing the value. */
function upsertEnv(key, value) {
  let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) {
    contents = contents.replace(pattern, line);
  } else {
    if (contents.length > 0 && !contents.endsWith("\n")) contents += "\n";
    contents += `${line}\n`;
  }
  writeFileSync(ENV_FILE, contents, { mode: 0o600 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Requesting a Sieve device code from ${BASE_URL} ...`);
  const codeRes = await postJson("/api/auth/device/code", { client_name: CLIENT_NAME });
  if (codeRes.status !== 200 || !codeRes.body) {
    die(`Failed to start device login (HTTP ${codeRes.status}). ${JSON.stringify(codeRes.body)}`);
  }

  const { device_code, user_code, verification_uri_complete, expires_in, interval } = codeRes.body;

  console.log("\n──────────────────────────────────────────────────────────");
  console.log("  Open this URL in your browser and approve the code:");
  console.log(`\n    ${verification_uri_complete}\n`);
  console.log(`  Code to verify:  ${user_code}`);
  console.log("\n  • Sign in or sign up there (Google or email).");
  console.log("  • The page labels the tool name as self-reported.");
  console.log("  • Approve ONLY if you started this login yourself just now.");
  console.log("  • The code expires in 10 minutes and works once.");
  console.log("──────────────────────────────────────────────────────────\n");
  console.log("Waiting for approval ... (Ctrl-C to cancel)");

  let waitSeconds = Math.max(1, Number(interval) || 5);
  const deadline = Date.now() + (Number(expires_in) || 600) * 1000;

  while (Date.now() < deadline) {
    await sleep(waitSeconds * 1000);
    const res = await postJson("/api/auth/device/token", { device_code });
    if (res.status === 200 && res.body?.api_key) {
      upsertEnv("SIEVE_API_KEY", res.body.api_key);
      console.log(`\n✅ Approved. SIEVE_API_KEY written to ${ENV_FILE} (value not shown).`);
      console.log(`   Key name: ${res.body.key_name || "(unnamed)"}`);
      console.log("   Restart the dev server so it picks up the new value.");
      return;
    }
    const error = typeof res.body?.error === "string" ? res.body.error : "";
    if (res.status === 400 && error === "authorization_pending") continue;
    if (res.status === 400 && error === "slow_down") {
      waitSeconds += 5;
      continue;
    }
    if (res.status === 400 && error === "access_denied") die("You declined the request. Nothing was written.");
    if (res.status === 400 && error === "expired_token") die("The code expired. Run `npm run sieve:login` again.");
    die(`Device login failed (HTTP ${res.status}). ${JSON.stringify(res.body)}`);
  }

  die("The code expired before approval. Run `npm run sieve:login` again.");
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
