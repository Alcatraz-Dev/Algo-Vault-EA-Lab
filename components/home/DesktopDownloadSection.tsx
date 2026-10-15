"use client";

import { useEffect, useState } from "react";
import { useReducedMotion, motion } from "motion/react";
import { Monitor, Apple, Download, ExternalLink, Cpu, Shield, Zap, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import { Separator } from "@/components/ui/separator";

interface ReleaseInfo {
  version: string;
  channel: string;
  platforms: Record<string, {
    label: string;
    os: string;
    arch: string[];
    min_version: string;
    status: "available" | "preview" | "building" | "unavailable";
    download_url: string;
    release_notes_url?: string;
    file_size_human: string;
    build_target: string;
    notes: string;
  }>;
}

const STATUS_BADGE_MAP: Record<string, { variant: "success-light" | "warning-light" | "info-light" | "outline"; label: string }> = {
  available: { variant: "success-light", label: "Available" },
  preview: { variant: "warning-light", label: "Preview" },
  building: { variant: "info-light", label: "Building" },
  unavailable: { variant: "outline", label: "Unavailable" },
};

const FEATURES = [
  { icon: Zap, label: "Native performance" },
  { icon: Shield, label: "Secure local execution" },
  { icon: Cpu, label: "Hardware-accelerated charts" },
];

export default function DesktopDownloadSection() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    fetch("/downloads/releases.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ReleaseInfo) => setRelease(data))
      .catch(() => setError(true));
  }, []);

  const windows = release?.platforms?.windows;
  const macos = release?.platforms?.macos;

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
    <section aria-label="Desktop downloads" className="relative overflow-hidden border-y border-border bg-background">
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
        </motion.div>

        {/* Platform cards */}
        <div className="mt-16 grid gap-6 md:grid-cols-2 md:items-stretch">
          {/* Windows */}
          <motion.div {...staggerChild(0.1)}>
            <PlatformCard
              icon={<Monitor size={28} strokeWidth={1.8} className="text-foreground" />}
              title="Windows App"
              platform={windows}
              version={release?.version ?? "0.1.0-preview"}
              description="Dedicated Windows application with embedded production Next.js workspace, native window chrome, tray, and connection overlay."
              specs={[
                { label: "Architecture", value: "x64" },
                { label: "Minimum", value: "Windows 10+" },
                { label: "Package", value: "NSIS installer (~85 MB)" },
              ]}
              ciNote="Build is prepared by the desktop-release CI workflow on a Windows runner. Final artifact publishes to GitHub Releases once verified."
            />
          </motion.div>

          {/* macOS */}
          <motion.div {...staggerChild(0.2)}>
            <PlatformCard
              icon={<Apple size={28} strokeWidth={1.8} className="text-foreground" />}
              title="macOS App"
              platform={macos}
              version={release?.version ?? "0.1.0-preview"}
              description="Native macOS application for Apple Silicon Macs, with native menus, dark/light theme, tray icon, and persistent preferences."
              specs={[
                { label: "Architecture", value: "Apple Silicon ARM64" },
                { label: "Minimum", value: "macOS 13+" },
                { label: "Package", value: "Not available for download" },
              ]}
              ciNote="Build is prepared by the desktop-release CI workflow on a macOS runner. Final .dmg and .zip publish to GitHub Releases once verified."
            />
          </motion.div>
        </div>

        {/* Release info footer */}
        <motion.div {...staggerChild(0.3)}>
          <Card variant="default" className="mt-8 bg-secondary/40 border-border">
            <CardContent className="text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Release process:</strong>{" "}
              Windows x64 and macOS ARM64 builds are configured in{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                apps/desktop/package.json
              </code>{" "}
              via electron-builder. The desktop-release CI workflow runs on{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                windows-latest
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                macos-latest
              </code>{" "}
              runners. Code signing / notarization credentials are{" "}
              <strong className="text-foreground">not configured</strong>; they must be
              added as repository secrets before stable releases publish. Until
              artifacts are verified, downloads are marked{" "}
              <Badge variant="warning-light" size="xs">Preview</Badge>{" "}
              with release notes linked.
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
  platform,
  version,
  description,
  specs,
  ciNote,
}: {
  icon: React.ReactNode;
  title: string;
  platform?: ReleaseInfo["platforms"][string];
  version: string;
  description: string;
  specs: { label: string; value: string }[];
  ciNote: string;
}) {
  const status = platform?.status ?? "unavailable";
  const badge = STATUS_BADGE_MAP[status] ?? STATUS_BADGE_MAP.unavailable;

  return (
    <CardSpotlight className="h-full p-0 border-border bg-card transition-colors hover:border-primary/30">
      <div className="relative z-10 flex h-full flex-col p-7">
        {/* Icon + title row */}
        <div className="flex items-start gap-4">
          {/* Icon — no background, just the raw icon */}
          <div className="shrink-0 mt-0.5">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              {title}
            </h3>
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant={badge.variant} size="sm">
                {badge.label}
              </Badge>
              <span className="font-numeric text-xs text-muted-foreground">
                v{version}
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>

        {/* Specs table */}
        <div className="mt-5 space-y-2">
          {specs.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>

        <Separator className="my-5" />

        {/* CTA */}
        <div className="mt-auto">
          {status === "available" ? (
            <Button
              size="lg"
              className="w-full"
              render={
                <a href={platform!.download_url} download />
              }
            >
              <Download size={16} data-icon="inline-start" />
              Download for {title.replace(" App", "")}
            </Button>
          ) : status === "preview" ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full border-warning/20 text-warning-foreground hover:bg-warning/5"
              render={
                <a
                  href={platform?.release_notes_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink size={16} data-icon="inline-start" />
              Preview Build
              <ArrowRight size={14} className="ml-auto opacity-50" />
            </Button>
          ) : status === "building" ? (
            <Button variant="outline" size="lg" className="w-full" disabled>
              Building — check back soon
            </Button>
          ) : (
            <Button variant="outline" size="lg" className="w-full" disabled>
              Installer not yet available
            </Button>
          )}

          {status !== "available" && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {ciNote}
            </p>
          )}
        </div>
      </div>
    </CardSpotlight>
  );
}
