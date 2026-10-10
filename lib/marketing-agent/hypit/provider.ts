/**
 * Marketing Agent — Hypit adapter (§11, §12, §85).
 *
 * `HypitMarketingProvider` drives the installed Hypit executable through its
 * documented CLI surface:
 *
 *   hypit --version            → version + compatibility gate
 *   hypit check <file>.svml    → author-source validation (fail closed)
 *   hypit plan   <file>.svrun  → review work before spending money
 *   hypit build  <file>.svrun  → durable submission (worker continues)
 *   hypit status <build-id>    → progress / outcome
 *   hypit get    <build-id>    → export an exact output
 *   hypit cancel <build-id>    → cancel an in-flight build
 *   hypit doctor               → deployment diagnostic
 *
 * Version pinning: `EXPECTED_HYPIIIT_VERSION` is asserted before any build. A
 * missing or incompatible binary reports NOT_CONFIGURED — it is never silently
 * replaced with `npx latest`.
 *
 * Server-only module (spawns processes).
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  EXPECTED_HYPIIIT_VERSION,
  isVersionCompatible,
  type MarketingCreativeProvider,
  type ProjectInput,
  type ProviderHealth,
  type ProviderResult,
  type ProviderStatusPayload,
  type RenderInput,
  type RenderOutput,
  type CreativeProviderCapability,
} from "../provider";
import { renderSvml, renderSvrun, canvasFor } from "./svml";
import type { CompositionDocument } from "../provider";

const CAPABILITIES: CreativeProviderCapability[] = [
  "project",
  "ingest",
  "composition",
  "captions",
  "motion",
  "timeline",
  "render",
  "preview",
  "export",
  "variants",
  "localization",
  "rerender",
  "status",
  "cancel",
  "diagnostics",
];

const BUILD_ID_RE = /\bbld_[A-Za-z0-9T:._-]+/;

function hypitBinary(): string {
  return process.env.HYPIIIT_CLI_PATH || process.env.HYPIIIT_PATH || "hypit";
}

function run(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (code: number, stdout: string, stderr: string, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    };
    const timeoutMs = opts.timeoutMs ?? 120_000;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(/*turbopackIgnore: true*/ hypitBinary(), args, { cwd: opts.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      done(127, "", err instanceof Error ? err.message : String(err), false);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      done(124, stdout, stderr, true);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      done(127, stdout, err.message, false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code ?? 1, stdout, stderr, false);
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class HypitMarketingProvider implements MarketingCreativeProvider {
  readonly id = "hypit";
  readonly label = "Hypit";
  readonly capabilities = CAPABILITIES;

  private cachedVersion: { detected: string | null; compatible: boolean; detail: string } | null = null;

  async versionCheck(): Promise<{ detected: string | null; expected: string; compatible: boolean; detail: string }> {
    if (this.cachedVersion) return { ...this.cachedVersion, expected: EXPECTED_HYPIIIT_VERSION };
    const res = await run(["--version"], { timeoutMs: 15_000 });
    if (res.code !== 0) {
      this.cachedVersion = {
        detected: null,
        compatible: false,
        detail: `Hypit executable not reachable at "${hypitBinary()}": ${(res.stderr || res.stdout).slice(0, 200) || `exit ${res.code}`}`,
      };
      return { ...this.cachedVersion, expected: EXPECTED_HYPIIIT_VERSION };
    }
    const detected = (res.stdout.match(/\d+\.\d+(\.\d+)?/) ?? [res.stdout.trim()])[0] ?? null;
    const compatible = isVersionCompatible(detected);
    this.cachedVersion = {
      detected,
      compatible,
      detail: compatible
        ? `Hypit ${detected} satisfies the expected ${EXPECTED_HYPIIIT_VERSION} contract.`
        : `Hypit ${detected ?? "unknown"} is outside the expected ${EXPECTED_HYPIIIT_VERSION} contract — upgrade/downgrade requires verification.`,
    };
    return { ...this.cachedVersion, expected: EXPECTED_HYPIIIT_VERSION };
  }

  async health(): Promise<ProviderHealth> {
    const now = Date.now();
    if (process.env.MARKETING_HYPIT_ENABLED === "false") {
      return { id: this.id, label: this.label, state: "DISABLED", detail: "MARKETING_HYPIT_ENABLED=false.", checkedAt: now };
    }
    const v = await this.versionCheck();
    if (!v.detected) {
      return { id: this.id, label: this.label, state: "NOT_CONFIGURED", detail: v.detail, checkedAt: now };
    }
    if (!v.compatible) {
      return {
        id: this.id,
        label: this.label,
        state: "DEGRADED",
        detail: v.detail,
        version: v.detected,
        compatible: false,
        expectedVersion: EXPECTED_HYPIIIT_VERSION,
        checkedAt: now,
      };
    }
    const doctor = await run(["doctor"], { timeoutMs: 60_000 });
    if (doctor.code !== 0) {
      return {
        id: this.id,
        label: this.label,
        state: "DEGRADED",
        detail: `hypit doctor: ${(doctor.stderr || doctor.stdout).slice(0, 300) || `exit ${doctor.code}`}`,
        version: v.detected,
        compatible: true,
        expectedVersion: EXPECTED_HYPIIIT_VERSION,
        checkedAt: now,
      };
    }
    return {
      id: this.id,
      label: this.label,
      state: "CONNECTED",
      detail: v.detail,
      version: v.detected,
      compatible: true,
      expectedVersion: EXPECTED_HYPIIIT_VERSION,
      checkedAt: now,
    };
  }

  async createProject(input: ProjectInput): Promise<ProviderResult<{ projectId: string; projectDir: string }>> {
    const health = await this.health();
    if (health.state === "DISABLED") return { ok: false, error: health.detail ?? "Hypit disabled.", code: "DISABLED" };
    if (!health.compatible && health.state !== "CONNECTED") {
      return { ok: false, error: health.detail ?? "Hypit is not compatible.", code: "VERSION_INCOMPATIBLE" };
    }

    const projectDir = join(input.workspaceDir, "projects", input.creativeId);
    await mkdir(join(projectDir, "assets"), { recursive: true });
    await mkdir(join(projectDir, "output"), { recursive: true });

    const svml = renderSvml(input.composition);
    const svrun = renderSvrun({ authorSource: "./main.svml" });
    await writeFile(join(projectDir, "main.svml"), svml, "utf8");
    await writeFile(join(projectDir, "final.svrun"), svrun, "utf8");
    await writeFile(join(projectDir, "composition.json"), JSON.stringify(input.composition, null, 2), "utf8");
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: `algovault-${input.creativeId}`, private: true, version: "1.0.0" }, null, 2),
      "utf8"
    );

    // Validate before reporting the project as created (§91: never claim
    // success on an artifact that has not been verified).
    const check = await run(["check", "main.svml"], { cwd: projectDir, timeoutMs: 60_000 });
    if (check.code !== 0) {
      return {
        ok: false,
        error: `Generated SVML failed \`hypit check\`: ${(check.stderr || check.stdout).slice(0, 600) || `exit ${check.code}`}`,
        code: "SVML_INVALID",
      };
    }

    return { ok: true, value: { projectId: input.creativeId, projectDir } };
  }

  async ingestAssets(input: {
    projectId: string;
    assets: { key: string; sourcePath: string; kind: string }[];
    workspaceDir: string;
  }): Promise<ProviderResult<{ ingested: string[]; missing: string[] }>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    if (!(await exists(projectDir))) return { ok: false, error: "Project does not exist.", code: "NOT_FOUND" };

    const { copyFile } = await import("node:fs/promises");
    const ingested: string[] = [];
    const missing: string[] = [];

    for (const asset of input.assets) {
      try {
        if (!(await exists(asset.sourcePath))) {
          missing.push(asset.key);
          continue;
        }
        const target = join(projectDir, "assets", asset.key.replace(/[^A-Za-z0-9._-]/g, "_"));
        await copyFile(asset.sourcePath, target);
        ingested.push(asset.key);
      } catch {
        missing.push(asset.key);
      }
    }
    return { ok: true, value: { ingested, missing } };
  }

  async updateComposition(input: {
    projectId: string;
    composition: CompositionDocument;
    workspaceDir: string;
  }): Promise<ProviderResult<{ compositionId: string }>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    if (!(await exists(projectDir))) return { ok: false, error: "Project does not exist.", code: "NOT_FOUND" };

    // Versioned write — the previous composition is archived (§45).
    const archiveDir = join(projectDir, "compositions");
    await mkdir(archiveDir, { recursive: true });
    const existing = await readFile(join(projectDir, "composition.json"), "utf8").catch(() => null);
    if (existing) {
      const version = Date.now();
      await writeFile(join(archiveDir, `composition_${version}.json`), existing, "utf8");
    }

    const svml = renderSvml(input.composition);
    await writeFile(join(projectDir, "main.svml"), svml, "utf8");
    await writeFile(join(projectDir, "composition.json"), JSON.stringify(input.composition, null, 2), "utf8");

    const check = await run(["check", "main.svml"], { cwd: projectDir, timeoutMs: 60_000 });
    if (check.code !== 0) {
      return { ok: false, error: `Updated SVML failed \`hypit check\`: ${(check.stderr || check.stdout).slice(0, 600)}`, code: "SVML_INVALID" };
    }
    return { ok: true, value: { compositionId: `${input.projectId}:${Date.now()}` } };
  }

  async render(input: RenderInput): Promise<ProviderResult<RenderOutput>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    if (!(await exists(projectDir))) return { ok: false, error: "Project does not exist.", code: "NOT_FOUND" };

    const health = await this.health();
    if (health.state !== "CONNECTED") return { ok: false, error: health.detail ?? "Hypit is not available.", code: "NOT_CONFIGURED" };

    // Re-validate the source immediately before submitting paid work (§85).
    const check = await run(["check", "main.svml"], { cwd: projectDir, timeoutMs: 60_000 });
    if (check.code !== 0) {
      return { ok: false, error: `hypit check failed: ${(check.stderr || check.stdout).slice(0, 600)}`, code: "SVML_INVALID" };
    }

    const plan = await run(["plan", "final.svrun", "--json"], { cwd: projectDir, timeoutMs: 90_000 });
    if (plan.code !== 0) {
      return { ok: false, error: `hypit plan failed: ${(plan.stderr || plan.stdout).slice(0, 600)}`, code: "PLAN_FAILED" };
    }

    const build = await run(["build", "final.svrun", "--title", input.outputName], {
      cwd: projectDir,
      timeoutMs: input.timeoutMs ?? 10 * 60_000,
    });
    if (build.timedOut) return { ok: false, error: "Hypit build submission timed out.", code: "TIMEOUT" };
    if (build.code !== 0) {
      return { ok: false, error: `hypit build failed: ${(build.stderr || build.stdout).slice(0, 600)}`, code: "BUILD_FAILED" };
    }

    const buildId = (build.stdout.match(BUILD_ID_RE) ?? [])[0];
    if (!buildId) {
      return { ok: false, error: "Hypit build did not report a build id.", code: "BUILD_ID_MISSING" };
    }

    // Observe until an outcome exists.
    const status = await run(["status", buildId, "--watch", "--max-wait-ms", String(input.timeoutMs ?? 8 * 60_000)], {
      cwd: projectDir,
      timeoutMs: (input.timeoutMs ?? 8 * 60_000) + 30_000,
    });
    const outcome = await this.readBuildOutcome(projectDir, buildId);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error ?? (status.stderr || status.stdout).slice(0, 600), code: outcome.code ?? "BUILD_FAILED" };
    }

    const outputFile = join(projectDir, "output", `${input.outputName}.mp4`);
    const get = await run(["get", buildId, "--output", "final.video", "--to", outputFile], {
      cwd: projectDir,
      timeoutMs: 5 * 60_000,
    });
    if (get.code !== 0) {
      return { ok: false, error: `hypit get failed: ${(get.stderr || get.stdout).slice(0, 600)}`, code: "EXPORT_FAILED" };
    }

    const meta = await probeMedia(outputFile);
    return {
      ok: true,
      value: {
        buildId,
        file: outputFile,
        width: meta.width ?? canvasFor(input.aspectRatio).width,
        height: meta.height ?? canvasFor(input.aspectRatio).height,
        durationSec: meta.durationSec ?? 0,
        sizeBytes: meta.sizeBytes,
        codec: meta.codec,
        hasAudio: meta.hasAudio,
      },
    };
  }

  private async readBuildOutcome(
    projectDir: string,
    buildId: string
  ): Promise<{ ok: boolean; error?: string; code?: string }> {
    const inspect = await run(["inspect", buildId, "--json"], { cwd: projectDir, timeoutMs: 60_000 });
    const text = inspect.stdout || inspect.stderr;
    if (inspect.code !== 0) {
      return { ok: false, error: `hypit inspect failed: ${text.slice(0, 600)}`, code: "INSPECT_FAILED" };
    }
    if (/\"status\"\s*:\s*\"(failed|error|cancelled)\"/i.test(text)) {
      return { ok: false, error: `Build ${buildId} did not complete: ${text.slice(0, 400)}`, code: "BUILD_FAILED" };
    }
    return { ok: true };
  }

  async status(input: { buildId: string; workspaceDir: string }): Promise<ProviderStatusPayload> {
    const projectDir = join(input.workspaceDir, "projects");
    const res = await run(["status", input.buildId, "--json"], { cwd: projectDir, timeoutMs: 45_000 });
    const text = res.stdout || res.stderr;
    if (res.code !== 0) {
      return { buildId: input.buildId, state: "FAILED", error: text.slice(0, 400) };
    }
    if (/\"status\"\s*:\s*\"(succeeded|complete|done|rendered)\"/i.test(text)) return { buildId: input.buildId, state: "RENDERED" };
    if (/\"status\"\s*:\s*\"failed\"/i.test(text)) return { buildId: input.buildId, state: "FAILED", error: text.slice(0, 400) };
    if (/\"status\"\s*:\s*\"cancelled\"/i.test(text)) return { buildId: input.buildId, state: "CANCELLED" };
    if (/\"status\"\s*:\s*\"running\"/i.test(text)) return { buildId: input.buildId, state: "RUNNING" };
    return { buildId: input.buildId, state: "QUEUED" };
  }

  async cancel(input: { buildId: string; workspaceDir: string }): Promise<ProviderResult<{ cancelled: boolean }>> {
    const res = await run(["cancel", input.buildId], { cwd: join(input.workspaceDir, "projects"), timeoutMs: 45_000 });
    if (res.code !== 0) {
      return { ok: false, error: (res.stderr || res.stdout).slice(0, 400) || "Cancel failed.", code: "CANCEL_FAILED" };
    }
    return { ok: true, value: { cancelled: true } };
  }

  async diagnostics(input?: { workspaceDir?: string }): Promise<{ checks: { name: string; ok: boolean; detail?: string }[] }> {
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    const v = await this.versionCheck();
    checks.push({ name: "hypit_binary", ok: !!v.detected, detail: v.detail });
    checks.push({ name: "version_compatible", ok: v.compatible, detail: `expected ${EXPECTED_HYPIIIT_VERSION}, detected ${v.detected ?? "none"}` });

    const doctor = await run(["doctor"], { timeoutMs: 60_000 });
    checks.push({ name: "hypit_doctor", ok: doctor.code === 0, detail: (doctor.stdout || doctor.stderr).slice(0, 300) || `exit ${doctor.code}` });

    if (input?.workspaceDir) {
      const projectsDir = join(input.workspaceDir, "projects");
      checks.push({ name: "workspace_writable", ok: await canWrite(projectsDir), detail: projectsDir });
    }
    return { checks };
  }
}

async function canWrite(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, `.probe_${Date.now()}`);
    await writeFile(probe, "ok", "utf8");
    await writeFile(probe, "ok2", "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Best-effort media probe using ffprobe when it is available. */
async function probeMedia(file: string): Promise<{
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  codec?: string;
  hasAudio?: boolean;
}> {
  const out: { sizeBytes?: number } = {};
  try {
    const { stat } = await import("node:fs/promises");
    out.sizeBytes = (await stat(file)).size;
  } catch {
    return {};
  }

  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const res = await new Promise<{ code: number; stdout: string }>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(/*turbopackIgnore: true*/ ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ code: 127, stdout: err instanceof Error ? err.message : "" });
      return;
    }
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve({ code: 124, stdout });
    }, 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
  });

  if (res.code !== 0 || !res.stdout) return out;
  try {
    const parsed = JSON.parse(res.stdout) as {
      format?: { duration?: string; size?: string };
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
    };
    const video = parsed.streams?.find((s) => s.codec_type === "video");
    const audio = parsed.streams?.find((s) => s.codec_type === "audio");
    return {
      ...out,
      width: video?.width,
      height: video?.height,
      codec: video?.codec_name,
      hasAudio: !!audio,
      durationSec: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      sizeBytes: parsed.format?.size ? Number(parsed.format.size) : out.sizeBytes,
    };
  } catch {
    return out;
  }
}
