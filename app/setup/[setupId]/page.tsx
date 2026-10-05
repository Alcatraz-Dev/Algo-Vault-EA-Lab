import { notFound } from "next/navigation";
import { DeepLinkPage } from "@/components/mobile/DeepLinkPage";
import { buildLoginUrl, parseDeepLink } from "@/lib/mobile/deep-links";

/**
 * Canonical deep-link route. Parsed by the shared parser rather than by hand, so
 * a link written by the notification router and a link pasted into a browser
 * resolve to exactly the same target — and a malformed id 404s instead of
 * touching the database.
 */
export default async function Page({ params }: { params: Promise<{ setupId: string }> }) {
    const { setupId } = await params;
    const path = `/setup/${encodeURIComponent(setupId)}`;
    const link = parseDeepLink(path);
    if (!link) notFound();

    return <DeepLinkPage target={link.target} loginRedirect={buildLoginUrl(path)} />;
}
