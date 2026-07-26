"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";

/**
 * The app's single client boundary in the root layout. Deliberately not
 * `useState(() => new QueryClient())`: getQueryClient() already returns a
 * stable browser singleton and a fresh per-request instance on the server.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Ships as a no-op in production builds, so it needs no env guard. */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
