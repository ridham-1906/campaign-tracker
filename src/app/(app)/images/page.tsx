import { requireSession } from "@/lib/auth";
import { ImagesManager } from "@/components/images-manager";

export default async function ImagesPage() {
  // Attachment groups are fetched client-side through /api/images, which
  // aggregates them in the database rather than flattening every campaign in
  // the browser; the page only gates access.
  const session = await requireSession();

  return <ImagesManager isAdmin={session.isAdmin} />;
}
