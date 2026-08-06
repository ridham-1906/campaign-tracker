import { LinkIcon } from "lucide-react";

/** Shown when a token doesn't resolve. Links never expire, so this only means
 * the address was mistyped or the share was revoked — worth saying, since the
 * default 404 would leave a sales person assuming the link had timed out. */
export default function PreviewNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <LinkIcon className="size-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold tracking-tight">
        This preview link isn&apos;t available
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The address may be incomplete, or the link may have been revoked. Ask
        whoever sent it to share it again.
      </p>
    </div>
  );
}
