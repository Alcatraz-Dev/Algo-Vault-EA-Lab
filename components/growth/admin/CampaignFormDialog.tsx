"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { FormSection } from "@/components/ui/form-section";
import { Select } from "@/components/ui/select";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { fromInputDateTime, toInputDateTime } from "@/components/growth/admin/format";
import {
    CAMPAIGN_OBJECTIVES,
    CAMPAIGN_OBJECTIVE_LABELS,
    CAMPAIGN_STATUSES,
    CHANNEL_LABELS,
    CHANNEL_TYPES,
    PLACEMENT_LABELS,
    PLACEMENT_TYPES,
} from "@/lib/growth/constants";

export type CampaignFormValues = {
    name: string;
    objective: string;
    status: string;
    startDate: number;
    endDate: number;
    channels: string[];
    audienceCountries: string;
    contentTopics: string;
    tone: string;
    affiliateOfferIds: string[];
    placements: string[];
};

export type CampaignFormRow = {
    id: string;
    name: string;
    objective?: string;
    status?: string;
    channels?: string[];
    startDate?: number;
    startAt?: number;
    endDate?: number;
    endAt?: number;
    audience?: { countries?: string[] };
    contentStrategy?: { topics?: string[]; tone?: string };
    affiliateOffers?: string[];
    monetizationPlacements?: string[];
};

type OfferRow = { id: string; name: string; active?: boolean };

