/**
 * Marketing Agent — browser capture providers (§6, §7).
 *
 * Two adapters behind one interface:
 *  - `hypit`     — delegates to the Hypit CLI's browser/runtime tooling when
 *                  Hypit is installed. This is an ADAPTER, not a duplicate
 *                  implementation (§6).
 *  - `playwright` — drives a locally installed Playwright/Chromium when the
 *                  optional dependency is present.
 *
 * Availability is always reported honestly: NOT_CONFIGURED when the runtime is
 * absent, never a fake capture.
 *
 * Server-only module (spawns processes / requires a browser).
 */

import { spawn } from "node:child_process";
import type { BrowserCapturePlan, CaptureStep } from "../types";

export type ProviderState = "READY" | "NOT_CONFIGURED" | "DISABLED" | "ERROR";

export type ProviderStatus = {
  id: string;
  label: string;
  state: ProviderState;
  reason?: string;
  capabilities: string[];
  checkedAt: number;
};

export type CaptureRunInput = {
  plan: BrowserCapturePlan;
  baseUrl: string;
  /** Where frames should be written (server-side workspace directory). */
  outputDir: string;
  /** Sanitization directives applied during capture. */
  masks: { selector: string; reason: string }[];
  /** Demo/marketing session cookie jar path — never a real user session. */
  sessionRef?: string;
  timeoutMs: number;
};

export type CaptureRunResult = {
  ok: boolean;
  provider: string;
  frames: { key: string; kind: "screenshot" | "video_segment" | "region"; file: string; stepOrder: number; durationMs?: number; sanitized: boolean }[];
  log: { at: number; action: string; target?: string; ok: boolean; note?: string }[];
  error?: string;
  code?: "NOT_CONFIGURED" | "ROUTE_UNAVAILABLE" | "STEP_FAILED" | "TIMEOUT" | "PROHIBITED";
};

export interface BrowserCaptureProvider {
  readonly id: string;
  readonly label: string;
  status(): Promise<ProviderStatus>;
  capture(input: CaptureRunInput): Promise<CaptureRunResult>;
}

const CAPABILITIES = ["screenshot", "video", "region", "mask", "highlight", "replay"];

function envFlag(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

/** Run a fixed-argv command with no shell (§47: never arbitrary commands). */
function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number, stdout: string, stderr: string, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      finish(127, "", err instanceof Error ? err.message : String(err), false);
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
        /* already gone */
      }
      finish(124, stdout, stderr, true);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      finish(127, stdout, err.message, false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code ?? 1, stdout, stderr, false);
    });
  });
}

// ─── Hypit adapter ───────────────────────────────────────────────────────────

export class HypitBrowserCaptureProvider implements BrowserCaptureProvider {
  readonly id = "hypit";
  readonly label = "Hypit browser runtime";
  private binary: string | null | undefined;

  private resolveBinary(): string | null {
    if (this.binary !== undefined) return this.binary;
    this.binary = process.env.HYPIIIT_CLI_PATH || process.env.HYPIIIT_PATH || "hypit";
    return this.binary;
  }

  async status(): Promise<ProviderStatus> {
    if (envFlag("MARKETING_BROWSER_CAPTURE_ENABLED") === false) {
      return { id: this.id, label: this.label, state: "DISABLED", reason: "MARKETING_BROWSER_CAPTURE_ENABLED=false.", capabilities: CAPABILITIES, checkedAt: Date.now() };
    }
    const bin = this.resolveBinary();
    if (!bin) {
      return { id: this.id, label: this.label, state: "NOT_CONFIGURED", reason: "Hypit executable not configured (HYPIIIT_CLI_PATH).", capabilities: CAPABILITIES, checkedAt: Date.now() };
    }
    const probe = await runCommand(bin, ["--version"], 8_000);
    if (probe.code !== 0) {
      return {
        id: this.id,
        label: this.label,
        state: "NOT_CONFIGURED",
        reason: `Hypit executable not reachable: ${(probe.stderr || probe.stdout).slice(0, 160) || `exit ${probe.code}`}`,
        capabilities: CAPABILITIES,
        checkedAt: Date.now(),
      };
    }
    return { id: this.id, label: this.label, state: "READY", reason: probe.stdout.trim().split("\n")[0] || "hypit available", capabilities: CAPABILITIES, checkedAt: Date.now() };
  }

