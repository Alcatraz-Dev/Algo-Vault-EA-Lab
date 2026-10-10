// Legacy route: the workspace concept was folded into the Candel studio
// (`/account/candels/[candelId]`). Kept as a redirect so existing links work.
import { redirect } from "next/navigation";

export default function LegacyCandelWorkspacePage() {
  redirect("/account/candels");
}
