"use client";

import { REPORT_TYPES, REPORT_TYPE_LABELS, ReportType } from "@/lib/growth/constants";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";

export function ReportTypeSelector({
    value,
    onChange,
    label = "Report type",
    description = "Select the scope of the report.",
}: {
    value: ReportType;
    onChange: (value: ReportType) => void;
    label?: string;
    description?: string;
}) {
    return (
        <FormField label={label} description={description}>
            <Select
                value={value}
                onChange={(e) => onChange(e.target.value as ReportType)}
            >
                {REPORT_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                        {REPORT_TYPE_LABELS[rt]}
                    </option>
                ))}
            </Select>
        </FormField>
    );
}
