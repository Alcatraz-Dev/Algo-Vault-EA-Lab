"use client";

/**
 * LiveWorldMap — privacy-safe activity world map.
 *
 * Dots are real per-country clusters (built from the shared activity feed),
 * projected with a plain equirectangular formula onto the bundled world-map
 * SVG (784x458 equirectangular viewBox). Arcs connect the busiest countries.
 * Every number shown comes from the cluster itself — no decorative fake data.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe } from "lucide-react";
import type { CountryCluster } from "@/lib/live/live-types";

/** Bounds of the bundled world-map.svg viewBox (equirectangular). */
const MAP_W = 784.077;
const MAP_H = 458.627;
const MAP_X0 = 30.767;
const MAP_Y0 = 241.591;

/**
 * Projects lat/lng into the SVG's user coordinate space.
 * Equirectangular: x spans -180..180 → MAP_X0..MAP_X0+MAP_W, y 90..-90 →
 * MAP_Y0..MAP_Y0+MAP_H.
 */
function latLngToMapXY(lat: number, lng: number) {
  const x = MAP_X0 + ((lng + 180) / 360) * MAP_W;
  const y = MAP_Y0 + ((90 - lat) / 180) * MAP_H;
  return { x, y };
}

interface Props {
  clusters: CountryCluster[];
  hoveredCountry?: string;
  onHoverCountry?: (c?: string) => void;
  light?: boolean;
  sessions?: string[];
  className?: string;
}