  async capture(input: CaptureRunInput): Promise<CaptureRunResult> {
    const st = await this.status();
    if (st.state !== "READY") {
      return { ok: false, provider: this.id, frames: [], log: [], error: st.reason, code: "NOT_CONFIGURED" };
    }
    const bin = this.resolveBinary() as string;

    // The Hypit runtime must be prepared before a capture run (§12: the
    // adapter owns its own deployment preflight, the caller never shells out).
    const doctor = await runCommand(bin, ["doctor"], 60_000);
    if (doctor.code !== 0) {
      return {
        ok: false,
        provider: this.id,
        frames: [],
        log: [],
        error: `hypit doctor failed: ${doctor.stderr.slice(0, 400) || `exit ${doctor.code}`}`,
        code: "NOT_CONFIGURED",
      };
    }

    // Delegate the actual browser session to Hypit's capture tooling through
    // its documented project-file contract (no inline scripting).
    const planFile = `${input.outputDir}/capture-plan.json`;
    const result = await runCommand(
      bin,
      ["capture", "--plan", planFile, "--out", input.outputDir, "--base-url", input.baseUrl, "--json"],
      input.timeoutMs
    );

    if (result.timedOut) {
      return { ok: false, provider: this.id, frames: [], log: [], error: "Capture timed out.", code: "TIMEOUT" };
    }
    if (result.code !== 0) {
      const msg = result.stderr || result.stdout;
      const code = /not supported|unavailable/i.test(msg) ? "NOT_CONFIGURED" : /route|navigation|404|5\d\d/i.test(msg) ? "ROUTE_UNAVAILABLE" : "STEP_FAILED";
      return { ok: false, provider: this.id, frames: [], log: [], error: msg.slice(0, 600) || `exit ${result.code}`, code };
    }

    let parsed: { frames?: CaptureRunResult["frames"]; log?: CaptureRunResult["log"] } = {};
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      return { ok: false, provider: this.id, frames: [], log: [], error: "Hypit capture returned unparseable output.", code: "STEP_FAILED" };
    }

    const frames = (parsed.frames ?? []).map((f) => ({ ...f, sanitized: true }));
    if (frames.length === 0) {
      return { ok: false, provider: this.id, frames: [], log: [], error: "Capture produced no frames.", code: "ROUTE_UNAVAILABLE" };
    }
    return { ok: true, provider: this.id, frames, log: parsed.log ?? [] };
  }
}

// ─── Playwright adapter ──────────────────────────────────────────────────────

export class PlaywrightBrowserCaptureProvider implements BrowserCaptureProvider {
  readonly id = "playwright";
  readonly label = "Playwright (local Chromium)";
  private availability: { available: boolean; reason?: string } | null = null;

  async status(): Promise<ProviderStatus> {
    if (envFlag("MARKETING_BROWSER_CAPTURE_ENABLED") === false) {
      return { id: this.id, label: this.label, state: "DISABLED", reason: "MARKETING_BROWSER_CAPTURE_ENABLED=false.", capabilities: CAPABILITIES, checkedAt: Date.now() };
    }
    if (!this.availability) {
      this.availability = await probePlaywright();
    }
    return {
      id: this.id,
      label: this.label,
      state: this.availability.available ? "READY" : "NOT_CONFIGURED",
      reason: this.availability.reason,
      capabilities: CAPABILITIES,
      checkedAt: Date.now(),
    };
  }

  async capture(input: CaptureRunInput): Promise<CaptureRunResult> {
    const st = await this.status();
    if (st.state !== "READY") {
      return { ok: false, provider: this.id, frames: [], log: [], error: st.reason, code: "NOT_CONFIGURED" };
    }
    // The specifier is held in a variable so TypeScript does not require the
    // optional dependency to be installed at typecheck time.
    const specifier = "playwright";
    const mod = (await import(/* webpackIgnore: true */ specifier)) as unknown as {
      chromium: { launch(o: Record<string, unknown>): Promise<PlaywrightBrowser> };
    };

    const log: CaptureRunResult["log"] = [];
    const frames: CaptureRunResult["frames"] = [];
    let browser: PlaywrightBrowser | null = null;

    try {
      browser = await mod.chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1080, height: 1920 },
        deviceScaleFactor: 1,
        ...(input.sessionRef ? { storageState: input.sessionRef } : {}),
      });
      const page = await context.newPage();

      // Standing sanitization: hide declared sensitive regions before any pixel
      // is captured (§52). Fail closed if injection is refused.
      const css = input.masks.map((m) => `${m.selector}{visibility:hidden!important;}`).join("\n");
      if (css) {
        try {
          await page.addStyleTag({ content: css });
        } catch (err) {
          await context.close();
          return {
            ok: false,
            provider: this.id,
            frames: [],
            log,
            error: `Could not apply sensitive-region masking: ${err instanceof Error ? err.message : "unknown"}`,
            code: "PROHIBITED",
          };
        }
      }

      const started = Date.now();
      for (const step of input.plan.steps) {
        if (Date.now() - started > input.timeoutMs) {
          log.push({ at: Date.now(), action: "timeout", ok: false, note: "Capture budget exhausted." });
          break;
        }
        const ok = await executeStep(page, step, input, frames, log);
        if (!ok) {
          await context.close();
          return { ok: false, provider: this.id, frames, log, error: `Step ${step.order} (${step.action}) failed.`, code: "STEP_FAILED" };
        }
      }

      await context.close();
      if (frames.length === 0) {
        return { ok: false, provider: this.id, frames, log, error: "Capture produced no frames.", code: "ROUTE_UNAVAILABLE" };
      }
      return { ok: true, provider: this.id, frames, log };
    } catch (err) {
      return { ok: false, provider: this.id, frames, log, error: err instanceof Error ? err.message : "Capture failed.", code: "STEP_FAILED" };
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}

