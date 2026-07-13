"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Megaphone, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";

const STORAGE_KEY = "sidebar-collapsed";

let cachedCollapsed = false;
let hydrated = false;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!hydrated) {
    cachedCollapsed = localStorage.getItem(STORAGE_KEY) === "1";
    hydrated = true;
  }
  return cachedCollapsed;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setCollapsed(next: boolean) {
  cachedCollapsed = next;
  hydrated = true;
  localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  listeners.forEach((listener) => listener());
}

export function SidebarShell() {
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return (
    <aside
      className={cn(
        "shrink-0 border-b bg-muted/20 transition-[width] duration-200 md:border-r md:border-b-0",
        collapsed ? "md:w-14" : "md:w-60",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 px-4 md:px-2.5">
        <Link
          href="/"
          className={cn(
            "flex min-w-0 items-center gap-2 font-semibold tracking-tight",
            collapsed && "md:hidden",
          )}
        >
          <Megaphone className="size-5 shrink-0" />
          <span className="truncate">Campaign&nbsp;Tracker</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden shrink-0 md:inline-flex"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
      <div className="px-2 pb-3 md:pb-2">
        <AppSidebar collapsed={collapsed} />
      </div>
    </aside>
  );
}
