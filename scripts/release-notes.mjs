#!/usr/bin/env node
/**
 * Render the GitHub Release body for a desktop release.
 *
 * The heading, intro, and installation guidance follow the resolved channel
 * (preview | beta | stable) and the signing status recorded by the build jobs.
 * Unsigned builds keep their Gatekeeper / SmartScreen guidance; signed builds
 * are only described as signed when the build metadata says so, and a missing
 * metadata file falls back to conservative wording instead of a guess.
 *
 * SDK usage:
 *   import { renderReleaseNotes } from "./scripts/release-notes.mjs";
 *
 * Workflow usage:
 *   node scripts/release-notes.mjs \
 *     --version 0.1.0-preview --channel preview \
 *     --assets-dir release-assets --out release-notes.md
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHANNELS = new Set(["preview", "beta", "stable"]);

const LABELS = {
  preview: {
    title: "AlgoVault Desktop Preview",
    intro:
      "This is a **preview release** for testing and feedback. It is not a stable production release.",
  },
  beta: {
    title: "AlgoVault Desktop Beta",
    intro:
      "This is a **beta release** for early testing. It is not a stable production release.",
  },
  stable: {
    title: "AlgoVault Desktop",
    intro: "This is the **stable release** of AlgoVault Desktop.",
  },
};

function macosInstallation({ signingKnown, signed, notarized }) {
  if (signingKnown === false) {
    return "- **macOS:** signing status could not be determined for this build. If Gatekeeper warns, right-click (or Control-click) the app → **Open** → **Open**, or allow it under System Settings → Privacy & Security. Do not disable Gatekeeper globally.";
  }
  if (signed && notarized) {
    return "- **macOS:** the app is Developer ID signed and notarized; it should open without a Gatekeeper warning.";
  }
  if (signed) {
    return "- **macOS:** the app is signed but not notarized. Gatekeeper may still warn on first launch: right-click (or Control-click) the app → **Open** → **Open**, or allow it under System Settings → Privacy & Security.";
  }
  return "- **macOS:** the app is unsigned and unnotarized. On first launch macOS Gatekeeper will warn: right-click (or Control-click) the app → **Open** → **Open**, or allow it under System Settings → Privacy & Security. Do not disable Gatekeeper globally.";
}

function windowsInstallation({ signingKnown, signed }) {
  if (signingKnown === false) {
    return "- **Windows:** signing status could not be determined for this build. If Windows SmartScreen warns, choose **More info** → **Run anyway**.";
  }
  if (signed) {
    return "- **Windows:** the installer is code-signed.";
  }
  return "- **Windows:** the installer is not code-signed. If Windows SmartScreen warns, choose **More info** → **Run anyway**.";
}

/**
 * @param {{
 *   version: string,
 *   channel: "preview"|"beta"|"stable",
 *   macos: { fileName: string, signingKnown?: boolean, signed?: boolean, notarized?: boolean },
 *   windows: { fileName: string, signingKnown?: boolean, signed?: boolean },
 * }} input
 * @returns {string}
 */
export function renderReleaseNotes({ version, channel, macos, windows }) {
  if (!version || typeof version !== "string") {
    throw new Error("A release version is required.");
  }
  if (!CHANNELS.has(channel)) {
    throw new Error(`Invalid channel "${channel}". Use one of: preview, beta, stable.`);
  }
  if (!macos?.fileName) {
    throw new Error("The macOS asset filename is required.");
  }
  if (!windows?.fileName) {
    throw new Error("The Windows asset filename is required.");
  }

  const label = LABELS[channel];
  const lines = [
    `## ${label.title} v${version}`,
    "",
    label.intro,
    "",
    "### Downloads",
    "",
    "| Platform | Architecture | File |",
    "|----------|-------------|------|",
    `| macOS | Apple Silicon (ARM64) | \`${macos.fileName}\` |`,
    `| Windows | x64 | \`${windows.fileName}\` |`,
    "",
    "### Installation",
    "",
    macosInstallation(macos),
    windowsInstallation(windows),
    "",
    "### Known limitations",
    "",
    "- macOS builds are Apple Silicon (ARM64) only; Intel Macs are not supported.",
  ];

  if (channel !== "stable") {
    lines.push(
      "- Auto-updater is configured but inert until a stable release is published.",
      "",
      "---",
      "",
      `*This is ${channel} software. Use at your own risk.*`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseBoolean(value, flag) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid value for --${flag}: "${value ?? ""}". Use true or false.`);
}

function findAsset(directory, extension) {
  const files = fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith(extension));
  if (extension === ".dmg") {
    const arm = files.find((file) => /(arm64|aarch64|universal)/i.test(file));
    if (arm) return arm;
  } else {
    const setup = files.find((file) => /setup/i.test(file) && !/(arm64|aarch64|ia32)/i.test(file));
    if (setup) return setup;
    const other = files.find((file) => !/(arm64|aarch64|ia32)/i.test(file));
    if (other) return other;
  }
  throw new Error(`No ${extension} asset found in ${directory}.`);
}

function readSigningMetadata(directory, platform) {
  const file = path.join(directory, `build-meta-${platform}.json`);
  if (!fs.existsSync(file)) return { signingKnown: false, signed: false, notarized: false };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Could not parse signing metadata at ${file}.`);
  }
  return {
    signingKnown: true,
    signed: Boolean(parsed.signed),
    notarized: Boolean(parsed.notarized),
  };
}

function readArg(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  try {
    const version = readArg(args, "version") ?? process.env.VERSION;
    const channel = readArg(args, "channel") ?? process.env.CHANNEL;
    const assetsDir = readArg(args, "assets-dir") ?? process.env.ASSETS_DIR;
    const outFile = readArg(args, "out");

    if (!channel) throw new Error("A release channel is required (preview, beta, stable).");

    let macos;
    let windows;

    if (assetsDir) {
      if (!fs.existsSync(assetsDir)) {
        throw new Error(`Assets directory not found: ${assetsDir}`);
      }
      const signing = readSigningMetadata(assetsDir, "macos");
      const windowsSigning = readSigningMetadata(assetsDir, "windows");
      macos = { fileName: findAsset(assetsDir, ".dmg"), ...signing };
      windows = { fileName: findAsset(assetsDir, ".exe"), ...windowsSigning };
    } else {
      macos = { fileName: readArg(args, "macos-asset"), signingKnown: false, signed: false, notarized: false };
      windows = { fileName: readArg(args, "windows-asset"), signingKnown: false, signed: false };
    }

    const macosSigned = readArg(args, "macos-signed");
    const macosNotarized = readArg(args, "macos-notarized");
    const windowsSigned = readArg(args, "windows-signed");

    if (macosSigned !== undefined) {
      macos.signingKnown = true;
      macos.signed = parseBoolean(macosSigned, "macos-signed");
    }
    if (macosNotarized !== undefined) {
      macos.signingKnown = true;
      macos.notarized = parseBoolean(macosNotarized, "macos-notarized");
    }
    if (windowsSigned !== undefined) {
      windows.signingKnown = true;
      windows.signed = parseBoolean(windowsSigned, "windows-signed");
    }

    const notes = renderReleaseNotes({ version, channel, macos, windows });

    if (outFile) {
      fs.writeFileSync(outFile, notes);
    } else {
      process.stdout.write(notes);
    }
  } catch (error) {
    console.error(
      `Release notes error: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
