#!/usr/bin/env node
/**
 * Resolve and validate the desktop release version, channel, and GitHub
 * prerelease flag. This is the single source of truth used by the release
 * workflow, so a release can never be labelled "stable" while GitHub publishes
 * it as a prerelease (or the other way around).
 *
 * Tag pushes are resolved from the tag itself:
 *   v0.1.0-preview  -> channel preview, prerelease true
 *   v1.2.0-beta.3   -> channel beta,    prerelease true
 *   v1.0.0          -> channel stable,  prerelease false
 *
 * Manual dispatches must pass a compatible version/channel/prerelease triple:
 *   stable          -> prerelease false and no version suffix
 *   preview / beta  -> prerelease true and a matching version suffix
 *
 * Usage (workflow):
 *   node scripts/release-channel.mjs >> "$GITHUB_OUTPUT"
 *   Env: EVENT_NAME, REF_NAME, INPUT_VERSION, INPUT_CHANNEL, INPUT_PRERELEASE
 *
 * Usage (local):
 *   node scripts/release-channel.mjs --event push --ref v0.1.0-preview
 *   node scripts/release-channel.mjs --event workflow_dispatch \
 *     --version 1.0.0 --channel stable --prerelease false
 */

import { pathToFileURL } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const CHANNELS = new Set(["preview", "beta", "stable"]);

const RELEASE_NAMES = {
  preview: "AlgoVault Desktop Preview",
  beta: "AlgoVault Desktop Preview",
  stable: "AlgoVault Desktop",
};

/**
 * @param {{
 *   eventName: string,
 *   refName?: string,
 *   inputVersion?: string,
 *   inputChannel?: string,
 *   inputPrerelease?: string,
 * }} input
 * @returns {{ version: string, tag: string, channel: "preview"|"beta"|"stable", prerelease: boolean, releaseName: string }}
 */
export function resolveRelease({ eventName, refName, inputVersion, inputChannel, inputPrerelease }) {
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(`Unsupported event "${eventName}". Expected "push" or "workflow_dispatch".`);
  }

  const isTagPush = eventName === "push";
  const raw = (isTagPush ? refName ?? "" : inputVersion ?? "").trim();
  if (!raw) {
    throw new Error(
      isTagPush
        ? "No tag ref was provided for this tag-triggered release."
        : "A release version is required for manual dispatch.",
    );
  }
  if (isTagPush && !raw.startsWith("v")) {
    throw new Error(`Release tags must start with "v"; received "${raw}".`);
  }

  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  const match = SEMVER.exec(version);
  if (!match) {
    throw new Error(
      `Invalid release version "${raw}". Expected a semver version such as 0.1.0-preview or 1.0.0.`,
    );
  }

  const suffix = match[4];
  const suffixChannel = suffix ? suffix.split(".")[0].toLowerCase() : undefined;

  if (isTagPush) {
    if (!suffix) {
      return {
        version,
        tag: `v${version}`,
        channel: "stable",
        prerelease: false,
        releaseName: RELEASE_NAMES.stable,
      };
    }
    const channel = suffixChannel === "beta" ? "beta" : "preview";
    return {
      version,
      tag: `v${version}`,
      channel,
      prerelease: true,
      releaseName: RELEASE_NAMES[channel],
    };
  }

  const requestedChannel = (inputChannel ?? "").trim().toLowerCase();
  if (!CHANNELS.has(requestedChannel)) {
    throw new Error(
      `Invalid channel "${inputChannel ?? ""}". Use one of: preview, beta, stable.`,
    );
  }

  const requestedPrerelease = String(inputPrerelease ?? "").trim().toLowerCase();
  if (requestedPrerelease !== "true" && requestedPrerelease !== "false") {
    throw new Error(
      `Invalid prerelease value "${inputPrerelease ?? ""}". Use true or false.`,
    );
  }
  const prerelease = requestedPrerelease === "true";

  if (requestedChannel === "stable") {
    if (prerelease) {
      throw new Error('Channel "stable" cannot be published as a GitHub prerelease; set prerelease=false.');
    }
    if (suffix) {
      throw new Error(
        `Channel "stable" requires a stable version without a prerelease suffix; received "${version}".`,
      );
    }
    return {
      version,
      tag: `v${version}`,
      channel: "stable",
      prerelease: false,
      releaseName: RELEASE_NAMES.stable,
    };
  }

  if (!prerelease) {
    throw new Error(
      `Channel "${requestedChannel}" must be published as a GitHub prerelease; set prerelease=true.`,
    );
  }
  if (!suffix) {
    throw new Error(
      `Channel "${requestedChannel}" requires a prerelease version such as 0.1.0-${requestedChannel}; received "${version}".`,
    );
  }
  if (suffixChannel !== requestedChannel) {
    throw new Error(
      `Version "${version}" does not match channel "${requestedChannel}". Use a "${requestedChannel}" suffix, e.g. 0.1.0-${requestedChannel}.`,
    );
  }

  return {
    version,
    tag: `v${version}`,
    channel: requestedChannel,
    prerelease: true,
    releaseName: RELEASE_NAMES[requestedChannel],
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
  const eventName = readArg(args, "event") ?? process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME;

  try {
    const release = resolveRelease({
      eventName: eventName ?? "",
      refName: readArg(args, "ref") ?? process.env.REF_NAME ?? process.env.GITHUB_REF_NAME,
      inputVersion: readArg(args, "version") ?? process.env.INPUT_VERSION,
      inputChannel: readArg(args, "channel") ?? process.env.INPUT_CHANNEL,
      inputPrerelease: readArg(args, "prerelease") ?? process.env.INPUT_PRERELEASE,
    });

    // stdout is appended to $GITHUB_OUTPUT by the workflow.
    console.log(`version=${release.version}`);
    console.log(`tag=${release.tag}`);
    console.log(`channel=${release.channel}`);
    console.log(`prerelease=${release.prerelease}`);
    console.log(`release_name=${release.releaseName}`);
    console.error(
      `Release ${release.tag}: channel=${release.channel}, prerelease=${release.prerelease}`,
    );
  } catch (error) {
    console.error(`Release configuration error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
