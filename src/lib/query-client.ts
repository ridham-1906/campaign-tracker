import {
  MutationCache,
  QueryCache,
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiError } from "@/lib/http";

/**
 * A 401 means the JWT cookie expired or the user row vanished (see getSession()
 * in lib/auth.ts). proxy.ts only guards *pages* — its matcher excludes /api —
 * so an expired session inside an already-open tab surfaces here as a JSON 401
 * and never as a redirect. Handle it once, centrally.
 *
 * A hard navigation rather than router.push(): this runs outside React with no
 * router available, and a full reload guarantees the in-memory query cache dies
 * with the dead session instead of surviving into the next login.
 */
let redirecting = false;

function handleAuthError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  if (isServer || redirecting) return true;
  redirecting = true;
  const from = window.location.pathname + window.location.search;
  window.location.assign(`/login?from=${encodeURIComponent(from)}`);
  return true;
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (handleAuthError(error)) return;
        // Background refetch failures stay silent — the component decides
        // whether to surface `query.error`. Log only, for diagnosis.
        console.error("[query]", error);
      },
    }),

    mutationCache: new MutationCache({
      onError: (error) => {
        if (handleAuthError(error)) return;
        // Every mutation used to end with toast.error(apiError(res.data)).
        // Centralising it means no hook can forget; a hook wanting a bespoke
        // message overrides with its own onError.
        toast.error(
          error instanceof ApiError ? apiError(error.data) : "Something went wrong",
        );
      },
    }),

    defaultOptions: {
      queries: {
        // Long enough that opening a dialog, closing it, and hopping between
        // /, /images and /clients doesn't re-hit Mongo; short enough that a
        // colleague's edit shows up on the next window focus.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // 4xx are all deterministic here: 400 (zod), 401 (dead session),
        // 404, 409 (in-use delete). Only transient 5xx are worth a retry —
        // realistically a Mongoose cold-connect blip.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: {
        // Campaign create, attachment upload and send-reminder are not
        // idempotent — a retry would duplicate a row or re-send an email.
        retry: 0,
      },
      // Inert today (nothing is prefetched on the server), but makes a later
      // per-page move to RSC prefetch + HydrationBoundary work unchanged.
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Fresh per request on the server, so one user's cache can never be handed to
 * another during SSR; a singleton in the browser, so React's initial
 * suspend-and-retry doesn't throw the cache away.
 */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
