"use client";

import AdminShell from "@/components/admin/AdminShell";
import { ShieldCheck, AlertTriangle, Database } from "lucide-react";

export default function FinancialOverviewPage() {
  return (
    <AdminShell title="Financial Foundation" subtitle="Normalized financial interpretation — read-only observation">
      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-2">Source of Truth</h3>
        <div className="text-sm text-muted-foreground space-y-1">
          <div>Stripe → Payment authority (authoritative)</div>
          <div>Firebase RTDB → Application/realtime state</div>
          <div>Business Events → Integration/event history</div>
          <div>Financial Layer → Normalized interpretation (not authoritative)</div>
          <div>ERPNext → Future accounting destination (optional, disabled)</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Gross Sales</div>
          <div className="font-semibold">Not available</div>
          <div className="text-xs text-muted-foreground">No aggregated source data for gross sales.</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Refunds</div>
          <div className="font-semibold">Not available</div>
          <div className="text-xs text-muted-foreground">Stripe webhook handles refunds; no separate aggregated ledger yet.</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Net Sales</div>
          <div className="font-semibold">Not available</div>
          <div className="text-xs text-muted-foreground">Requires gross + confirmed refunds + fee data.</div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-2">Payment Fees</h3>
        <div className="text-sm text-muted-foreground">Stripe fee data is not currently exposed to the platform. Fee information unavailable rather than estimated.</div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-2">Developer / Vendor / Affiliate Payables</h3>
        <div className="text-sm text-muted-foreground">No standalone marketplace commission/payout engine exists. Commission logic is only in trading backtest simulation or growth tracking (affiliate revenue tracking only). No developer payout calculation available.</div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-semibold mb-2">Financial Transaction Ledger</h3>
        <div className="text-sm text-muted-foreground mb-2">Normalized interpretation layer exists (lib/commerce-financial/). Use integer minor units, preserved currency, idempotent writes.</div>
        <div className="text-xs text-muted-foreground">No duplicate database introduced. Persistence via existing Firebase RTDB if needed.</div>
        <div className="mt-3 flex gap-3">
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Money: integer minor</span>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Currency preserved</span>
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">No silent conversion</span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-semibold mb-2">Reconciliation Foundation</h3>
        <div className="text-sm text-muted-foreground">Conceptual model exists: Stripe payment → AlgoVault order → Financial transaction → License/Commission. Actual reconciliation requires all source records to exist. At this time, not all transition records are persisted in sufficient detail for automated reconciliation.</div>
        <div className="mt-3 text-xs text-muted-foreground">Status per item: matched / partially_matched / unmatched / not_applicable.</div>
      </div>

      <div className="rounded-xl border bg-rose-50 p-6 shadow-sm mt-6">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-600" /> Security & Source-of-Truth</h3>
        <div className="text-sm text-rose-700">No secrets stored in financial layer. Stripe secrets never exposed. No card data stored. Admin-only. Existing authorization preserved.</div>
      </div>
    </AdminShell>
  );
}
