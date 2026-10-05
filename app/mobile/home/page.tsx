import { redirect } from "next/navigation";

/**
 * `/mobile/home` used to be a second, thinner command centre with its own local
 * type definitions. Phase 11 removed that duplicate — the command centre now
 * lives at `/mobile`. This redirect exists only so bookmarks, shared links and
 * old push payloads keep landing in the right place.
 */
export default function LegacyMobileHome() {
    redirect("/mobile");
}
