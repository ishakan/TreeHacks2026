import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAMES = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "session_token",
  "__Secure-session_token",
]);

function hasSessionCookie(request: NextRequest) {
  const cookies = request.cookies.getAll();
  return cookies.some(
    (cookie) =>
      SESSION_COOKIE_NAMES.has(cookie.name) ||
      cookie.name.startsWith("better-auth."),
  );
}

export function proxy(request: NextRequest) {
  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/api/projects/:path*"],
};
