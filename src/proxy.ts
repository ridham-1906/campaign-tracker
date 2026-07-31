import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

// Routes that do not require authentication. `/preview/<token>` is the
// emailed share link: the token in the path is its credential, and the sales
// person it's for has no account here.
const PUBLIC_PATHS = ["/login", "/preview"];

// The subset that only makes sense logged *out* — a share link stays reachable
// either way, so the owner can open the same URL they just sent.
const GUEST_ONLY_PATHS = ["/login"];

const matches = (paths: string[], pathname: string) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isPublic = matches(PUBLIC_PATHS, pathname);

  // Not logged in -> force to /login
  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Logged in but visiting /login -> go to dashboard
  if (session && matches(GUEST_ONLY_PATHS, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, static assets and the cron API
  // (the cron endpoint authenticates with its own secret).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
