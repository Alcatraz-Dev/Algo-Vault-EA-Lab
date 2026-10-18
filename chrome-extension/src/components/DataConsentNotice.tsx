import { Info } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";

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
 * - shadcn Checkbox (Radix) associates the input with its label via
 *   `htmlFor` (screen-reader announced, keyboard operable, visible focus ring).
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
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
          className="mt-0.5 shrink-0"
        />
        <Info size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-[11px] leading-snug text-muted-foreground">
          <label htmlFor={id} className="cursor-pointer">
            AlgoVault uses your TradingView chart data and Copilot messages,
            sent with your session, to provide AI analysis.
          </label>{" "}
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2 hover:text-foreground"
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
