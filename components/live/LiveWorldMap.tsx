"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveActivity } from "@/lib/live/live-types";

function latLngToXY(lat: number, lng: number, w: number, h: number) {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return { x, y };
}

export default function LiveWorldMap({
  activities,
  hoveredCountry,
  onHoverCountry,
  light = false,
}: {
  activities: LiveActivity[];
  hoveredCountry?: string;
  onHoverCountry?: (c?: string) => void;
  light?: boolean;
}) {
  const [dims, setDims] = useState({ w: 1200, h: 600 });
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [arcs, setArcs] = useState<{ a: LiveActivity; b: LiveActivity; id: string; progress: number }[]>([]);
  const tick = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const rect = e.contentRect;
        setDims({ w: Math.max(320, rect.width), h: Math.max(240, rect.height) });
      }
    });
    ro.observe(el);
    setMounted(true);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const pool = activities.slice(0, 20);
    const aArcs: typeof arcs = [];
    for (let i = 0; i < Math.min(pool.length - 1, 8); i++) {
      const a = pool[i];
      const b = pool[i + 1 + (i % 4)];
      aArcs.push({
        a,
        b,
        id: `arc-${i}-${a.country}-${b.country}`,
        progress: 0,
      });
    }
    setArcs(aArcs);
  }, [activities.length]);

  useEffect(() => {
    let rid: number;
    const step = () => {
      tick.current += 1;
      setArcs((prev) =>
        prev.map((arc) => ({
          ...arc,
          progress: (arc.progress + 0.008) % 1,
        }))
      );
      rid = requestAnimationFrame(step);
    };
    rid = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rid);
  }, []);

  const points = useMemo(() => {
    const p = activities.map((a) => {
      const pos = latLngToXY(a.latitude, a.longitude, dims.w, dims.h);
      return { ...a, x: pos.x, y: pos.y };
    });
    return p;
  }, [activities, dims]);

  const w = dims.w;
  const h = dims.h;

  const bgGradient = light
    ? "linear-gradient(180deg, #f4f7fb 0%, #e8edf3 60%, #dde3ec 100%)"
    : "linear-gradient(180deg, #0b1a2e 0%, #06101a 60%, #020d14 100%)";

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-[420px] md:h-[540px] lg:h-[640px] overflow-hidden rounded-2xl border shadow-xl shadow-black/10 ${
        light ? "bg-[#f4f7fb] border-border/40" : "bg-[#0a0a0a] border-border/60"
      }`}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        aria-label="Interactive world map"
        style={{ background: bgGradient }}
      >
        <defs>
          <radialGradient id="dotGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#00e5ff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="oceanGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#091d2b" />
            <stop offset="100%" stopColor="#020d14" />
          </linearGradient>
          <linearGradient id="oceanGradLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dde3ec" />
            <stop offset="100%" stopColor="#c3cbd6" />
          </linearGradient>
          <filter id="blurSoft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" />
          </filter>
          <filter id="dropShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00e5ff" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Ocean background */}
        <rect x="0" y="0" width={w} height={h} fill={light ? "url(#oceanGradLight)" : "url(#oceanGrad)"} />

        {/* Subtle grid */}
        <g stroke={light ? "#c8d2db" : "#181818"} strokeWidth="0.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`v${i}`} x1={w * ((i + 1) / 8)} y1={0} x2={w * ((i + 1) / 8)} y2={h} />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={h * ((i + 1) / 6)} x2={w} y2={h * ((i + 1) / 6)} />
          ))}
        </g>

        {/* Real world map */}
        <image href="/assets/world-map.svg" x="0" y="0" width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity={light ? 0.95 : 0.9} />

        {/* Arcs */}
        {arcs.map((arc, i) => {
          const ax = latLngToXY(arc.a.latitude, arc.a.longitude, w, h).x;
          const ay = latLngToXY(arc.a.latitude, arc.a.longitude, w, h).y;
          const bx = latLngToXY(arc.b.latitude, arc.b.longitude, w, h).x;
          const by = latLngToXY(arc.b.latitude, arc.b.longitude, w, h).y;
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2 - Math.abs(bx - ax) * 0.35;
          const progress = arc.progress;
          const qx = (1 - progress) * (1 - progress) * ax + 2 * (1 - progress) * progress * mx + progress * progress * bx;
          const qy = (1 - progress) * (1 - progress) * ay + 2 * (1 - progress) * progress * my + progress * progress * by;
          if (!isFinite(qx) || !isFinite(qy) || !mounted) return null;
          return (
            <g key={arc.id}>
              <path d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`} fill="none" stroke={light ? (i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#22c55e" : "#2563eb") : (i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#00ffa3" : "#00e5ff")} strokeWidth="1.5" strokeOpacity={0.55} />
              <circle cx={qx} cy={qy} r="2.5" fill={light ? (i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#22c55e" : "#2563eb") : (i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#00ffa3" : "#00e5ff")} opacity={0.9} filter="url(#blurSoft)" />
              <circle cx={qx} cy={qy} r="1" fill="#fff" opacity={0.9} />
            </g>
          );
        })}

        {/* Activity points */}
        {points.map((p, idx) => {
          const isHovered = hoveredCountry === p.country;
          const isNew = true;
          return (
            <g key={p.id + idx}>
              {/* Pulse ring */}
              {isNew && (
                <circle cx={p.x} cy={p.y} r="18" fill="none" stroke={light ? "#2563eb" : "#00e5ff"} strokeOpacity={0.35}>
                  <animate attributeName="r" from="6" to="24" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" from="0.5" to="0" dur="3s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Point */}
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 7 : 5}
                fill={light ? "#2563eb" : "#00e5ff"}
                stroke={p.direction === "bullish" ? "#22c55e" : p.direction === "bearish" ? "#ef4444" : light ? "#fff" : "#fff"}
                strokeWidth={isHovered ? 2 : 1.2}
                opacity={1}
                style={{ transition: "all 0.2s ease", filter: light ? "drop-shadow(0 0 4px rgba(37,99,235,0.5))" : "drop-shadow(0 0 4px rgba(0,229,255,0.6))" }}
                onMouseEnter={() => onHoverCountry?.(p.country)}
                onMouseLeave={() => onHoverCountry?.(undefined)}
              />
              {/* Subtle glow */}
              <circle cx={p.x} cy={p.y} r="6" fill="url(#dotGrad)" opacity="0.25" />
              {/* Label for hovered */}
              {isHovered && (
                <g>
                  <rect x={p.x + 10} y={p.y - 14} width={140} height={30} rx={4} fill={light ? "#fff" : "#181818"} stroke={light ? "#dde3ec" : "#333"} strokeWidth={0.5} />
                  <text x={p.x + 16} y={p.y - 2} fill={light ? "#0a0a0a" : "#f9f9f9"} fontSize={9} fontFamily="system-ui, sans-serif" fontWeight={600}>{p.country}</text>
                  <text x={p.x + 16} y={p.y + 7} fill={light ? "#555" : "#a3a3a3"} fontSize={7} fontFamily="system-ui, sans-serif">{p.market} • {p.activityType.replace("_", " ")}</text>
                  <text x={p.x + 16} y={p.y + 16} fill={light ? "#2563eb" : "#7CFF3F"} fontSize={7} fontFamily="monospace" fontWeight={700}>{Math.abs(p.countryCode.split("").reduce((a,b)=>a+b.charCodeAt(0),0)) % 800} active</text>
                </g>
              )}
              {/* Small decorative colored dots around point */}
              <circle cx={p.x + 10} cy={p.y + 6} r="2" fill="#ff4d00" opacity={0.9}>
                <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx={p.x - 8} cy={p.y - 4} r="1.5" fill="#22c55e" opacity={0.9}>
                <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2.5s" repeatCount="indefinite" />
              </circle>
              <circle cx={p.x + 4} cy={p.y + 12} r="1.5" fill="#f59e0b" opacity={0.9}>
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="3s" repeatCount="indefinite" />
              </circle>
              {/* Number always visible near point */}
              <text x={p.x + 8} y={p.y - 10} fill={light ? "#2563eb" : "#00e5ff"} fontSize={8} fontFamily="monospace" fontWeight={700} opacity={0.95} style={{ textShadow: light ? "0 0 4px rgba(37,99,235,0.5)" : "0 0 4px rgba(0,229,255,0.5)" }}>{Math.abs(p.countryCode.split("").reduce((a,b)=>a+b.charCodeAt(0),0)) % 800}</text>
            </g>
          );
        })}

        {/* Connect all country points together */}
        {points.map((p, idx) => {
          const next = points[(idx + 1) % points.length];
          const dPath = `M ${p.x} ${p.y} Q ${(p.x+next.x)/2 + (idx%3===0?15:idx%3===1?-15:0)} ${(p.y+next.y)/2 - 20} ${next.x} ${next.y}`;
          const color = idx % 3 === 0 ? "#00e5ff" : idx % 3 === 1 ? "#ff4d00" : "#22c55e";
          return (
            <g key={`map-connect-${idx}`}>
              <path d={dPath} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.6">
                <animate attributeName="stroke-opacity" values="0.6;0.3;0.6" dur={`${2 + idx * 0.2}s`} repeatCount="indefinite" />
              </path>
              <path id={`map-connect-path-${idx}`} d={dPath} fill="none" />
              <circle r="3" fill={color} opacity="0.95" filter="url(#dropShadow)">
                <animateMotion dur={`${3 + idx * 0.5}s`} repeatCount="indefinite" calcMode="linear">
                  <mpath href={`#map-connect-path-${idx}`} />
                </animateMotion>
                <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.5 + idx}s`} repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}

        {/* Decorative bottom dots */}
        {Array.from({ length: 12 }).map((_, i) => (
          <circle
            key={`bottom-dot-${i}`}
            cx={w * (0.05 + i * 0.08)}
            cy={h * 0.92 + Math.sin(i * 1.5) * 6}
            r={2 + (i % 3)}
            fill={i % 3 === 0 ? "#00e5ff" : i % 3 === 1 ? "#ff4d00" : "#22c55e"}
            opacity={0.7}
          >
            <animate attributeName="r" values={`${2 + (i % 3)};${4 + (i % 3)};${2 + (i % 3)}`} dur={`${2 + i}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0.2;0.7" dur={`${3 + i}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {/* Center decorative dots with numbers */}
        <g>
          {Array.from({ length: 15 }).map((_, i) => {
            const cx = w / 2 + Math.cos(i * 0.7 + 1) * 60;
            const cy = h / 2 + Math.sin(i * 0.7 + 1) * 40;
            const num = 100 + i * 22 + (i % 4) * 7;
            return (
              <g key={`center-dot-${i}`}>
                <circle cx={cx} cy={cy} r="18" fill="none" stroke={i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#00e5ff" : "#22c55e"} strokeOpacity="0.35">
                  <animate attributeName="r" from="6" to="24" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" from="0.5" to="0" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx={cx} cy={cy} r="5" fill={i % 3 === 0 ? "#ff4d00" : i % 3 === 1 ? "#00e5ff" : "#22c55e"} opacity="0.95" filter="url(#blurSoft)">
                  <animate attributeName="r" values="5;7;5" dur={`${2.5 + i * 0.3}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.95;0.4;0.95" dur={`${3 + i * 0.4}s`} repeatCount="indefinite" />
                </circle>
                <circle cx={cx} cy={cy} r="2" fill="#fff" />
                <text x={cx + 8} y={cy - 6} fill={light ? "#2563eb" : "#00e5ff"} fontSize="9" fontFamily="monospace" fontWeight="700" opacity="0.95" style={{ textShadow: light ? "0 0 4px rgba(37,99,235,0.5)" : "0 0 4px rgba(0,229,255,0.5)" }}>{num}</text>
              </g>
            );
          })}
          {Array.from({ length: 8 }).map((_, i) => {
            const x1 = w / 2 + Math.cos(i * 1.1) * 50;
            const y1 = h / 2 + Math.sin(i * 1.1) * 30;
            const x2 = w / 2 + Math.cos(i * 1.1 + 1.8) * 50;
            const y2 = h / 2 + Math.sin(i * 1.1 + 1.8) * 30;
            return (
              <path key={`center-arc-${i}`} d={`M ${x1} ${y1} Q ${w/2} ${h/2} ${x2} ${y2}`} fill="none" stroke={i % 2 === 0 ? "#00e5ff" : "#ff4d00"} strokeWidth="1" strokeOpacity="0.6">
                <animate attributeName="stroke-opacity" values="0.6;0.2;0.6" dur={`${2 + i}s`} repeatCount="indefinite" />
              </path>
            );
          })}
        </g>
      </svg>

      <div className={`absolute bottom-3 left-3 text-[10px] font-mono tracking-wide ${light ? "text-muted-foreground/70" : "text-muted-foreground/60"}`}>
        ALGO ALPHA • LIVE AGGREGATED DATA • PRIVACY-SAFE
      </div>
    </div>
  );
}
