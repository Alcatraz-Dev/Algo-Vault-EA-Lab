"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipState = {
  label: string;
  badge?: string;
  shortcut?: string;
  top: number;
  left: number;
};

/** A single theme-aware tooltip portaled outside the desktop rail's overflow. */
export function DesktopTooltipLayer() {
  const activeTarget = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<TooltipState | null>(null);

  useEffect(() => {
    function getTarget(event: Event): HTMLElement | null {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>("[data-nav-tooltip]");
    }

    function place(target: HTMLElement) {
      const rect = target.getBoundingClientRect();
      const rail = target.closest("nav");
      const railRect = rail?.getBoundingClientRect();

      // Do not leave a tooltip floating when its scrollable trigger is clipped.
      if (
        !rect.width ||
        !rect.height ||
        (railRect && (rect.bottom <= railRect.top || rect.top >= railRect.bottom))
      ) {
        activeTarget.current = null;
        setState(null);
        return;
      }

      activeTarget.current = target;
      setState({
        label: target.dataset.navTooltip ?? "",
        badge: target.dataset.navBadge || undefined,
        shortcut: target.dataset.navShortcut || undefined,
        top: Math.min(Math.max(rect.top + rect.height / 2, 20), window.innerHeight - 20),
        left: Math.min((railRect?.right ?? rect.right) + 8, window.innerWidth - 12),
      });
    }

    function hide(target?: HTMLElement | null) {
      if (target && activeTarget.current !== target) return;
      activeTarget.current = null;
      setState(null);
    }

    function onPointerOver(event: Event) {
      const target = getTarget(event);
      if (target) place(target);
    }

    function onPointerOut(event: Event) {
      const target = getTarget(event);
      if (!target) return;
      const related = (event as FocusEvent).relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      hide(target);
    }

    function onFocusIn(event: Event) {
      const target = getTarget(event);
      if (target) place(target);
    }

    function onFocusOut(event: Event) {
      const target = getTarget(event);
      if (!target) return;
      const related = (event as FocusEvent).relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      hide(target);
    }

    function onScrollOrResize() {
      const target = activeTarget.current;
      if (target?.isConnected) place(target);
      else hide();
    }

    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="tooltip"
      data-desktop-tooltip=""
      className="pointer-events-none fixed z-[2147483647] -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-xl transition-opacity duration-150"
      style={{ top: `${state.top}px`, left: `${state.left}px` }}
    >
      {state.label}
      {state.badge ? (
        <span className="ml-1.5 rounded-sm bg-accent px-1 py-0.5 text-micro font-bold uppercase tracking-wider text-primary">
          {state.badge}
        </span>
      ) : null}
      {state.shortcut ? (
        <span className="ml-1.5 text-muted-foreground">{state.shortcut}</span>
      ) : null}
    </div>,
    document.body,
  );
}
