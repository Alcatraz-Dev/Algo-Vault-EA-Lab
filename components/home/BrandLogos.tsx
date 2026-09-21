/**
 * Brand logo marks for the home page ecosystem section.
 * Real brand images placed in /public/logos are used when present;
 * everything else falls back to clean inline SVG marks. Sized by `size`.
 */

export type BrandLogoName = "tradingview" | "mt5" | "mt4" | "pine" | "mql5" | "telegram";

/** Public images the owner dropped into /public/logos — used verbatim. */
const IMAGE_LOGOS: Partial<Record<BrandLogoName, { src: string; label: string }>> = {
    tradingview: { src: "/logos/tradingview.png", label: "TradingView" },
    pine: { src: "/logos/pineScript.png", label: "Pine Script v6" },
};

function Mark({
    size,
    className,
    label,
    children,
}: {
    size: number;
    className?: string;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 48 48"
            className={className}
            role="img"
            aria-label={label}
        >
            {children}
        </svg>
    );
}

function TradingViewMark({ size, className }: { size: number; className?: string }) {
    return (
        <Mark size={size} className={className} label="TradingView">
            <rect width="48" height="48" rx="11" fill="#131722" />
            {/* TV glyph — candlestick T + rising V */}
            <rect x="13.5" y="16.5" width="12.5" height="3" rx="1.5" fill="#2BD97E" />
            <rect x="18" y="16.5" width="3.2" height="15.5" rx="1.6" fill="#2BD97E" />
            <path
                d="M30.5 17.5 L34.5 32.5 L38.5 17.5"
                stroke="#2BD97E"
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </Mark>
    );
}

function MetaTraderMark({
    size,
    className,
    version,
}: {
    size: number;
    className?: string;
    version: "mt5" | "mt4";
}) {
    const label = version === "mt5" ? "MetaTrader 5" : "MetaTrader 4";
    const fill = version === "mt5" ? "#1C6FB8" : "#14508F";
    return (
        <Mark size={size} className={className} label={label}>
            <rect width="48" height="48" rx="11" fill={fill} />
            <rect width="48" height="10" rx="5" fill="#ffffff" opacity={0.08} />
            <text
                x="24"
                y="31"
                textAnchor="middle"
                fontSize={version === "mt5" ? "13.5" : "13.5"}
                fontWeight="800"
                fill="#ffffff"
                fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
            >
                {version.toUpperCase()}
            </text>
        </Mark>
    );
}

function PineMark({ size, className }: { size: number; className?: string }) {
    return (
        <Mark size={size} className={className} label="Pine Script v6">
            <rect width="48" height="48" rx="11" fill="#0E9F6E" />
            {/* pine sprig */}
            <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round">
                <path d="M14 30 h10 M17 27 h6 M20 24 h4 M16 33 h12" opacity={0.9} />
            </g>
            <path d="M24 10 l3.4 6.5 -3.4 1.6 -3.4 -1.6 Z" fill="#ffffff" />
        </Mark>
    );
}

function MQL5Mark({ size, className }: { size: number; className?: string }) {
    return (
        <Mark size={size} className={className} label="MQL5">
            <rect width="48" height="48" rx="11" fill="#0BA5E9" />
            <text
                x="24"
                y="30"
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill="#ffffff"
                fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
            >
                MQL5
            </text>
        </Mark>
    );
}

function TelegramMark({ size, className }: { size: number; className?: string }) {
    return (
        <Mark size={size} className={className} label="Telegram">
            <rect width="48" height="48" rx="11" fill="#229ED9" />
            <g transform="translate(12 12)">
                <path
                    fill="#ffffff"
                    d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
                />
            </g>
        </Mark>
    );
}

export default function BrandLogo({
    name,
    size = 44,
    className,
}: {
    name: BrandLogoName;
    size?: number;
    className?: string;
}) {
    const image = IMAGE_LOGOS[name];
    if (image) {
        return (
            <span
                className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ${className ?? ""}`}
                style={{ width: size, height: size }}
                role="img"
                aria-label={image.label}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={image.src}
                    alt={image.label}
                    width={size}
                    height={size}
                    loading="lazy"
                    decoding="async"
                    className="object-contain"
                />
            </span>
        );
    }

    switch (name) {
        case "tradingview":
            return <TradingViewMark size={size} className={className} />;
        case "mt5":
            return <MetaTraderMark size={size} className={className} version="mt5" />;
        case "mt4":
            return <MetaTraderMark size={size} className={className} version="mt4" />;
        case "pine":
            return <PineMark size={size} className={className} />;
        case "mql5":
            return <MQL5Mark size={size} className={className} />;
        case "telegram":
            return <TelegramMark size={size} className={className} />;
        default:
            return null;
    }
}