export default function LiveWorldMap({
  clusters,
  hoveredCountry,
  onHoverCountry,
  light = false,
  sessions = [],
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const t = setTimeout(() => setReducedMotion(mq.matches), 0);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  const totalActive = useMemo(
    () => clusters.reduce((s, c) => s + c.activeUsers, 0) || 1,
    [clusters]
  );

  // Arcs connect the busiest countries (top 8), animating a packet along a
  // quadratic curve. With reduced motion we render the static path only.
  const arcs = useMemo(() => {
    const top = clusters.slice(0, 8);
    const out: { id: string; ax: number; ay: number; bx: number; by: number; mx: number; my: number }[] = [];
    for (let i = 0; i < top.length - 1; i++) {
      const a = latLngToMapXY(top[i].lat, top[i].lng);
      const b = latLngToMapXY(top[i + 1].lat, top[i + 1].lng);
      if (top[i].countryCode === top[i + 1].countryCode) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.22 - 12;
      out.push({ id: `arc-${i}`, ax: a.x, ay: a.y, bx: b.x, by: b.y, mx, my });
    }
    return out;
  }, [clusters]);

  const hovered = clusters.find((c) => c.country === hoveredCountry) ?? null;

  const accent = light ? "#2563eb" : "#00e5ff";
  const land = light ? "rgba(100,116,139,0.35)" : "rgba(148,163,184,0.35)";

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-[420px] md:h-[540px] overflow-hidden rounded-lg border shadow-xl shadow-black/10 ${light ? "bg-[#f4f7fb] border-border/40" : "bg-[#071018] border-border/60"} ${className}`}
    >
      <svg
        viewBox={`${MAP_X0} ${MAP_Y0} ${MAP_W} ${MAP_H}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="World map of aggregated trading activity by country"
      >
        <defs>
          <radialGradient id="lwm-dot" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset="60%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lwm-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.1" />
            <stop offset="50%" stopColor={accent} stopOpacity="0.6" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* World landmasses */}
        <image
          href="/assets/world-map.svg"
          x={MAP_X0}
          y={MAP_Y0}
          width={MAP_W}
          height={MAP_H}
          preserveAspectRatio="xMidYMid meet"
          opacity={light ? 0.9 : 0.85}
          style={{ filter: light ? "none" : "grayscale(1) brightness(1.6) contrast(1.05)" }}
        />

        {/* Graticule */}
        <g stroke={land} strokeWidth="0.4">
          {Array.from({ length: 5 }).map((_, i) => (
            <line
              key={`gr-h-${i}`}
              x1={MAP_X0}
              y1={MAP_Y0 + ((i + 1) / 6) * MAP_H}
              x2={MAP_X0 + MAP_W}
              y2={MAP_Y0 + ((i + 1) / 6) * MAP_H}
            />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line
              key={`gr-v-${i}`}
              x1={MAP_X0 + ((i + 1) / 8) * MAP_W}
              y1={MAP_Y0}
              x2={MAP_X0 + ((i + 1) / 8) * MAP_W}
              y2={MAP_Y0 + MAP_H}
            />
          ))}
        </g>

        {/* Connection arcs between busiest countries */}
        <g fill="none">
          {arcs.map((arc) => (
            <g key={arc.id}>
              <path
                d={`M ${arc.ax} ${arc.ay} Q ${arc.mx} ${arc.my} ${arc.bx} ${arc.by}`}
                stroke="url(#lwm-arc)"
                strokeWidth="1.2"
              />
              {!reducedMotion && (
                <circle r="2" fill={accent} opacity="0.85">
                  <animateMotion
                    dur={`${4 + (Number(arc.id.split("-")[1]) % 3)}s`}
                    repeatCount="indefinite"
                    path={`M ${arc.ax} ${arc.ay} Q ${arc.mx} ${arc.my} ${arc.bx} ${arc.by}`}
                  />
                </circle>
              )}
            </g>
          ))}
        </g>

        {/* Country cluster dots */}
        {clusters.map((c) => {
          const { x, y } = latLngToMapXY(c.lat, c.lng);
          const share = c.activeUsers / totalActive;
          const r = 3 + share * 34;
          const isHovered = hoveredCountry === c.country;
          return (
            <g
              key={c.countryCode + c.country}
              onMouseEnter={() => onHoverCountry?.(c.country)}
              onMouseLeave={() => onHoverCountry?.(undefined)}
              className="cursor-pointer"
            >
              {/* pulse ring */}
              {!reducedMotion && (
                <circle cx={x} cy={y} r={r} fill="none" stroke={accent} strokeOpacity="0.35">
                  <animate attributeName="r" values={`${r};${r * 2.1}`} dur="3s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.35;0" dur="3s" repeatCount="indefinite" />
                </circle>
              )}
              {/* glow */}
              <circle cx={x} cy={y} r={r * 1.6} fill="url(#lwm-dot)" opacity="0.35" />
              {/* core dot */}
              <circle
                cx={x}
                cy={y}
                r={isHovered ? r * 0.5 : Math.max(2.5, r * 0.35)}
                fill={accent}
                stroke={light ? "#fff" : "#0a1622"}
                strokeWidth="1"
                style={{ transition: "r 0.15s ease" }}
              />
              {/* invisible larger hit area */}
              <circle cx={x} cy={y} r={Math.max(12, r)} fill="transparent" />
            </g>
          );
        })}
      </svg>

      {/* Hover card */}
      {hovered && (
        <div
          className={`pointer-events-none absolute top-3 left-3 z-10 w-56 rounded-xl border p-3 backdrop-blur-md shadow-lg ${
            light ? "bg-white/90 border-border" : "bg-[#0b1622]/90 border-border/70"
          }`}
        >
          <div className="flex items-center gap-2">
            <Globe size={16} aria-hidden className="shrink-0 text-primary" />
            <span className="text-sm font-bold text-foreground">{hovered.country}</span>
            <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-micro font-mono text-muted-foreground">
              {hovered.countryCode}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-sm font-extrabold text-foreground tabular-nums">{hovered.activeUsers}</div>
              <div className="text-micro uppercase tracking-wider text-muted-foreground">traders</div>
            </div>
            <div>
              <div className="text-sm font-extrabold text-foreground tabular-nums">{hovered.analyses}</div>
              <div className="text-micro uppercase tracking-wider text-muted-foreground">analyses</div>
            </div>
            <div>
              <div className="text-sm font-extrabold text-foreground tabular-nums">{hovered.signals}</div>
              <div className="text-micro uppercase tracking-wider text-muted-foreground">signals</div>
            </div>
          </div>
          <div className="mt-2 text-micro text-muted-foreground">
            Top market <span className="font-mono font-bold text-foreground">{hovered.topMarket}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        className={`absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-full border px-3 py-1 text-micro font-medium backdrop-blur-md ${
          light ? "bg-white/80 border-border text-muted-foreground" : "bg-black/40 border-border/60 text-muted-foreground"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        Dot size = active traders
        <span className="mx-1 h-3 w-px bg-border" />
        {clusters.length} countries
      </div>

      {/* Sessions badge */}
      {sessions.length > 0 && (
        <div
          className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border px-3 py-1 text-micro font-semibold backdrop-blur-md ${
            light ? "bg-white/80 border-border text-foreground" : "bg-black/40 border-border/60 text-foreground"
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
          </span>
          {sessions.join(" + ")} open
        </div>
      )}

      {/* Privacy note */}
      <div
        className={`absolute bottom-3 left-3 z-10 text-micro font-mono tracking-wide ${
          light ? "text-muted-foreground/70" : "text-muted-foreground/60"
        }`}
      >
        AGGREGATED BY COUNTRY • PRIVACY-SAFE
      </div>
    </div>
  );
}
