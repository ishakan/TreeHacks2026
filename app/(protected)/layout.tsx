import { AppShellHeader } from "@/components/app-shell-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();

  return (
    <SidebarProvider>
      <AppSidebar
        user={{ name: session.user.name, email: session.user.email }}
      />
      <SidebarInset>
        <AppShellHeader />
        <div className="bg-muted/35 min-h-[calc(100svh-3.5rem)] p-4 lg:p-6 lg:pt-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
