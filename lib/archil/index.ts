// Archil disks — server-only storage surface.
//
// An Archil disk is a filesystem that outlives a single run: each exec starts a
// fresh container with the disk mounted at /mnt/data (also the working
// directory), so files written to the disk persist between execs while
// container state does not.
//
// Rules for this module:
//  * ARCHIL_API_KEY / ARCHIL_REGION / ARCHIL_DISK_ID are SERVER-SIDE ONLY.
//    Never import this module from a client component and never expose the key
//    behind a browser-visible prefix (NEXT_PUBLIC_* / VITE_*).
//  * The API key starts with `key-`. Disk/mount tokens (`adt_…`,
//    ARCHIL_MOUNT_TOKEN / ARCHIL_DISK_TOKEN) are a different credential and the
//    API rejects them with HTTP 401.
//  * Disk creation returns a one-time mount token. It is deliberately dropped
//    here: never returned, never logged. Exec does not need it.
//  * Everything fails closed with ArchilNotConfiguredError when the key is
//    missing, so no caller silently writes to nowhere.
//
// Nothing in the app calls this module yet; it is ready for the first
// server-side workflow whose files must outlive a run.

import { Archil, ArchilApiError, ArchilError } from "disk";
import type { Disk, ExecResult } from "disk";

export { ArchilApiError, ArchilError };

/** Exec (and control-plane calls) work in these regions. */
export const ARCHIL_DEFAULT_REGION = "aws-us-east-1";

export interface ArchilConfig {
  /** API key (`key-…`). Empty when unset. */
  apiKey: string;
  /** Region the key was issued in. Defaults to ARCHIL_DEFAULT_REGION. */
  region: string;
  /** Disk the caller means unless it passes one explicitly (`dsk-…`). */
  diskId: string;
  /** True only when an API key is present. */
  enabled: boolean;
}

export class ArchilNotConfiguredError extends Error {
  constructor(
    message = "Archil is not configured: set ARCHIL_API_KEY (server-side only).",
  ) {
    super(message);
    this.name = "ArchilNotConfiguredError";
  }
}

export class ArchilDiskIdError extends Error {
  constructor(message = "No Archil disk selected: set ARCHIL_DISK_ID or pass a disk id.") {
    super(message);
    this.name = "ArchilDiskIdError";
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? "").trim();
}

/** Plain env reader with no side effects (mirrors lib/integrations/sieve/config.ts). */
export function loadArchilConfig(env: NodeJS.ProcessEnv = process.env): ArchilConfig {
  const apiKey = envValue(env, "ARCHIL_API_KEY");
  return {
    apiKey,
    region: envValue(env, "ARCHIL_REGION") || ARCHIL_DEFAULT_REGION,
    diskId: envValue(env, "ARCHIL_DISK_ID"),
    enabled: apiKey.length > 0,
  };
}

export function isArchilConfigured(config: ArchilConfig = loadArchilConfig()): boolean {
  return config.enabled && config.apiKey.startsWith("key-");
}

function requireConfig(config: ArchilConfig): ArchilConfig {
  if (!config.enabled) throw new ArchilNotConfiguredError();
  return config;
}

/**
 * Per-instance client. The per-instance form is used instead of the module-level
 * `configure()` so importing this module never mutates global SDK state.
 */
export function archilClient(config: ArchilConfig = loadArchilConfig()): Archil {
  const { apiKey, region } = requireConfig(config);
  return new Archil({ apiKey, region });
}

/** Fetch the disk named by ARCHIL_DISK_ID (or the id passed in). */
export async function getArchilDisk(
  diskId?: string,
  config: ArchilConfig = loadArchilConfig(),
): Promise<Disk> {
  const id = diskId ?? config.diskId;
  if (!id) throw new ArchilDiskIdError();
  return archilClient(config).disks.get(id);
}

/**
 * Create a disk and return only its public identity. The one-time mount token
 * in the SDK response is intentionally discarded.
 */
export async function createArchilDisk(
  name: string,
  config: ArchilConfig = loadArchilConfig(),
): Promise<{ id: string; name: string; region: string; status: string }> {
  const { disk } = await archilClient(config).disks.create({ name });
  return { id: disk.id, name: disk.name, region: disk.region, status: disk.status };
}

export interface ArchilCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Server-measured timings (queueMs / runMs / totalMs). */
  timing: ExecResult["timing"];
}

/**
 * Run a shell command in a fresh container with the disk mounted at /mnt/data.
 * Stdout/stderr are capped by the service at 128 KiB each; the command times
 * out after 5 minutes. Mounts are shared, so write into a fresh per-job
 * subdirectory (or `archil checkout <path>`) rather than a shared root.
 */
export async function runArchilCommand(
  command: string,
  options: { diskId?: string; config?: ArchilConfig } = {},
): Promise<ArchilCommandResult> {
  const disk = await getArchilDisk(options.diskId, options.config);
  const result = await disk.exec(command);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timing: result.timing,
  };
}

/** Write a file on the disk through the object API (no container needed). */
export async function putArchilFile(
  key: string,
  body: string | Uint8Array | ArrayBuffer,
  options: { diskId?: string; config?: ArchilConfig } = {},
): Promise<void> {
  const disk = await getArchilDisk(options.diskId, options.config);
  await disk.putObject(key, body);
}

/** Read a file from the disk through the object API, decoded as UTF-8. */
export async function getArchilFile(
  key: string,
  options: { diskId?: string; config?: ArchilConfig } = {},
): Promise<string> {
  const disk = await getArchilDisk(options.diskId, options.config);
  const bytes = await disk.getObject(key);
  return new TextDecoder().decode(bytes);
}
