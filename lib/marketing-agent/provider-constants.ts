/**
 * Marketing Agent — provider constants (pure).
 *
 * Split out of `provider.ts` so the version-compatibility gate and the
 * provider contract identifiers can be imported from client-safe code and
 * from tests without pulling in the server-only provider implementations.
 */

export const HYPIIIT_PROVIDER_ID = "hypit";
export const FFMPEG_PROVIDER_ID = "ffmpeg-local";

/**
 * Minimum supported Hypit version (§12, §85).
 * Pinned deliberately: production never depends on an unpinned `latest`.
 * Upgrades require verification — see docs/marketing-agent/hypit-setup.md.
 */
export const EXPECTED_HYPIIIT_VERSION = "0.1.0";

export function isVersionCompatible(detected: string | null, expected = EXPECTED_HYPIIIT_VERSION): boolean {
  if (!detected) return false;
  const d = detected.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  const e = expected.split(".").map((n) => Number.parseInt(n, 10));
  if (d.some((n) => Number.isNaN(n)) || e.some((n) => Number.isNaN(n))) return false;
  if (d[0] !== e[0]) return false;
  if ((d[1] ?? 0) < (e[1] ?? 0)) return false;
  return true;
}
