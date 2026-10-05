import type { ReactNode } from "react";
import AppSidebarLayout from "@/components/layout/AppSidebarLayout";

export default function ToolsLayout({ children }: { children: ReactNode }) {
    return <AppSidebarLayout>{children}</AppSidebarLayout>;
}
