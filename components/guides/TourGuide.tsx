"use client";

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X, Map } from "lucide-react";

export type TourStep = { target?: string; title: string; body: string };

type TourGuideProps = {
    steps: TourStep[];
    storageKey: string;
    pageTitle?: string;
    autoOpen?: boolean;
    autoOpenDelay?: number;
    legacySeenKeys?: string[];
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

/** Return the best meaningful container wrapping `el` */
function expandToContainer(el: HTMLElement): HTMLElement {
    // If this is already a large section-level element, use it as-is
    const rect = el.getBoundingClientRect();
    if (rect.height >= 160 && rect.width >= 400) return el;

    // Walk up to find a meaningful card/section container
    const selectors = [
        "[data-guide]",
        "section",
        "article",
        "form",
        "[class*='rounded-2xl']",
        "[class*='rounded-xl']",
        "[class*='rounded-lg']",
        "[class*='border border-']",
        "[class*='border-border']",
        "[class*='bg-card']",
        "[class*='bg-muted']",
        "main > div > div",
        "main > div",
    ];

    for (const sel of selectors) {
        const container = el.closest<HTMLElement>(sel);
        if (container && container !== el && container !== document.body) {
            const cRect = container.getBoundingClientRect();
            // Must be meaningfully larger than the source element
            if (cRect.width >= 280 && cRect.height >= 100) {
                return container;
            }
        }
    }

    return el;
}

function isVisible(el: HTMLElement): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isElementInViewport(el: HTMLElement, margin = 0): boolean {
    const rect = el.getBoundingClientRect();
    return (
        rect.bottom >= -margin &&
        rect.right >= -margin &&
        rect.top <= window.innerHeight + margin &&
        rect.left <= window.innerWidth + margin
    );
}

function resolveTarget(step: TourStep | undefined, stepIndex: number): HTMLElement | null {
    if (!step) return null;

    // 1. Explicit data-guide selector (highest priority)
    if (step.target) {
        const el = document.querySelector<HTMLElement>(step.target);
        if (el && isVisible(el) && isElementInViewport(el, 200)) {
            return expandToContainer(el);
        }
        // If element exists but not in viewport, still try to use it (will scroll into view)
        if (el && isVisible(el)) {
            return expandToContainer(el);
        }
    }

    // 2. Text-matching fallback: find heading/label with matching text, then expand
    if (step.title) {
        const candidates = Array.from(
            document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, [data-guide], label, button, p, span, div")
        );
        const match = candidates.find((el) => {
            const text = (el.textContent || "").trim().toLowerCase();
            const title = step.title.toLowerCase();
            // Match exact heading text or strong partial match
            return text === title || 
                   (text.startsWith(title) && text.length < title.length + 40) ||
                   text.includes(title);
        });
        if (match && isVisible(match)) {
            return expandToContainer(match);
        }
    }

    // 3. Scout by position: collect top-level content blocks and pick by index
    return scoutTarget(stepIndex);
}

function scoutTarget(offset: number): HTMLElement | null {
    const root = document.querySelector<HTMLElement>("main") || document.body;

    const isChrome = (el: HTMLElement) =>
        Boolean(el.closest("nav, aside, footer, header, [data-guide='sidebar']"));

    const isInvalid = (el: HTMLElement): boolean => {
        if (isChrome(el)) return true;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return true;
        if (style.position === "fixed" || style.position === "sticky") return true;
        const rect = el.getBoundingClientRect();
        return rect.width < 200 || rect.height < 60;
    };

    // Prefer explicit data-guide markers first
    const guideEls = Array.from(root.querySelectorAll<HTMLElement>("[data-guide]")).filter(
        (el) => !isInvalid(el)
    );
    if (guideEls.length > 0) {
        return guideEls[clamp(offset, 0, guideEls.length - 1)];
    }

    // Fall back to structural content blocks
    const selector =
        "section, article, form, fieldset, table, .rounded-2xl, .rounded-xl, " +
        "main > div > div.border, main > div > div.rounded-2xl, main > div > div.rounded-xl";
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !isInvalid(el)
    );

    // Deduplicate by removing children of already-kept elements
    const kept: HTMLElement[] = [];
    for (const el of blocks) {
        if (kept.some((k) => k.contains(el))) continue;
        kept.push(el);
    }

    if (kept.length === 0) {
        // Last resort: any visible h2 heading
        const headings = Array.from(root.querySelectorAll<HTMLElement>("h2, h3")).filter(
            (el) => isVisible(el) && !isChrome(el)
        );
        if (headings.length > 0) {
            return expandToContainer(headings[clamp(offset, 0, headings.length - 1)]);
        }
        return null;
    }

    return kept[clamp(offset, 0, kept.length - 1)];
}

// ─────────────────────────────────────────────────────────────────────────────

type SpotRect = { left: number; top: number; width: number; height: number };

