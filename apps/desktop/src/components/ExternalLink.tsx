import React from "react";
import { ExternalLink as ExternalIcon } from "lucide-react";

interface Props {
  href: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * ExternalLink — allowlist-gated openExternal surface.
 * Matches ReUI homepage design system.
 */
export default function ExternalLinkComponent({ href, className = "", children }: Props) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const openExternal = (window as any).openExternal;
      if (typeof openExternal === "function") {
        const allowed = await openExternal(href);
        if (!allowed) {
          alert(`External link blocked: ${href}\nAllowed origins only.`);
        }
      }
    } catch {
      // Fail harmlessly — no error thrown to the renderer.
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[#de661c] hover:text-[#de661c]/80 transition-colors underline underline-offset-2 ${className}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children || href}
      <ExternalIcon size={10} className="shrink-0" />
    </a>
  );
}
