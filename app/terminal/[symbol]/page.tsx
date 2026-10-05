import { DeepLinkPage } from "@/components/mobile/DeepLinkPage";
import { buildLoginUrl, parseDeepLink } from "@/lib/mobile/deep-links";

/**
 * `/terminal/{symbol}?tf=M5` — the canonical symbol deep link used by push
 * notifications, shared links and the mobile command centre.
 */
export default async function TerminalSymbolPage({
    params,
    searchParams,
}: {
    params: Promise<{ symbol: string }>;
    searchParams: Promise<{ tf?: string }>;
}) {
    const [{ symbol }, { tf }] = await Promise.all([params, searchParams]);
    const path = `/terminal/${encodeURIComponent(symbol)}${tf ? `?tf=${encodeURIComponent(tf)}` : ""}`;
    const link = parseDeepLink(path);
    // An unsupported symbol is a real 404, not a blank chart.
    if (!link || link.target.kind !== "terminal") {
        return <DeepLinkPage target={{ kind: "terminal-home" }} loginRedirect={buildLoginUrl("/terminal")} />;
    }
    return <DeepLinkPage target={link.target} loginRedirect={buildLoginUrl(path)} />;
}
