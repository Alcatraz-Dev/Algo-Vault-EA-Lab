/**
 * Desktop download wiring guards.
 *
 * Runs with:
 *   node scripts/jiti-tsrun.mjs tests/desktop-downloads.test.ts
 *
 * Confirmed failures covered (credential-free, structural):
 *  - The homepage advertised install buttons while every `download_url` was
 *    empty, so clicking did nothing.
 *  - The release manifest could claim a platform is available without naming
 *    an asset from the published release.
 *  - Release notes / platform copy claimed a "Universal" macOS package while
 *    only an Apple Silicon (ARM64) build exists.
 *  - The release workflow could publish a release while the website manifest
 *    stayed stale (or empty).
 *
 * Remote asset existence is verified separately against the GitHub Releases
 * API; this suite stays offline so it can run in CI without network access.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

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

const manifest = JSON.parse(read("public/downloads/releases.json"));
const component = read("components/home/DesktopDownloadSection.tsx");
const workflow = read(".github/workflows/desktop-release.yml");
const syncScript = read("scripts/desktop-release-manifest.mjs");

const REPO = "Alcatraz-Dev/Algo-Vault-EA-Lab";
const platforms = manifest.platforms as Record<string, Record<string, unknown>>;

check("manifest is valid JSON with the fields the frontend reads", () => {
  assert.equal(typeof manifest.version, "string");
  assert.ok(manifest.version.length > 0, "version must not be empty");
  assert.equal(typeof manifest.channel, "string");
  assert.equal(typeof manifest.published, "string");
  assert.match(manifest.published, /^\d{4}-\d{2}-\d{2}$/, "published must be a date");
  assert.equal(typeof manifest.platforms, "object");
  assert.ok(platforms.windows, "windows platform entry is required");
  assert.ok(platforms.macos, "macos platform entry is required");
});

check("release is published as a preview, not a stable release", () => {
  assert.equal(manifest.channel, "preview");
  assert.equal(manifest.prerelease, true);
  assert.equal(manifest.tag, `v${manifest.version}`);
  assert.equal(manifest.next_stable_version, "0.1.0");
  assert.equal(
    manifest.source,
    `https://github.com/${REPO}/releases/tag/${manifest.tag}`,
    "source must point at the published release",
  );
});

check("every available platform points at a real release asset URL", () => {
  for (const [key, platform] of Object.entries(platforms)) {
    if (platform.status !== "available") continue;

    const downloadUrl = platform.download_url as string;
    const fileName = platform.file_name as string;

    assert.ok(downloadUrl, `${key}.download_url must not be empty when available`);
    assert.ok(fileName, `${key}.file_name must be present when available`);
    assert.equal(
      downloadUrl,
      `https://github.com/${REPO}/releases/download/${manifest.tag}/${fileName}`,
      `${key} must use the release asset URL for ${manifest.version}`,
    );
    assert.ok(
      !/\/archive\/refs\//.test(downloadUrl),
      `${key} must not link a source-code archive as an installer`,
    );
    assert.ok(
      !downloadUrl.includes("/downloads/"),
      `${key} must not rely on a local public/downloads artifact`,
    );
  }
});

check("only downloadable platforms are marked available", () => {
  for (const [key, platform] of Object.entries(platforms)) {
    if (platform.status === "available") {
      assert.ok(platform.download_url, `${key} available without a download URL`);
    } else {
      assert.ok(
        !platform.download_url || platform.download_url === "",
        `${key} must not advertise a URL unless it is verified available`,
      );
    }
  }
});

check("asset metadata is present and self-consistent", () => {
  for (const [key, platform] of Object.entries(platforms)) {
    if (platform.status !== "available") continue;

    assert.ok(
      typeof platform.file_size_bytes === "number" && platform.file_size_bytes > 50_000_000,
      `${key} installer size must be recorded from the release`,
    );
    assert.match(
      platform.file_size_human as string,
      /^\d+(\.\d+)? MB$/,
      `${key} needs a human-readable size`,
    );
    assert.match(
      platform.checksum_sha256 as string,
      /^[0-9a-f]{64}$/,
      `${key} needs the published SHA-256 digest`,
    );
    assert.ok(
      (platform.notes as string).toLowerCase().includes("preview"),
      `${key} notes must state preview status`,
    );
  }
});

check("platform labels identify the published architectures", () => {
  assert.ok(
    (platforms.macos.arch as string[]).some((a) => /arm64/i.test(a)),
    "macOS must be labelled Apple Silicon / ARM64",
  );
  assert.ok(
    (platforms.windows.arch as string[]).some((a) => /x64/i.test(a)),
    "Windows must be labelled x64",
  );
  assert.equal(platforms.macos.build_target, "dmg");
  assert.equal(platforms.windows.build_target, "nsis");
});

check("frontend consumes the manifest instead of hardcoded download URLs", () => {
  assert.match(component, /fetch\("\/downloads\/releases\.json"/);
  assert.match(component, /download_url/, "component must read download_url");
  assert.ok(
    !/github\.com\/.+\/releases\/download\//.test(component),
    "download URLs must not be duplicated in the component",
  );
  assert.ok(
    !/AlgoVault-Setup|AlgoVault-0\.1\.0-preview-arm64/.test(component),
    "asset filenames must come from the manifest",
  );
});

check("download button is only rendered for a non-empty verified URL", () => {
  assert.match(component, /const downloadUrl = platform\?\.download_url\?\.trim\(\)/);
  assert.match(component, /const hasDownload = Boolean\(downloadUrl\)/);
  assert.match(component, /href=\{downloadUrl\}/);
  assert.ok(!/href=\{""\}/.test(component), "no placeholder empty href");
  assert.ok(!/href="#"/.test(component), "no placeholder # download links");
  assert.match(component, /Installer not available yet/, "unavailable platforms need a disabled state");
});

check("loading, error, and unavailable states are handled", () => {
  assert.match(component, /Checking latest release/, "loading state required");
  assert.match(component, /Release information unavailable/, "error state required");
  assert.match(component, /Installer not available yet/, "unavailable state required");
  assert.match(component, /SmartScreen/, "Windows install warning required");
  assert.match(component, /right-click → Open/, "macOS Gatekeeper guidance required");
  assert.ok(
    !/disable.{0,20}(Gatekeeper|SmartScreen|security)/i.test(component),
    "must not advise disabling OS security",
  );
});

check("installer selection in the sync script matches published asset names only", () => {
  assert.match(syncScript, /\\\.dmg\$/, "macOS must look for a .dmg asset");
  assert.match(syncScript, /arm64\|aarch64\|universal/, "macOS must require an ARM64/universal asset");
  assert.match(syncScript, /\\\.exe\$/, "Windows must look for a .exe asset");
  assert.match(syncScript, /does not exist yet/, "missing releases must fail loudly");
  assert.match(syncScript, /status = "unavailable"/, "missing assets must mark the platform unavailable");
});

check("release workflow syncs the website manifest after publishing", () => {
  assert.match(workflow, /Sync website download manifest/);
  assert.match(workflow, /scripts\/desktop-release-manifest\.mjs/);
  assert.match(
    workflow,
    /git commit -m "chore: sync desktop download manifest for \$\{TAG\}"/,
    "manifest update must be committed so the site stops advertising stale files",
  );
});

check("release notes come from the channel-aware generator", () => {
  assert.match(workflow, /scripts\/release-notes\.mjs/, "notes must be generated from build metadata");
  assert.match(workflow, /--assets-dir release-assets/);
  assert.ok(!/AlgoVault-\{version\}/.test(workflow), "no unresolved asset placeholder");
});

console.log(`\ndesktop download guards passed: ${passed}`);