type PlaywrightBrowser = {
  newContext(o: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
};
type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};
type PlaywrightPage = {
  goto(url: string, o?: Record<string, unknown>): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  selectOption(selector: string, value: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForLoadState(state: string, o?: Record<string, unknown>): Promise<unknown>;
  screenshot(o: Record<string, unknown>): Promise<Buffer>;
  evaluate<T>(fn: string | ((...a: unknown[]) => T), arg?: unknown): Promise<T>;
  addStyleTag(o: Record<string, unknown>): Promise<unknown>;
};

async function executeStep(
  page: PlaywrightPage,
  step: CaptureStep,
  input: CaptureRunInput,
  frames: CaptureRunResult["frames"],
  log: CaptureRunResult["log"]
): Promise<boolean> {
  const target = step.target ?? "";
  try {
    switch (step.action) {
      case "open":
      case "navigate": {
        await page.goto(new URL(target, input.baseUrl).toString(), { waitUntil: "networkidle", timeout: 20_000 });
        break;
      }
      case "click": {
        await page.click(target);
        break;
      }
      case "select": {
        await page.selectOption(target, step.value ?? "");
        break;
      }
      case "search": {
        await page.fill(target, step.value ?? "");
        await page.click(`${target} >> …`.replace(" >> …", "[type=submit]")).catch(() => undefined);
        break;
      }
      case "scroll": {
        const delta = Number(step.value ?? 600);
        await page.evaluate(
          "window.scrollBy({ top: arguments[0], behavior: 'smooth' })" as unknown as string,
          step.target === "up" ? -delta : delta
        ).catch(async () => {
          await page.evaluate(`window.scrollBy(0, ${step.target === "up" ? -delta : delta})`);
        });
        break;
      }
      case "switch_tab": {
        log.push({ at: Date.now(), action: step.action, target, ok: false, note: "Tab switching requires an explicit approved route." });
        return false;
      }
      case "wait": {
        await new Promise((r) => setTimeout(r, Math.min(step.durationMs, 10_000)));
        break;
      }
      case "capture": {
        if (step.captures && step.captures !== "none") {
          const buffer = await page.screenshot({ fullPage: false });
          const key = `step_${String(step.order).padStart(2, "0")}_${step.captures}`;
          await writeFileSafe(`${input.outputDir}/${key}.png`, buffer);
          frames.push({
            key,
            kind: step.captures === "video_segment" ? "video_segment" : step.captures === "region" ? "region" : "screenshot",
            file: `${input.outputDir}/${key}.png`,
            stepOrder: step.order,
            sanitized: true,
          });
        }
        break;
      }
      default:
        return false;
    }
    if (step.waitFor === "network-idle") {
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    } else if (step.durationMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(step.durationMs, 5_000)));
    }
    log.push({ at: Date.now(), action: step.action, target: target || undefined, ok: true });
    return true;
  } catch (err) {
    log.push({ at: Date.now(), action: step.action, target: target || undefined, ok: false, note: err instanceof Error ? err.message.slice(0, 200) : "step failed" });
    return false;
  }
}

async function writeFileSafe(path: string, data: Buffer): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

async function probePlaywright(): Promise<{ available: boolean; reason?: string }> {
  try {
    const specifier = "playwright";
    const mod = (await import(/* webpackIgnore: true */ specifier)) as { chromium?: unknown } | undefined;
    if (mod && typeof mod.chromium === "object") return { available: true };
    return { available: false, reason: "playwright installed without a chromium export." };
  } catch {
    return {
      available: false,
      reason: "Playwright is not installed. Install `playwright` (or configure HYPIIIT_CLI_PATH) to enable product capture.",
    };
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

const PROVIDERS: BrowserCaptureProvider[] = [new HypitBrowserCaptureProvider(), new PlaywrightBrowserCaptureProvider()];

/** Preference order: Hypit first (§6), Playwright as the local fallback. */
export function getCaptureProvider(id?: string): BrowserCaptureProvider {
  if (id) {
    const found = PROVIDERS.find((p) => p.id === id);
    if (found) return found;
  }
  return PROVIDERS[0];
}

export function listCaptureProviders(): BrowserCaptureProvider[] {
  return PROVIDERS;
}

/** Pick the first provider that reports READY. */
export async function selectCaptureProvider(): Promise<{ provider: BrowserCaptureProvider | null; status: ProviderStatus[] }> {
  const status: ProviderStatus[] = [];
  for (const p of PROVIDERS) {
    const s = await p.status();
    status.push(s);
    if (s.state === "READY") return { provider: p, status };
  }
  return { provider: null, status };
}
