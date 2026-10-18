import React from "react";

interface DataConsentNoticeProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Absolute URL of the public Privacy Policy (working link required). */
  privacyUrl: string;
  /** Unique per rendered page — popup and side panel are separate documents. */
  id?: string;
}

/**
 * Prominent in-product data-handling disclosure + explicit consent checkbox.
 *
 * Shared by every sign-in entry path (popup `LoginView`, side-panel login)
 * so the wording and gating behavior cannot drift between surfaces.
 *
 * Accessibility notes:
 * - Native checkbox associated with its label via `htmlFor` (screen-reader
 *   announced, keyboard operable, visible focus ring).
 * - The Privacy Policy link is a SIBLING of the `<label>`, never nested
 *   inside it: activating the link must not toggle consent, and a link
 *   click must never count as consent.
 */
export function DataConsentNotice({
  checked,
  onChange,
  privacyUrl,
  id = "av-data-consent",
}: DataConsentNoticeProps) {
  return (
    <div className="rounded-lg border border-edge bg-raised px-3 py-2.5">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff4d00] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        />
        <label
          htmlFor={id}
          className="cursor-pointer text-[11px] leading-relaxed text-ink-mute"
        >
          I understand that AlgoVault reads the active TradingView chart
          (symbol, timeframe, price) and sends my Copilot messages with that
          chart context to its backend, authenticated with my AlgoVault
          session, to provide AI analysis and related features.
        </label>
      </div>
      <a
        href={privacyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-block pl-6 text-[11px] text-brand-400 transition-colors hover:text-brand-300"
      >
        Read the Privacy Policy&nbsp;↗
      </a>
    </div>
  );
}
