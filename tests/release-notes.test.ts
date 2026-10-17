/**
 * Release-notes rendering guards.
 *
 * Runs with:
 *   node scripts/jiti-tsrun.mjs tests/release-notes.test.ts
 *
 * Confirmed failures covered:
 *  - Every release body was titled "Preview" and carried unsigned-build
 *    warnings, including beta and stable releases.
 *  - Windows/macOS signing state was hardcoded rather than read from the build
 *    that produced the artifacts.
 *  - Release notes could claim a build was signed without evidence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { renderReleaseNotes } from "../scripts/release-notes.mjs";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "desktop-release.yml"),
  "utf8",
);

const MAC_ASSET = "AlgoVault-0.1.0-preview-arm64.dmg";
const WIN_ASSET = "AlgoVault-Setup-0.1.0-preview-x64.exe";

const unsigned = {
  macos: { fileName: MAC_ASSET, signingKnown: true, signed: false, notarized: false },
  windows: { fileName: WIN_ASSET, signingKnown: true, signed: false },
};

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

check("preview release is labelled preview with installation warnings", () => {
  const notes = renderReleaseNotes({ version: "0.1.0-preview", channel: "preview", ...unsigned });
  assert.match(notes, /^## AlgoVault Desktop Preview v0\.1\.0-preview$/m);
  assert.match(notes, /\*\*preview release\*\*/);
  assert.match(notes, /unsigned and unnotarized/);
  assert.match(notes, /right-click \(or Control-click\)/);
  assert.match(notes, /Do not disable Gatekeeper globally/);
  assert.match(notes, /not code-signed/);
  assert.match(notes, /SmartScreen/);
  assert.match(notes, /\*This is preview software\./);
});

check("beta release is labelled beta, not preview", () => {
  const notes = renderReleaseNotes({ version: "1.2.0-beta.1", channel: "beta", ...unsigned });
  assert.match(notes, /^## AlgoVault Desktop Beta v1\.2\.0-beta\.1$/m);
  assert.match(notes, /\*\*beta release\*\*/);
  assert.doesNotMatch(notes, /Preview/);
  assert.match(notes, /\*This is beta software\./);
});

check("stable release is not labelled preview or beta", () => {
  const notes = renderReleaseNotes({ version: "1.0.0", channel: "stable", ...unsigned });
  assert.match(notes, /^## AlgoVault Desktop v1\.0\.0$/m);
  assert.match(notes, /\*\*stable release\*\*/);
  assert.doesNotMatch(notes, /Preview|Beta/);
  assert.doesNotMatch(notes, /Use at your own risk/);
  // Unsigned builds still need their security guidance even when stable.
  assert.match(notes, /Gatekeeper/);
  assert.match(notes, /SmartScreen/);
});

check("signed and notarized macOS build drops the unsigned warning", () => {
  const notes = renderReleaseNotes({
    version: "1.0.0",
    channel: "stable",
    macos: { fileName: MAC_ASSET, signingKnown: true, signed: true, notarized: true },
    windows: { fileName: WIN_ASSET, signingKnown: true, signed: true },
  });
  assert.match(notes, /Developer ID signed and notarized/);
  assert.doesNotMatch(notes, /unsigned and unnotarized/);
  assert.doesNotMatch(notes, /right-click \(or Control-click\)/);
  assert.match(notes, /installer is code-signed/);
  assert.doesNotMatch(notes, /SmartScreen/);
});

check("signed but not notarized macOS build keeps conservative guidance", () => {
  const notes = renderReleaseNotes({
    version: "0.2.0-preview",
    channel: "preview",
    macos: { fileName: MAC_ASSET, signingKnown: true, signed: true, notarized: false },
    windows: { fileName: WIN_ASSET, signingKnown: true, signed: false },
  });
  assert.match(notes, /signed but not notarized/);
  assert.match(notes, /right-click \(or Control-click\)/);
});

check("unknown signing status is reported conservatively", () => {
  const notes = renderReleaseNotes({
    version: "0.3.0-preview",
    channel: "preview",
    macos: { fileName: MAC_ASSET, signingKnown: false, signed: false, notarized: false },
    windows: { fileName: WIN_ASSET, signingKnown: false, signed: false },
  });
  assert.match(notes, /macOS:\*\* signing status could not be determined/);
  assert.match(notes, /Windows:\*\* signing status could not be determined/);
  assert.doesNotMatch(notes, /the app is unsigned and unnotarized/);
  assert.doesNotMatch(notes, /installer is code-signed/);
});

check("asset filenames come from the supplied build artifacts", () => {
  const notes = renderReleaseNotes({
    version: "0.1.0-preview",
    channel: "preview",
    macos: { fileName: "Custom-arm64.dmg", signingKnown: true, signed: false, notarized: false },
    windows: { fileName: "Custom-Setup-x64.exe", signingKnown: true, signed: false },
  });
  assert.match(notes, /`Custom-arm64\.dmg`/);
  assert.match(notes, /`Custom-Setup-x64\.exe`/);
});

check("CLI renders from downloaded assets and signing metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "algovault-notes-"));
  const out = path.join(dir, "release-notes.md");
  try {
    fs.writeFileSync(path.join(dir, MAC_ASSET), "stub");
    fs.writeFileSync(path.join(dir, WIN_ASSET), "stub");
    fs.writeFileSync(
      path.join(dir, "build-meta-macos.json"),
      JSON.stringify({ signed: false, notarized: false }),
    );
    fs.writeFileSync(path.join(dir, "build-meta-windows.json"), JSON.stringify({ signed: false }));

    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release-notes.mjs"),
        "--version",
        "0.1.0-preview",
        "--channel",
        "preview",
        "--assets-dir",
        dir,
        "--out",
        out,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const notes = fs.readFileSync(out, "utf8");
    assert.match(notes, new RegExp(MAC_ASSET.replace(/\./g, "\\.")));
    assert.match(notes, new RegExp(WIN_ASSET.replace(/\./g, "\\.")));
    assert.match(notes, /unsigned and unnotarized/);
    assert.match(notes, /SmartScreen/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check("workflow generates notes from build metadata and the resolved channel", () => {
  assert.match(workflow, /scripts\/release-notes\.mjs/);
  assert.match(workflow, /--assets-dir release-assets/);
  assert.match(workflow, /build-meta-macos\.json/);
  assert.match(workflow, /build-meta-windows\.json/);
  assert.match(workflow, /CHANNEL: \$\{\{ needs\.validate\.outputs\.channel \}\}/);
  assert.ok(!/AlgoVault-\{version\}/.test(workflow), "no unresolved asset placeholder");
  assert.ok(
    !/AlgoVault Desktop Preview vVERSION_PLACEHOLDER/.test(workflow),
    "release title must not be hardcoded as Preview",
  );
});

console.log(`\nrelease notes guards passed: ${passed}`);
