import React from "react";
import { Info } from "lucide-react";

interface DataConsentNoticeProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Absolute URL of the public Privacy Policy (working link required). */
  privacyUrl: string;
  /** Unique per rendered page — popup and side panel are separate documents. */
  id?: string;
}

/**
 * Compact in-product data-handling disclosure + explicit consent checkbox.
 *
 * Shared by every sign-in entry path (popup `LoginView`, side-panel login)
 * so the wording and gating behavior cannot drift between surfaces.
 *
 * Accessibility notes:
 * - Native checkbox associated with its label via `htmlFor` (screen-reader
 *   announced, keyboard operable, visible focus ring).
 * - The Privacy Policy link is rendered OUTSIDE the `<label>` element:
 *   activating the link cannot toggle the checkbox, and a link click never
 *   counts as consent.
 */
export function DataConsentNotice({
  checked,
  onChange,
  privacyUrl,
  id = "av-data-consent",
}: DataConsentNoticeProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        />
        <Info size={12} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
        <p className="text-[11px] leading-snug text-ink-mute">
          <label htmlFor={id} className="cursor-pointer">
            AlgoVault uses your TradingView chart data and Copilot messages,
            sent with your session, to provide AI analysis.
          </label>{" "}
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink underline decoration-brand-500/60 underline-offset-2 transition-colors hover:decoration-brand-400"
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
