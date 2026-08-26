import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, isValidSessionCookie } from "./lib/auth";

export async function middleware(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await isValidSessionCookie(cookie);

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except /login itself, Next's internals, and static assets.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
