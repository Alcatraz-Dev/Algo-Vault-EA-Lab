/**
 * Release channel / prerelease labeling guards.
 *
 * Runs with:
 *   node scripts/jiti-tsrun.mjs tests/release-channel.test.ts
 *
 * Confirmed failures covered:
 *  - Tag-triggered releases were always marked prerelease because
 *    `github.event.inputs.prerelease` is empty on tag events, so a stable
 *    `v1.0.0` tag would publish as a GitHub prerelease.
 *  - Manual dispatch could label a release "stable" while GitHub published it
 *    as a prerelease (or the reverse), hiding preview warnings on the site.
 *  - The manifest sync could commit a channel that contradicts the actual
 *    GitHub prerelease flag.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const script = path.join(root, "scripts", "release-channel.mjs");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "desktop-release.yml"),
  "utf8",
);
const manifestScript = fs.readFileSync(
  path.join(root, "scripts", "desktop-release-manifest.mjs"),
  "utf8",
);

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    throw e;
  }
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function outputs(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

check("preview tag is resolved as a prerelease", () => {
  const result = run(["--event", "push", "--ref", "v0.1.0-preview"]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.version, "0.1.0-preview");
  assert.equal(out.tag, "v0.1.0-preview");
  assert.equal(out.channel, "preview");
  assert.equal(out.prerelease, "true");
  assert.equal(out.release_name, "AlgoVault Desktop Preview");
});

check("stable tag is not marked prerelease", () => {
  const result = run(["--event", "push", "--ref", "v1.0.0"]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.channel, "stable");
  assert.equal(out.prerelease, "false");
  assert.equal(out.release_name, "AlgoVault Desktop");
});

check("beta tag is resolved as a beta prerelease", () => {
  const result = run(["--event", "push", "--ref", "v1.2.0-beta.3"]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.channel, "beta");
  assert.equal(out.prerelease, "true");
});

check("tag pushes ignore dispatch inputs", () => {
  const result = run([
    "--event",
    "push",
    "--ref",
    "v1.0.0",
    "--channel",
    "preview",
    "--prerelease",
    "true",
    "--version",
    "0.9.0-preview",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.version, "1.0.0");
  assert.equal(out.channel, "stable");
  assert.equal(out.prerelease, "false");
});

check("dispatch accepts a consistent stable release", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "1.0.0",
    "--channel",
    "stable",
    "--prerelease",
    "false",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.tag, "v1.0.0");
  assert.equal(out.channel, "stable");
  assert.equal(out.prerelease, "false");
});

check("dispatch accepts a consistent preview release", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "0.2.0-preview",
    "--channel",
    "preview",
    "--prerelease",
    "true",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const out = outputs(result.stdout);
  assert.equal(out.channel, "preview");
  assert.equal(out.prerelease, "true");
});

check("dispatch rejects stable channel published as prerelease", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "1.0.0",
    "--channel",
    "stable",
    "--prerelease",
    "true",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stable.*prerelease|prerelease.*stable/i);
});

check("dispatch rejects preview channel published as stable", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "0.2.0-preview",
    "--channel",
    "preview",
    "--prerelease",
    "false",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prerelease=true/);
});

check("dispatch rejects a stable channel with a prerelease version", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "0.2.0-preview",
    "--channel",
    "stable",
    "--prerelease",
    "false",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prerelease suffix/);
});

check("dispatch rejects a prerelease channel with a stable version", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "1.0.0",
    "--channel",
    "preview",
    "--prerelease",
    "true",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a prerelease version/);
});

check("dispatch rejects a channel/suffix mismatch", () => {
  const result = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "0.2.0-preview",
    "--channel",
    "beta",
    "--prerelease",
    "true",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match channel/);
});

check("invalid versions and channels fail with clear messages", () => {
  const badVersion = run(["--event", "push", "--ref", "vnot-a-version"]);
  assert.equal(badVersion.status, 1);
  assert.match(badVersion.stderr, /Invalid release version/);

  const badChannel = run([
    "--event",
    "workflow_dispatch",
    "--version",
    "1.0.0",
    "--channel",
    "nightly",
    "--prerelease",
    "false",
  ]);
  assert.equal(badChannel.status, 1);
  assert.match(badChannel.stderr, /Invalid channel/);
});

check("workflow derives the prerelease flag from the validated output", () => {
  assert.match(workflow, /needs: validate/, "build must depend on the validation job");
  assert.match(workflow, /needs: \[validate, build\]/, "publish must depend on validation");
  assert.match(workflow, /node scripts\/release-channel\.mjs/);
  assert.match(workflow, /prerelease: \$\{\{ needs\.validate\.outputs\.prerelease == 'true' \}\}/);
  assert.ok(
    !/prerelease: \$\{\{ github\.event\.inputs\.prerelease/.test(workflow),
    "the release's prerelease field must use the validated output, not the raw dispatch input",
  );
  assert.match(workflow, /CHANNEL: \$\{\{ needs\.validate\.outputs\.channel \}\}/);
});

check("manifest sync refuses a channel that contradicts the GitHub release", () => {
  assert.match(manifestScript, /incompatible with GitHub prerelease/);
  assert.match(manifestScript, /expectsPrerelease = requestedChannel !== "stable"/);
});

console.log(`\nrelease channel guards passed: ${passed}`);