export default function TourGuide({
    steps,
    storageKey,
    pageTitle = "Guide",
    autoOpen = true,
    autoOpenDelay = 700,
    legacySeenKeys = [],
}: TourGuideProps) {
    const [open, setOpen] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [spotRect, setSpotRect] = useState<SpotRect | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [viewport, setViewport] = useState({ w: 1280, h: 800 });
    const rafRef = useRef<number | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const lastSpotTime = useRef<number>(0);

    // ── Reactive viewport dimensions ──────────────────────────────────────────
    useEffect(() => {
        const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    // ── Auto-open on first visit ──────────────────────────────────────────────
    useEffect(() => {
        if (!autoOpen || steps.length === 0) return;
        try {
            const seen = Boolean(localStorage.getItem(storageKey));
            const legacySeen = legacySeenKeys.some((k) => Boolean(localStorage.getItem(k)));
            if (!seen) localStorage.setItem(storageKey, "1");
            if (seen || legacySeen) return;
            const t = window.setTimeout(() => {
                setStepIndex(0);
                setOpen(true);
            }, autoOpenDelay);
            return () => clearTimeout(t);
        } catch {
            /* ignore */
        }
    }, [autoOpen, autoOpenDelay, storageKey, steps.length, legacySeenKeys]);

    // ── Reset retry count when step or open state changes ─────────────────────
    useEffect(() => {
        setRetryCount(0);
    }, [stepIndex, open]);

    // ── Spotlight position tracking ───────────────────────────────────────────
    const updateSpot = useCallback(() => {
        const el = resolveTarget(steps[stepIndex] as TourStep | undefined, stepIndex);
        if (!el) { 
            setSpotRect(null); 
            return; 
        }
        const r = el.getBoundingClientRect();
        const PAD = 8;
        const newRect = {
            left: Math.max(0, r.left - PAD),
            top: Math.max(0, r.top - PAD),
            width: Math.max(40, r.width + PAD * 2),
            height: Math.max(40, r.height + PAD * 2),
        };
        // Only update if significantly different to reduce re-renders
        setSpotRect((prev) => {
            if (!prev) return newRect;
            if (Math.abs(prev.left - newRect.left) < 2 && 
                Math.abs(prev.top - newRect.top) < 2 &&
                Math.abs(prev.width - newRect.width) < 2 &&
                Math.abs(prev.height - newRect.height) < 2) {
                return prev;
            }
            return newRect;
        });
    }, [stepIndex, steps]);

    useEffect(() => {
        if (!open) return;

        // Scroll target into view then continuously track
        const el = resolveTarget(steps[stepIndex] as TourStep | undefined, stepIndex);
        if (el) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
        }

        const loop = () => {
            const now = Date.now();
            if (now - lastSpotTime.current > 100) {
                updateSpot();
                lastSpotTime.current = now;
            }
            rafRef.current = requestAnimationFrame(loop);
        };
        updateSpot();
        lastSpotTime.current = Date.now();
        rafRef.current = requestAnimationFrame(loop);
        
        // Add passive scroll/resize listeners
        const onScroll = () => {
            if (Date.now() - lastSpotTime.current > 100) {
                updateSpot();
                lastSpotTime.current = Date.now();
            }
        };
        const onResize = () => {
            updateSpot();
            lastSpotTime.current = Date.now();
        };
        
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
        };
    }, [open, stepIndex, steps, updateSpot]);

    // ── Retry mechanism when target not found ─────────────────────────────────
    useEffect(() => {
        if (!open) return;
        if (spotRect === null && retryCount < 5) {
            const t = window.setTimeout(() => {
                setRetryCount((c) => c + 1);
                updateSpot();
            }, 300);
            return () => clearTimeout(t);
        }
    }, [open, spotRect, retryCount, updateSpot]);

    // ── Keyboard navigation ───────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowRight") setStepIndex((p) => Math.min(steps.length - 1, p + 1));
            else if (e.key === "ArrowLeft") setStepIndex((p) => Math.max(0, p - 1));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, steps.length]);

    const goTo = (i: number) => setStepIndex(clamp(i, 0, steps.length - 1));

    const current = steps[stepIndex] as TourStep | undefined;

    // ── Card positioning ──────────────────────────────────────────────────────
    const vw = viewport.w;
    const vh = viewport.h;
    const CARD_W = 360;
    const CARD_H_EST = 200;

    let cardLeft = (vw - CARD_W) / 2;
    let cardTop = vh / 2 - CARD_H_EST / 2;
    let placeAbove = false;

    if (spotRect) {
        const spotBottom = spotRect.top + spotRect.height;
        const spaceBelow = vh - spotBottom;
        const spaceAbove = spotRect.top;
        placeAbove = spaceBelow < CARD_H_EST + 24 && spaceAbove > CARD_H_EST + 24;

        cardTop = placeAbove
            ? spotRect.top - CARD_H_EST - 16
            : Math.min(spotBottom + 16, vh - CARD_H_EST - 12);
        cardLeft = clamp(
            spotRect.left + spotRect.width / 2 - CARD_W / 2,
            12,
            vw - CARD_W - 12
        );
    }

    // ── 4-panel overlay rectangles ────────────────────────────────────────────
    // Creates a true viewport-sized dark overlay with a rectangular cutout.
    // Using 4 positioned panels avoids SVG/clip-path quirks.
    const renderOverlay = () => {
        if (!spotRect) {
            // Full dark overlay when no target
            return (
                <div
                    className="pointer-events-none fixed inset-0 z-[79] bg-background/75"
                    style={{ transition: "opacity 300ms" }}
                />
            );
        }

        const { left: sl, top: st, width: sw, height: sh } = spotRect;
        const sr = sl + sw; // spot right
        const sb = st + sh; // spot bottom

        const panelStyle: CSSProperties = {
            position: "fixed",
            background: "rgba(2,6,23,0.80)",
            pointerEvents: "none",
            zIndex: 79,
            transition: "all 300ms ease",
        };

        return (
            <>
                {/* Top strip */}
                <div style={{ ...panelStyle, inset: `0 0 ${vh - st}px 0` }} />
                {/* Bottom strip */}
                <div style={{ ...panelStyle, inset: `${sb}px 0 0 0` }} />
                {/* Left strip (between top and bottom strips) */}
                <div style={{ ...panelStyle, inset: `${st}px ${vw - sl}px ${vh - sb}px 0` }} />
                {/* Right strip (between top and bottom strips) */}
                <div style={{ ...panelStyle, inset: `${st}px 0 ${vh - sb}px ${sr}px` }} />
            </>
        );
    };

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <>
            {/* Floating "Guide" button */}
            {!open && steps.length > 0 && (
                <button
                    type="button"
                    id="tour-guide-open-btn"
                    onClick={() => { setStepIndex(0); setOpen(true); }}
                    className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-semibold text-background shadow-xl ring-1 ring-border/40 transition hover:opacity-90 active:scale-95"
                >
                    <Map size={14} />
                    Page Guide
                </button>
            )}

            {open && (
                <div className="fixed inset-0 z-[78]" role="dialog" aria-modal="true" aria-label={current?.title}>

                    {/* ── 4-panel backdrop overlay ── */}
                    {renderOverlay()}

                    {/* ── Glowing spotlight ring ── */}
                    {spotRect && (
                        <div
                            key={`ring-${stepIndex}-${retryCount}`}
                            className="pointer-events-none fixed z-[80] rounded-xl border-2 border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.15),0_0_20px_rgba(56,189,248,0.4),0_0_40px_rgba(56,189,248,0.2)]"
                            style={{
                                left: spotRect.left,
                                top: spotRect.top,
                                width: spotRect.width,
                                height: spotRect.height,
                                transition: "left 250ms cubic-bezier(0.4, 0, 0.2, 1), top 250ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1), height 250ms cubic-bezier(0.4, 0, 0.2, 1)",
                                animation: "spotlight-pulse 2s ease-in-out infinite",
                            }}
                        />
                    )}

                    {/* ── Step tooltip card ── */}
                    <div
                        ref={cardRef}
                        key={`card-${stepIndex}`}
                        className="fixed z-[81] w-[min(360px,calc(100vw-24px))] animate-in fade-in-0 zoom-in-95 rounded-2xl border border-border bg-card p-5 shadow-2xl duration-200"
                        style={{
                            left: cardLeft,
                            top: Math.max(8, cardTop),
                            transition: "left 300ms ease, top 300ms ease",
                        }}
                    >
                        {/* Header row */}
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                {pageTitle} · {stepIndex + 1} / {steps.length}
                            </span>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                aria-label="Close guide"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        {/* Step content */}
                        <h3 className="mt-3 text-base font-bold text-foreground">{current?.title}</h3>
                        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{current?.body}</p>

                        {/* Navigation */}
                        <div className="mt-4 flex items-center justify-between gap-3">
                            {/* Dot indicators */}
                            <div className="flex items-center gap-1.5">
                                {steps.map((s, i) => (
                                    <button
                                        key={`dot-${i}`}
                                        type="button"
                                        onClick={() => goTo(i)}
                                        aria-label={`Step ${i + 1}`}
                                        className={`h-1.5 rounded-full transition-all ${
                                            i === stepIndex
                                                ? "w-5 bg-sky-400"
                                                : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70"
                                        }`}
                                    />
                                ))}
                            </div>

                            {/* Prev / Next */}
                            <div className="flex items-center gap-2">
                                {stepIndex > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => goTo(stepIndex - 1)}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                        aria-label="Previous step"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                )}
                                {stepIndex < steps.length - 1 ? (
                                    <button
                                        type="button"
                                        onClick={() => goTo(stepIndex + 1)}
                                        className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-sky-400 active:scale-95"
                                    >
                                        Next <ChevronRight size={13} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setOpen(false)}
                                        className="rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition hover:opacity-90 active:scale-95"
                                    >
                                        Got it ✓
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}