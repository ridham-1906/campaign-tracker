"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Megaphone, Users, Store, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Campaigns", icon: Megaphone },
  { href: "/sales", label: "Sales persons", icon: Users },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/clients", label: "Clients", icon: Building2 },
];

export function AppSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {ITEMS.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
              collapsed && "md:justify-center md:px-2",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
