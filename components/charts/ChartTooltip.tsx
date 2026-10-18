"use client";

import type { ComponentProps } from "react";
import { Tooltip } from "recharts";

type RechartsTooltipProps = ComponentProps<typeof Tooltip>;

/**
 * The app's Recharts tooltip.
 *
 * Recharts' default content stamps `color: #000` on every item unless the series
 * colour reaches the payload (`entry.color || '#000'` in DefaultTooltipContent).
 * On the dark tooltip surface that made values black-on-near-black — unreadable.
 * `itemStyle` is merged last, so it wins: values always render in theme ink
 * (near-white on the dark theme, near-black on the light one) with tabular
 * figures, and the surface follows the palette instead of hardcoded hexes.
 *
 * Callers pass any Recharts `Tooltip` prop (`formatter`, `labelFormatter`,
 * `cursor`, `content`, …); the surface props below can still be overridden.
 */
export function ChartTooltip({
    contentStyle,
    labelStyle,
    itemStyle,
    ...props
}: RechartsTooltipProps) {
    return (
        <Tooltip
            contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border-color)",
                borderRadius: 12,
                color: "var(--foreground)",
                fontSize: 13,
                boxShadow: "0 8px 24px rgb(0 0 0 / 0.24)",
                ...contentStyle,
            }}
            labelStyle={{
                color: "var(--muted-foreground)",
                marginBottom: 4,
                ...labelStyle,
            }}
            itemStyle={{
                color: "var(--foreground)",
                fontVariantNumeric: "tabular-nums",
                ...itemStyle,
            }}
            {...props}
        />
    );
}
