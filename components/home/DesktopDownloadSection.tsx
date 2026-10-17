"use client";

import { useEffect, useState } from "react";
import { useReducedMotion, motion } from "motion/react";
import { Monitor, Apple, Download, ExternalLink, Cpu, Shield, Zap, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import { Separator } from "@/components/ui/separator";

interface PlatformRelease {
  label: string;
  os: string;
  arch: string[];
  min_version: string;
  status: "available" | "preview" | "building" | "unavailable";
  download_url?: string;
  release_notes_url?: string;
  file_name?: string;
  file_size_bytes?: number;
  file_size_human?: string;
  checksum_sha256?: string;
  build_target?: string;
  supported_processors?: string[];
  notes?: string;
}

interface ReleaseInfo {
  version: string;
  channel?: string;
  prerelease?: boolean;
  tag?: string;
  published?: string;
  source?: string;
  platforms: Record<string, PlatformRelease>;
}

const FEATURES = [
  { icon: Zap, label: "Native performance" },
  { icon: Shield, label: "Secure local execution" },
  { icon: Cpu, label: "Hardware-accelerated charts" },
];

/** Format a date-only value without shifting it across timezones. */
function formatPublishedDate(iso?: string): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function DesktopDownloadSection() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;

    fetch("/downloads/releases.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: ReleaseInfo) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const windows = release?.platforms?.windows;
  const macos = release?.platforms?.macos;
  const isLoading = !release && !error;
  const isPreview = Boolean(release && release.channel !== "stable");
  const publishedLabel = formatPublishedDate(release?.published);

  const ease = [0.22, 1, 0.36, 1] as const;

  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-80px" as const },
        transition: { duration: 0.5, ease },
      };

  const staggerChild = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-60px" as const },
          transition: { duration: 0.45, ease, delay },
        };

  return (
    <section
      id="desktop"
      aria-label="Desktop downloads"
      className="relative overflow-hidden border-y border-border bg-background"
    >
      {/* Subtle ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full opacity-[0.04] blur-[120px]"
        style={{ background: "var(--primary)" }}
      />

      <div className="mx-auto max-w-7xl px-6 py-20 md:px-8 md:py-28">
        {/* Header */}
        <motion.div className="mx-auto max-w-3xl text-center" {...fadeUp}>
          <Badge variant="primary-light" size="lg" className="mb-5">
            <Cpu size={12} />
            Desktop App
          </Badge>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl md:text-5xl text-balance">
            Your Trading Workspace.{" "}
            <span className="text-primary">Now on Desktop.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg max-w-2xl mx-auto">
            Bring your AlgoVault trading workspace to your desktop. Explore
            market intelligence, analyze charts, manage strategies, and access
            your trading tools from a dedicated application.
          </p>

          {/* Feature pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground"
              >
                <Icon size={15} className="text-primary" />
                {label}
              </span>
            ))}
          </div>

          {/* Release line */}
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-numeric font-semibold text-foreground">
              {release
                ? `Version ${release.version}`
                : error
                  ? "Version unavailable"
                  : "Checking release…"}
            </span>
            <span aria-hidden>·</span>
            <span>{release?.channel === "preview" ? "Preview channel" : "Desktop release"}</span>
            {publishedLabel && (
              <>
                <span aria-hidden>·</span>
                <span className="font-numeric">Published {publishedLabel}</span>
              </>
            )}
          </p>
        </motion.div>

        {/* Platform cards */}
        <div className="mt-16 grid gap-6 md:grid-cols-2 md:items-stretch">
          {/* Windows */}
          <motion.div {...staggerChild(0.1)}>
            <PlatformCard
              icon={<Monitor size={28} strokeWidth={1.8} className="text-foreground" />}
              title="Windows App"
              subtitle="Windows x64"
              platformKey="windows"
              platform={windows}
              version={release?.version}
              publishedLabel={publishedLabel}
              loading={isLoading}
              error={error}
              isPreview={isPreview}
              description="Dedicated Windows application with embedded production Next.js workspace, native window chrome, tray, and connection overlay."
              installHint="First run: if Windows SmartScreen appears, choose More info → Run anyway. This preview installer is not code-signed."
            />
          </motion.div>

          {/* macOS */}
          <motion.div {...staggerChild(0.2)}>
            <PlatformCard
              icon={<Apple size={28} strokeWidth={1.8} className="text-foreground" />}
              title="macOS App"
              subtitle="Apple Silicon (ARM64)"
              platformKey="macos"
              platform={macos}
              version={release?.version}
              publishedLabel={publishedLabel}
              loading={isLoading}
              error={error}
              isPreview={isPreview}
              description="Native macOS application for Apple Silicon Macs, with native menus, dark/light theme, tray icon, and persistent preferences."
              installHint="First launch: open the app from Applications with right-click → Open, or allow it in System Settings → Privacy & Security. This preview build is unsigned and unnotarized."
            />
          </motion.div>
        </div>

        {/* Release info footer */}
        <motion.div {...staggerChild(0.3)}>
          <Card variant="default" className="mt-8 bg-secondary/40 border-border">
            <CardContent className="text-xs leading-relaxed text-muted-foreground">
              {!release ? (
                isLoading ? (
                  <p>Loading release information…</p>
                ) : (
                  <p>
                    <strong className="text-foreground">Release information unavailable.</strong>{" "}
                    The download manifest could not be loaded, so installers are hidden
                    rather than linked to unverified files. Refresh the page to try again.
                  </p>
                )
              ) : (
                <p>
                  <strong className="text-foreground">About this release:</strong>{" "}
                  {isPreview ? "This is a preview build" : "This is a desktop release"} of{" "}
                  <span className="font-numeric">v{release.version}</span>{" "}
                  for Windows x64 and macOS Apple Silicon (ARM64). Downloads point to the
                  published GitHub Release assets and include the published checksum, so
                  you can verify each file before installing.
                  {isPreview && (
                    <>
                      {" "}
                      <Badge variant="warning-light" size="xs">Preview</Badge> builds may
                      be unsigned, which is expected for this channel. Intel Macs are not
                      supported by this build.
                    </>
                  )}{" "}
                  {release.source && (
                    <a
                      href={release.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
                    >
                      View release notes
                    </a>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Platform card sub-component ── */

function PlatformCard({
  icon,
  title,
  subtitle,
  platformKey,
  platform,
  version,
  publishedLabel,
  loading,
  error,
  isPreview,
  description,
  installHint,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  platformKey: "windows" | "macos";
  platform?: PlatformRelease;
  version?: string;
  publishedLabel: string | null;
  loading: boolean;
  error: boolean;
  isPreview: boolean;
  description: string;
  installHint: string;
}) {
  const downloadUrl = platform?.download_url?.trim();
  const hasDownload = Boolean(downloadUrl);
  const releaseNotesUrl = platform?.release_notes_url ?? undefined;

  const badge = loading
    ? { variant: "info-light" as const, label: "Checking" }
    : error
      ? { variant: "outline" as const, label: "Unavailable" }
      : hasDownload
        ? isPreview
          ? { variant: "warning-light" as const, label: "Preview" }
          : { variant: "success-light" as const, label: "Available" }
        : platform?.status === "building"
          ? { variant: "info-light" as const, label: "Building" }
          : { variant: "outline" as const, label: "Unavailable" };

  const packageLabel = hasDownload
    ? platform?.file_name ?? `${title.replace(" App", "")} installer`
    : platform?.status === "building"
      ? "Awaiting CI build"
      : "Not available for download";

  return (
    <CardSpotlight className="h-full p-0 border-border bg-card transition-colors hover:border-primary/30">
      <div className="relative z-10 flex h-full flex-col p-7">
        {/* Icon + title row */}
        <div className="flex items-start gap-4">
          {/* Icon — no background, just the raw icon */}
          <div className="shrink-0 mt-0.5">{icon}</div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold tracking-tight text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={badge.variant} size="sm">
                {badge.label}
              </Badge>
              {version && (
                <span className="font-numeric text-xs text-muted-foreground">v{version}</span>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p>

        {/* Specs table */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">Architecture</span>
            <span className="text-right font-medium text-foreground">
              {platform?.arch?.length ? platform.arch.join(", ") : subtitle}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">Minimum</span>
            <span className="text-right font-medium text-foreground">
              {platform?.min_version ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">Download size</span>
            <span className="text-right font-medium text-foreground">
              {hasDownload ? platform?.file_size_human ?? "—" : "—"}
            </span>
          </div>
        </div>

        <Separator className="my-5" />

        {/* CTA */}
        <div className="mt-auto">
          {loading ? (
            <Button variant="outline" size="lg" className="w-full" disabled>
              Checking latest release…
            </Button>
          ) : hasDownload ? (
            <Button
              size="lg"
              className="w-full"
              render={<a href={downloadUrl} download={platform?.file_name} />}
            >
              <Download size={16} data-icon="inline-start" />
              Download for {title.replace(" App", "")}
            </Button>
          ) : platform?.status === "building" ? (
            <Button variant="outline" size="lg" className="w-full" disabled>
              Building — check back soon
            </Button>
          ) : (
            <Button variant="outline" size="lg" className="w-full" disabled>
              Installer not available yet
            </Button>
          )}

          {/* Package + verification line */}
          <p className="mt-3 break-all text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">{packageLabel}</span>
            {hasDownload && publishedLabel && (
              <>
                {" · "}
                <span className="font-numeric">Published {publishedLabel}</span>
              </>
            )}
            {hasDownload && platform?.checksum_sha256 && (
              <>
                <br />
                <span className="font-numeric" title={platform.checksum_sha256}>
                  SHA-256 {platform.checksum_sha256.slice(0, 12)}…{platform.checksum_sha256.slice(-8)}
                </span>
              </>
            )}
          </p>

          {/* Install guidance for preview builds */}
          {hasDownload && isPreview && (
            <p className="mt-3 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {installHint}
            </p>
          )}

          {/* Release notes link for non-downloadable previews */}
          {!hasDownload && !loading && !error && releaseNotesUrl && (
            <a
              href={releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              <ExternalLink size={12} />
              See release notes
              <ArrowRight size={12} aria-hidden />
            </a>
          )}

          {hasDownload && releaseNotesUrl && (
            <a
              href={releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              <ExternalLink size={12} />
              Release notes for {platformKey === "macos" ? "macOS" : "Windows"}
              <ArrowRight size={12} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </CardSpotlight>
  );
}
