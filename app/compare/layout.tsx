import type { ReactNode } from "react";
import AppSidebarLayout from "@/components/layout/AppSidebarLayout";

export default function CompareLayout({ children }: { children: ReactNode }) {
    return <AppSidebarLayout>{children}</AppSidebarLayout>;
}
