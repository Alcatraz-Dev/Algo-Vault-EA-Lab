// ─────────────────────────────────────────────────────────────────────────────
// Archil persistence check — writes in one exec, reads back in a second exec.
//
//   npm run archil:check
//
// Proves that a file written on an Archil disk survives the container that
// wrote it: exec #1 writes a unique line into a fresh per-job subdirectory and
// exec #2 (a separate container) reads it back. Exits non-zero unless the
// read-back output contains exactly what was written.
//
// Requires ARCHIL_API_KEY (starts with `key-`, from
// https://console.archil.com/api-keys). The disk is ARCHIL_DISK_ID when set,
// otherwise one is created and its id printed so it can be saved. The mount
// token returned by creation is never printed, and neither is the API key.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

import {
  ARCHIL_DEFAULT_REGION,
  ArchilApiError,
  createArchilDisk,
  getArchilDisk,
  loadArchilConfig,
} from "../lib/archil";

/** Fresh subdirectory per run: shared mounts reject writes to a shared root. */
function runDirectory(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `checks/${stamp}-${randomUUID().slice(0, 8)}`;
}

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = loadArchilConfig();

  if (!config.enabled) {
    fail(
      "ARCHIL_API_KEY is not set. Add the key (`key-…`, server-side only) to " +
        ".env.local, or export it for this run.",
    );
  }
  if (!config.apiKey.startsWith("key-")) {
    fail(
      "ARCHIL_API_KEY does not start with `key-`. Disk/mount tokens (`adt_…`) " +
        "are a different credential and get HTTP 401 from the API.",
    );
  }

  const selected = config.diskId
    ? { id: config.diskId }
    : await createArchilDisk(`algovault-persistence-${Date.now()}`, config);
  const disk = await getArchilDisk(selected.id, config);

  const region = disk.region || config.region || ARCHIL_DEFAULT_REGION;
  console.log(`disk:   ${disk.name}`);
  console.log(`id:     ${disk.id}`);
  console.log(`region: ${region}`);

  const dir = runDirectory();
  const key = `${dir}/persistence.txt`;
  const payload = `archil-persistence-check ${randomUUID()}`;

  // exec #1 — write the unique line (fresh subdirectory, mounted at /mnt/data).
  const write = await disk.exec(`mkdir -p ${dir} && printf '%s\\n' '${payload}' > ${key}`);
  if (write.exitCode !== 0) {
    console.error(write.stderr.trim());
    fail(`write exec failed with exit code ${write.exitCode}.`);
  }
  console.log(`wrote:  ${key} (${payload.length + 1} bytes)`);

  // exec #2 — a separate container reads the file back.
  const read = await disk.exec(`cat ${key}`);
  if (read.exitCode !== 0) {
    console.error(read.stderr.trim());
    fail(`read-back exec failed with exit code ${read.exitCode}.`);
  }

  const readBack = read.stdout.trim();
  console.log(`read:   ${JSON.stringify(readBack)}`);

  if (!read.stdout.includes(payload)) {
    fail("read-back exec did not return what the write exec stored.");
  }

  console.log("\n✔ persisted across two separate execs");
  console.log(`ARCHIL_DISK_ID=${disk.id}`);
}

main().catch((error: unknown) => {
  if (error instanceof ArchilApiError && error.status === 401) {
    fail(
      "the API returned 401. ARCHIL_API_KEY is probably a disk/mount token " +
        "(`adt_…`) or a key from another region; use a `key-…` key from " +
        "https://console.archil.com/api-keys in an AWS region.",
    );
  }
  console.error(error);
  process.exit(1);
});
