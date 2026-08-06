import { requireSession } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";

/**
 * The landing page: the team-wide dashboard, which is what everyone wants to
 * see first. Creating and editing campaigns lives at /campaigns.
 *
 * Any logged-in user, not just an admin — the widening is read-only, see the
 * note in /api/dashboard/route.ts. The page only gates access; the rows come
 * from /api/dashboard client-side so the table can page, search, sort and
 * filter against the database.
 */
export default async function DashboardPage() {
  await requireSession();

  return <Dashboard />;
}
