export default function ProgressRing({
    value,
    size = 132,
    strokeWidth = 10,
    label,
    threshold = 100,
    tone = "auto",
}: {
    value: number;
    size?: number;
    strokeWidth?: number;
    label?: string;
    threshold?: number;
    tone?: "auto" | "positive" | "negative";
}) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const normalized = Math.max(0, Math.min(value, threshold));
    const progress = (normalized / threshold) * circumference;
    const offset = circumference - progress;

    const resolvedTone =
        tone === "auto"
            ? value >= threshold
                ? "var(--chart-1)"
                : value >= threshold * 0.6
                    ? "var(--chart-3)"
                    : "var(--chart-4)"
            : tone === "positive"
                ? "var(--chart-1)"
                : "var(--chart-4)";

    return (
        <div
            className="relative inline-flex items-center justify-center"
            style={{ width: size, height: size }}
            role="img"
            aria-label={`${value}% ${label || ""}`.trim()}
        >
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="var(--muted)"
                    strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={resolvedTone}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    style={{ transition: "stroke-dashoffset 0.6s ease" }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tabular-nums">
                    {value.toFixed(0)}
                    <span className="text-sm text-muted-foreground">%</span>
                </span>
                {label && (
                    <span className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {label}
                    </span>
                )}
            </div>
        </div>
    );
}