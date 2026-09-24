"use client";

import { useMemo, useState } from "react";
import { BarChart3, Download, FileBarChart2, FileText, Plus, RefreshCw } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { ReportTypeSelector } from "./ReportTypeSelector";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import { fmtDate, fmtDateTime, fmtRelative, fmtCurrency } from "@/components/growth/admin/format";
import { REPORT_INTERVALS, ReportInterval, ReportType } from "@/lib/growth/constants";

type ReportSection = {
    key: string;
    title: string;
    metrics: { label: string; value: string; delta?: number; tone?: string }[];
    narrative?: string;
    items?: { label: string; value: string }[];
};

type ReportRow = {
    id?: string;
    title: string;
    interval: string;
    type?: string;
    periodStart: number;
    periodEnd: number;
    sections: ReportSection[];
    recommendations?: string[];
    generatedBy?: string;
    createdAt?: number;
    updatedAt?: number;
    rawData?: { revenue?: Array<{ recordedAt: number; amount: number; type: string }> };
};

function exportReportCSV(report: ReportRow) {
    const rows: string[] = ["Report Type,Generated At,Interval", `${report.type || "GROWTH"},${fmtDateTime(report.createdAt)},${report.interval}`, "", "Section,Metric,Value"];
    for (const section of report.sections || []) {
        for (const m of section.metrics || []) {
            rows.push(`${section.title},${m.label},${m.value}`);
        }
        for (const item of section.items || []) {
            rows.push(`${section.title},${item.label},${item.value}`);
        }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title}-${report.interval}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportReportPDF(report: ReportRow) {
    const content = [
        `<h1>${report.title}</h1>`,
        `<p>${report.interval} · ${fmtDate(report.periodStart)} – ${fmtDate(report.periodEnd)}</p>`,
        "",
        ...(report.sections || []).flatMap((section) => [
            `<h2>${section.title}</h2>`,
            ...(section.metrics || []).map((m) => `<p><b>${m.label}:</b> ${m.value}</p>`),
            section.narrative ? `<p>${section.narrative}</p>` : "",
        ]),
        "",
        ...(report.recommendations || []).map((rec) => `<li>${rec}</li>`),
        "",
        `<p>Generated ${fmtDateTime(report.createdAt)} by ${report.generatedBy || "pipeline"}</p>`,
    ].join("\n");
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function AdminGrowthReportsPage() {
    const reports = useAdminFetch<ReportRow[]>("/api/growth/reports");
    const [interval, setInterval] = useState("");
    const [genOpen, setGenOpen] = useState(false);
    const [genInterval, setGenInterval] = useState<ReportInterval>("WEEKLY");
    const [genType, setGenType] = useState<ReportType>("GROWTH");
    const [busy, setBusy] = useState(false);
    const [viewing, setViewing] = useState<ReportRow | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

    const flash = (kind: "ok" | "error" | "info", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 6000);
    };

    const filtered = useMemo(() => {
        let rows = reports.data || [];
        if (interval) rows = rows.filter((r) => r.interval === interval);
        return rows;
    }, [reports.data, interval]);

    const generate = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await adminFetch<{ report?: ReportRow | null; duplicate?: boolean; error?: string }>("/api/growth/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ interval: genInterval, type: genType }),
            });
            if (result.duplicate) {
                flash("info", "A report for this period already exists — the job is idempotent.");
            } else if (result.error) {
                flash("error", result.error);
            } else {
                flash("ok", `Report generated (${genInterval}).`);
            }
            setGenOpen(false);
            reports.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not generate report.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Reports"
                subtitle="Aggregated growth summaries computed from recorded events, revenue and conversions."
                actions={
                    <>
                        <RefreshButton onRefresh={reports.refresh} loading={reports.loading} />
                        <Button type="button" size="sm" onClick={() => setGenOpen(true)}>
                            <Plus />
                            Generate report
                        </Button>
                    </>
                }
            />

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : notice.kind === "info" ? "info" : "error"}>{notice.text}</NoticeBanner>}

            <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Filter by interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
                    <option value="">All intervals</option>
                    {REPORT_INTERVALS.map((iv) => (
                        <option key={iv} value={iv}>
                            {iv}
                        </option>
                    ))}
                </Select>
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} report(s)</span>
            </div>

            {reports.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading reports">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14" />
                    ))}
                </div>
            ) : reports.error ? (
                <ErrorState
                    title="Couldn't load reports"
                    description={reports.error}
                    action={<Button type="button" variant="outline" onClick={reports.refresh}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<FileBarChart2 size={18} />}
                    title={interval ? "No reports for this interval" : "No reports yet"}
                    description={
                        interval
                            ? "Pick another interval or generate a report."
                            : "Reports are computed from real recorded data (impressions, clicks, revenue, conversions). Generate the first one to see the summary."
                    }
                    action={
                        !interval ? (
                            <Button type="button" size="sm" onClick={() => setGenOpen(true)}>
                                <Plus />
                                Generate report
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                    <Table className="min-w-[640px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Title</TableHead>
                                <TableHead>Interval</TableHead>
                                <TableHead>Period</TableHead>
                                <TableHead>Sections</TableHead>
                                <TableHead>Generated</TableHead>
                                <TableHead className="text-right">Open</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((r) => (
                                <TableRow key={r.id || r.periodStart}>
                                    <TableCell className="font-medium text-foreground">{r.title}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{r.interval}</Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{r.sections?.length || 0} sections</TableCell>
                                    <TableCell className="text-muted-foreground">{fmtRelative(r.createdAt || r.updatedAt)}</TableCell>
                                    <TableCell className="text-right">
                                        <Button type="button" variant="ghost" size="xs" onClick={() => setViewing(r)} aria-label={`Open report ${r.title}`}>
                                            <BarChart3 />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">What every report contains</h2>
                <p className="text-xs text-muted-foreground">
                    Each report is computed from stored growth data only — traffic, conversion, campaign, content and revenue performance. No values
                    are invented to fill a section; when a metric has insufficient data the report says so.
                </p>
            </div>

            {/* Generate dialog */}
            <Dialog open={genOpen} onOpenChange={setGenOpen}>
                <DialogContent className="sm:max-w-md md:max-w-xl lg:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Generate report</DialogTitle>
                        <DialogDescription>
                            The report is created by the real reporting pipeline. Duplicate periods are skipped (idempotent).
                        </DialogDescription>
                    </DialogHeader>
                    <FormField label="Interval" htmlFor="rep-interval">
                        <Select id="rep-interval" value={genInterval} onChange={(e) => setGenInterval(e.target.value as ReportInterval)}>
                            {REPORT_INTERVALS.map((iv) => (
                                <option key={iv} value={iv}>
                                    {iv === "DAILY" ? "Daily — last 24h" : iv === "WEEKLY" ? "Weekly — last 7 days" : "Monthly — last 30 days"}
                                </option>
                            ))}
                        </Select>
                    </FormField>
                    <ReportTypeSelector value={genType} onChange={setGenType} label="Report type" description="Select the scope of the report." />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setGenOpen(false)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busy} onClick={() => void generate()}>
                            {busy ? "Generating…" : <><RefreshCw /> Generate</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View report dialog */}
            <Dialog open={viewing !== null} onOpenChange={(o) => { if (!o) setViewing(null); }}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl md:max-w-3xl lg:max-w-4xl">
                     <DialogHeader>
                        <DialogTitle>{viewing?.title}</DialogTitle>
                        {viewing ? (
                            <DialogDescription>
                                {viewing.interval} · {fmtDate(viewing.periodStart)} – {fmtDate(viewing.periodEnd)}
                            </DialogDescription>
                        ) : null}
                    </DialogHeader>
                    {viewing && (
                        <div className="space-y-4">
                            {(viewing.sections || []).map((section) => (
                                <div key={section.key} className="rounded-md border border-border p-3">
                                    <h3 className="mb-2 text-sm font-medium text-foreground">{section.title}</h3>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {(section.metrics || []).map((m) => (
                                            <div key={m.label} className="rounded border border-border bg-muted/30 p-2">
                                                <p className="text-xs text-muted-foreground">{m.label}</p>
                                                <p className="text-sm font-semibold text-foreground">{m.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {section.key === "revenue" && viewing.rawData?.revenue && (
                                        <div className="mt-3 h-[180px]">
                                            <ResponsiveContainer>
                                                <BarChart data={viewing.rawData.revenue.map((e: { recordedAt: number; amount: number }) => ({
                                                    date: new Date(e.recordedAt).toISOString().slice(0, 10),
                                                    revenue: e.amount,
                                                }))}>
                                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                                    <YAxis tick={{ fontSize: 10 }} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                                                        formatter={(value: unknown) => [fmtCurrency(Number(value)), "Revenue"]}
                                                    />
                                                    <Legend />
                                                    <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                    {(section.items || []).length > 0 && (
                                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                            {(section.items || []).map((item, i) => (
                                                <li key={i}>
                                                    <span className="text-foreground">{item.label}:</span> {item.value}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {section.narrative && <p className="mt-2 text-xs text-muted-foreground">{section.narrative}</p>}
                                </div>
                            ))}
                            {(viewing.recommendations || []).length > 0 && (
                                <div className="rounded-md border border-border p-3">
                                    <h3 className="mb-2 text-sm font-medium text-foreground">Recommendations</h3>
                                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                                        {(viewing.recommendations || []).map((rec, i) => (
                                            <li key={i}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="flex items-center justify-between border-t border-border pt-3">
                                <p className="text-xs text-muted-foreground">{fmtDateTime(viewing.createdAt)} · {viewing.generatedBy || "pipeline"}</p>
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => exportReportCSV(viewing)}>
                                        <Download size={14} />
                                        Export CSV
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => exportReportPDF(viewing)}>
                                        <FileText size={14} />
                                        Export PDF
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}