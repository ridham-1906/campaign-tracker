import { Megaphone } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { SidebarShell } from "@/components/sidebar-shell";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <SidebarShell />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b px-4 md:px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <Megaphone className="size-5 shrink-0" />
            <span className="truncate">Campaign&nbsp;Tracker</span>
          </div>
          <UserMenu name={session.name} email={session.email} />
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