export function CampaignFormDialog({
    open,
    onOpenChange,
    campaign,
    busy,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    campaign?: CampaignFormRow | null;
    busy: boolean;
    onSubmit: (values: CampaignFormValues) => Promise<void>;
}) {
    const offers = useAdminFetch<OfferRow[]>("/api/growth/affiliates");
    const [values, setValues] = useState<CampaignFormValues>({
        name: "",
        objective: "AWARENESS",
        status: "DRAFT",
        startDate: 0,
        endDate: 0,
        channels: [],
        audienceCountries: "",
        contentTopics: "",
        tone: "",
        affiliateOfferIds: [],
        placements: [],
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const campaignKey = campaign?.id ?? "new";

    // Reset the form whenever the dialog opens for a different campaign.
    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setErrors({});
        setValues({
            name: campaign?.name || "",
            objective: campaign?.objective || "AWARENESS",
            status: campaign?.status || "DRAFT",
            startDate: campaign?.startDate || campaign?.startAt || 0,
            endDate: campaign?.endDate || campaign?.endAt || 0,
            channels: campaign?.channels || [],
            audienceCountries: (campaign?.audience?.countries || []).join(", "),
            contentTopics: (campaign?.contentStrategy?.topics || []).join(", "),
            tone: campaign?.contentStrategy?.tone || "",
            affiliateOfferIds: campaign?.affiliateOffers || [],
            placements: campaign?.monetizationPlacements || [],
        });
    }, [open, campaignKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) =>
        setValues((v) => ({ ...v, [key]: value }));

    const validate = (): boolean => {
        const next: Record<string, string> = {};
        if (!values.name.trim()) next.name = "Campaign name is required.";
        if (values.channels.length === 0) next.channels = "Select at least one channel.";
        if (values.startDate && values.endDate && values.endDate <= values.startDate) {
            next.endDate = "End date must be after the start date.";
        }
        if (values.status === "ACTIVE" && !values.startDate) {
            next.startDate = "Active campaigns need a start date.";
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const submit = async () => {
        if (!validate()) return;
        await onSubmit(values);
    };

    const activeOffers = useMemo(() => (offers.data || []).filter((o) => o.active !== false), [offers.data]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{campaign ? `Edit campaign · ${campaign.name}` : "Create campaign"}</DialogTitle>
                    <DialogDescription>
                        {campaign
                            ? "Changes are validated and saved to the real campaign record."
                            : "The campaign is stored in Firebase and becomes actionable immediately."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <FormSection title="Basics">
                        <FormField label="Name" htmlFor="campaign-name" required error={errors.name}>
                            <Input
                                id="campaign-name"
                                value={values.name}
                                onChange={(e) => set("name", e.target.value)}
                                placeholder="e.g. Q3 Awareness push"
                                aria-invalid={Boolean(errors.name)}
                            />
                        </FormField>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Objective" htmlFor="campaign-objective" required>
                                <Select
                                    id="campaign-objective"
                                    value={values.objective}
                                    onChange={(e) => set("objective", e.target.value)}
                                >
                                    {CAMPAIGN_OBJECTIVES.map((o) => (
                                        <option key={o} value={o}>
                                            {CAMPAIGN_OBJECTIVE_LABELS[o]}
                                        </option>
                                    ))}
                                </Select>
                            </FormField>
                            <FormField label="Status" htmlFor="campaign-status">
                                <Select
                                    id="campaign-status"
                                    value={values.status}
                                    onChange={(e) => set("status", e.target.value)}
                                >
                                    {CAMPAIGN_STATUSES.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </Select>
                            </FormField>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Start" htmlFor="campaign-start" description="Optional target start time." error={errors.startDate}>
                                <Input
                                    id="campaign-start"
                                    type="datetime-local"
                                    value={toInputDateTime(values.startDate)}
                                    onChange={(e) => set("startDate", fromInputDateTime(e.target.value))}
                                />
                            </FormField>
                            <FormField label="End" htmlFor="campaign-end" error={errors.endDate}>
                                <Input
                                    id="campaign-end"
                                    type="datetime-local"
                                    value={toInputDateTime(values.endDate)}
                                    onChange={(e) => set("endDate", fromInputDateTime(e.target.value))}
                                />
                            </FormField>
                        </div>
                    </FormSection>

                    <FormSection title="Distribution">
                        <FormField
                            label="Channels"
                            required
                            description="Campaign content distributes across these channels."
                            error={errors.channels}
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {CHANNEL_TYPES.map((c) => {
                                    const on = values.channels.includes(c);
                                    return (
                                        <ToggleChip
                                            key={c}
                                            active={on}
                                            onClick={() =>
                                                set("channels", on ? values.channels.filter((x) => x !== c) : [...values.channels, c])
                                            }
                                        >
                                            {CHANNEL_LABELS[c]}
                                        </ToggleChip>
                                    );
                                })}
                            </div>
                        </FormField>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Target countries" htmlFor="campaign-countries" description="Comma-separated ISO codes, e.g. US, GB.">
                                <Input
                                    id="campaign-countries"
                                    value={values.audienceCountries}
                                    onChange={(e) => set("audienceCountries", e.target.value)}
                                    placeholder="US, GB, DE"
                                />
                            </FormField>
                            <FormField label="Content tone" htmlFor="campaign-tone">
                                <Input
                                    id="campaign-tone"
                                    value={values.tone}
                                    onChange={(e) => set("tone", e.target.value)}
                                    placeholder="professional, factual"
                                />
                            </FormField>
                        </div>

                        <FormField label="Content topics" htmlFor="campaign-topics" description="Comma-separated topics the AI content pipeline should cover.">
                            <Input
                                id="campaign-topics"
                                value={values.contentTopics}
                                onChange={(e) => set("contentTopics", e.target.value)}
                                placeholder="trading psychology, risk management"
                            />
                        </FormField>
                    </FormSection>

                    <FormSection title="Monetization">
                        <FormField
                            label="Affiliate offers"
                            description={
                                <>
                                    Offers surfaced for this campaign. AI selects recommendations by relevance first — never by commission.{" "}
                                    {offers.loading ? "Loading offers…" : ""}
                                </>
                            }
                        >
                            {activeOffers.length === 0 ? (
                                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                                    No active affiliate offers yet — add them from <a className="underline" href="/admin/monetization/affiliate">Affiliate</a>.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {activeOffers.map((o) => {
                                        const on = values.affiliateOfferIds.includes(o.id);
                                        return (
                                            <label
                                                key={o.id}
                                                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-xs transition-colors ${
                                                    on
                                                        ? "border-primary/40 bg-primary/5"
                                                        : "border-border hover:bg-muted/40"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={on}
                                                    className="size-4 accent-primary"
                                                    onChange={(e) =>
                                                        set(
                                                            "affiliateOfferIds",
                                                            e.target.checked
                                                                ? [...values.affiliateOfferIds, o.id]
                                                                : values.affiliateOfferIds.filter((id) => id !== o.id)
                                                        )
                                                    }
                                                />
                                                <span className="font-medium text-foreground">{o.name}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </FormField>

                        <FormField label="Monetization placements" description="Where ad placements should be considered for this campaign.">
                            <div className="flex flex-wrap gap-1.5">
                                {PLACEMENT_TYPES.map((p) => {
                                    const on = values.placements.includes(p);
                                    return (
                                        <ToggleChip
                                            key={p}
                                            active={on}
                                            onClick={() =>
                                                set("placements", on ? values.placements.filter((x) => x !== p) : [...values.placements, p])
                                            }
                                        >
                                            {PLACEMENT_LABELS[p]}
                                        </ToggleChip>
                                    );
                                })}
                            </div>
                        </FormField>
                    </FormSection>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => void submit()}>
                        {busy ? "Saving…" : campaign ? "Save changes" : "Create campaign"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}