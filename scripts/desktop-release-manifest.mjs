#!/usr/bin/env node
/**
 * Keep `public/downloads/releases.json` in sync with a published GitHub Release.
 *
 * The website renders download buttons from this manifest only. Assets are
 * selected from the release itself (never inferred from the build workflow), so
 * the site can never advertise an installer that was not uploaded.
 *
 * Usage:
 *   node scripts/desktop-release-manifest.mjs --tag v0.1.0-preview --check
 *   node scripts/desktop-release-manifest.mjs --tag v0.1.0-preview --write
 *
 * Options:
 *   --tag <tag>       Release tag to read (required)
 *   --channel <name>  Channel label (preview | beta | stable).
 *                     Defaults to "preview" for prereleases, otherwise "stable".
 *   --check           Exit non-zero when the manifest does not match the release
 *   --write           Rewrite the manifest from the release
 *
 * Env:
 *   GITHUB_REPOSITORY  owner/repo (defaults to this project's repository)
 *   GITHUB_TOKEN       optional; avoids anonymous API rate limits
 */

import fs from "node:fs";
import path from "node:path";

const REPO = process.env.GITHUB_REPOSITORY || "Alcatraz-Dev/Algo-Vault-EA-Lab";
const MANIFEST_PATH = path.join(process.cwd(), "public", "downloads", "releases.json");

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const valueOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const tag = valueOf("tag");
const channel = valueOf("channel");
const write = hasFlag("write");
const check = hasFlag("check");

if (!tag || write === check) {
  console.error("Usage: node scripts/desktop-release-manifest.mjs --tag <tag> (--check | --write) [--channel preview]");
  process.exit(2);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Not available";
  const mb = bytes / 1_000_000;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * Select the installer that matches the platform we advertise.
 * Returns undefined when the release has no matching asset, so the manifest
 * marks the platform unavailable instead of guessing.
 */
function pickAsset(assets, platformKey) {
  if (platformKey === "macos") {
    return assets.find(
      (asset) => /\.dmg$/i.test(asset.name) && /(arm64|aarch64|universal)/i.test(asset.name),
    );
  }
  if (platformKey === "windows") {
    const installers = assets.filter(
      (asset) =>
        /\.exe$/i.test(asset.name) && !/(arm64|aarch64|ia32|x86)/i.test(asset.name),
    );
    return installers.find((asset) => /setup/i.test(asset.name)) ?? installers[0];
  }
  return undefined;
}

function withAsset(platform, asset, releaseHtmlUrl) {
  const next = { ...platform, release_notes_url: releaseHtmlUrl };

  if (!asset) {
    next.status = "unavailable";
    next.download_url = "";
    delete next.file_name;
    next.file_size_bytes = 0;
    next.file_size_human = "Not available";
    delete next.checksum_sha256;
    return next;
  }

  next.status = "available";
  next.download_url = asset.browser_download_url;
  next.file_name = asset.name;
  next.file_size_bytes = asset.size;
  next.file_size_human = formatBytes(asset.size);

  const digest = typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
    ? asset.digest.slice("sha256:".length)
    : undefined;
  if (digest) {
    next.checksum_sha256 = digest;
  } else {
    delete next.checksum_sha256;
  }

  return next;
}

async function fetchRelease() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "algovault-desktop-manifest",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    console.error(`GitHub API returned ${response.status} for release ${tag} in ${REPO}.`);
    if (response.status === 404) {
      console.error("The release does not exist yet; publish it before syncing the manifest.");
    }
    process.exit(1);
  }

  return response.json();
}

const release = await fetchRelease();
const assets = Array.isArray(release.assets) ? release.assets : [];
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const platforms = manifest.platforms ?? {};

const requestedChannel = channel ? channel.trim().toLowerCase() : undefined;
if (requestedChannel && !["preview", "beta", "stable"].includes(requestedChannel)) {
  console.error(`Invalid channel "${channel}". Use one of: preview, beta, stable.`);
  process.exit(1);
}

// Refuse to write a manifest whose channel contradicts the GitHub release flag.
// A release labelled stable while GitHub publishes a prerelease (or vice versa)
// would hide preview warnings from users on the site.
if (requestedChannel) {
  const expectsPrerelease = requestedChannel !== "stable";
  if (Boolean(release.prerelease) !== expectsPrerelease) {
    console.error(
      `Channel "${requestedChannel}" is incompatible with GitHub prerelease=${Boolean(release.prerelease)} for ${release.tag_name}.`,
    );
    process.exit(1);
  }
}

const next = {
  ...manifest,
  version: release.tag_name.replace(/^v/, ""),
  channel: requestedChannel || (release.prerelease ? "preview" : "stable"),
  prerelease: Boolean(release.prerelease),
  tag: release.tag_name,
  published: release.published_at ? release.published_at.slice(0, 10) : manifest.published,
  source: release.html_url,
  platforms: {
    ...platforms,
    windows: withAsset(platforms.windows ?? {}, pickAsset(assets, "windows"), release.html_url),
    macos: withAsset(platforms.macos ?? {}, pickAsset(assets, "macos"), release.html_url),
  },
};

const serialized = `${JSON.stringify(next, null, 2)}\n`;
const current = fs.readFileSync(MANIFEST_PATH, "utf8");

if (current === serialized) {
  console.log(`Download manifest already matches ${tag}.`);
  process.exit(0);
}

if (check) {
  console.error(`Download manifest does not match release ${tag}.`);
  for (const key of ["version", "channel", "prerelease", "tag", "published", "source"]) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(next[key])) {
      console.error(`  ${key}: ${JSON.stringify(manifest[key])} -> ${JSON.stringify(next[key])}`);
    }
  }
  for (const platformKey of ["windows", "macos"]) {
    const before = platforms[platformKey] ?? {};
    const after = next.platforms[platformKey];
    for (const key of ["status", "download_url", "file_name", "file_size_bytes", "checksum_sha256"]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        console.error(
          `  ${platformKey}.${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`,
        );
      }
    }
  }
  console.error("Run the same command with --write to update public/downloads/releases.json.");
  process.exit(1);
}

fs.writeFileSync(MANIFEST_PATH, serialized);
console.log(`Updated public/downloads/releases.json from ${release.html_url}`);
for (const platformKey of ["windows", "macos"]) {
  const platform = next.platforms[platformKey];
  console.log(
    `  ${platformKey}: ${platform.status}${platform.file_name ? ` (${platform.file_name}, ${platform.file_size_human})` : ""}`,
  );
}
