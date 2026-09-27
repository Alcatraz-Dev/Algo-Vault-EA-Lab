import AdminGuard from "@/components/auth/AdminGuard";

export default function AgentLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AdminGuard>
            {children}
        </AdminGuard>
    );
}
